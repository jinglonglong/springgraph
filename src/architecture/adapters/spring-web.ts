import { Node } from '../../types';
import { ArchitectureContext, NodeArchitectureFacet } from '../types';
import { AnnotationAdapter, AnnotationFact } from './types';

const MAPPING_ANNOTATIONS = [
  'RequestMapping',
  'GetMapping',
  'PostMapping',
  'PutMapping',
  'DeleteMapping',
  'PatchMapping',
];

const METHOD_BY_ANNOTATION: Record<string, string> = {
  RequestMapping: '*',
  GetMapping: 'GET',
  PostMapping: 'POST',
  PutMapping: 'PUT',
  DeleteMapping: 'DELETE',
  PatchMapping: 'PATCH',
};

interface ParsedAnnotation {
  name: string;
  args: string | null;
}

function parseAnnotation(decorator: string): ParsedAnnotation {
  let raw = decorator.trim();
  if (raw.startsWith('@')) {
    raw = raw.slice(1);
  }

  const openParen = raw.indexOf('(');
  const hasArgs = openParen !== -1 && raw.endsWith(')');
  const fullName = hasArgs ? raw.slice(0, openParen) : raw;
  const name = fullName.split('.').pop() || fullName;
  const args = hasArgs ? raw.slice(openParen + 1, -1) : null;

  return { name, args };
}

function extractStringLiteral(input: string | null, key?: string): string | undefined {
  if (!input) {
    return undefined;
  }

  if (key) {
    const keyPattern = new RegExp(`${key}\\s*=\\s*["']([^"']+)["']`);
    const match = input.match(keyPattern);
    if (match) {
      return match[1];
    }
  }

  const firstMatch = input.match(/["']([^"']+)["']/);
  return firstMatch ? firstMatch[1] : undefined;
}

function extractPath(parsed: ParsedAnnotation): string | undefined {
  if (!parsed.args) {
    return undefined;
  }

  const value = extractStringLiteral(parsed.args, 'value') ?? extractStringLiteral(parsed.args);
  if (value) {
    return value;
  }

  const path = extractStringLiteral(parsed.args, 'path');
  if (path) {
    return path;
  }

  return undefined;
}

function extractMethod(parsed: ParsedAnnotation): string | undefined {
  const fromName = METHOD_BY_ANNOTATION[parsed.name];
  if (fromName && fromName !== '*') {
    return fromName;
  }

  if (parsed.args) {
    const methodMatch = parsed.args.match(/method\s*=\s*(?:RequestMethod\.)?([A-Za-z]+)/);
    if (methodMatch && methodMatch[1]) {
      return methodMatch[1].toUpperCase();
    }
  }

  return fromName;
}

function buildEvidenceSignal(
  node: Node,
  annotationName: string,
  path: string | undefined,
  method: string | undefined,
  confidence: number
): AnnotationFact['evidence'][number] {
  const details: string[] = [];
  if (path) details.push(`path="${path}"`);
  if (method) details.push(`method=${method}`);

  const detailText = details.length > 0 ? ` (${details.join(', ')})` : '';

  return {
    nodeId: node.id,
    facetName: 'spring-web',
    profileName: 'spring-cloud',
    confidence,
    evidence: [`Detected @${annotationName} on ${node.kind} ${node.qualifiedName}${detailText}`],
    scope: 'node',
    filePath: node.filePath,
    metadata: { annotation: annotationName, path, method },
  };
}

class SpringWebAdapter implements AnnotationAdapter {
  id = 'spring-web';
  framework = 'spring';

  supports(node: Node, _context: ArchitectureContext): boolean {
    if (!node.decorators || node.decorators.length === 0) {
      return false;
    }

    return node.decorators.some(decorator => {
      const { name } = parseAnnotation(decorator);
      return MAPPING_ANNOTATIONS.includes(name);
    });
  }

  collectFacts(node: Node, _context: ArchitectureContext): AnnotationFact[] {
    const facts: AnnotationFact[] = [];

    if (!node.decorators) {
      return facts;
    }

    for (const decorator of node.decorators) {
      const parsed = parseAnnotation(decorator);
      const { name } = parsed;

      if (!MAPPING_ANNOTATIONS.includes(name)) {
        continue;
      }

      const path = extractPath(parsed);
      const method = extractMethod(parsed);

      facts.push({
        adapterId: this.id,
        nodeId: node.id,
        kind: 'bean',
        name: node.name,
        metadata: {
          annotation: name,
          role: 'Endpoint',
          layer: 'entry',
          path,
          method,
        },
        confidence: 0.95,
        evidence: [buildEvidenceSignal(node, name, path, method, 0.95)],
      });
    }

    return facts;
  }

  assignFacet(fact: AnnotationFact, _context: ArchitectureContext): Partial<NodeArchitectureFacet>[] {
    const evidenceMessages = fact.evidence.flatMap(signal => signal.evidence);

    return [
      {
        nodeId: fact.nodeId,
        facetName: this.id,
        role: 'Endpoint',
        layer: 'entry',
        isEntrypoint: true,
        confidence: 0.95,
        evidence: evidenceMessages,
        profileId: 'spring-cloud',
      },
    ];
  }
}

export const springWebAdapter: AnnotationAdapter = new SpringWebAdapter();
