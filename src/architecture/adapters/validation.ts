import { Node } from '../../types';
import { ArchitectureContext, NodeArchitectureFacet } from '../types';
import { AnnotationAdapter, AnnotationFact } from './types';

const VALIDATION_ANNOTATIONS = [
  'NotNull',
  'NotBlank',
  'Valid',
  'Validated',
  'Size',
  'Pattern',
];

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

function hasDecoratorNamed(node: Node, names: string[]): boolean {
  if (!node.decorators || node.decorators.length === 0) {
    return false;
  }
  return node.decorators.some(decorator => {
    const { name } = parseAnnotation(decorator);
    return names.includes(name);
  });
}

function extractNumberLiteral(input: string | null, key: string): number | undefined {
  if (!input) {
    return undefined;
  }
  const keyPattern = new RegExp(`${key}\\s*=\\s*(\\d+)`);
  const match = input.match(keyPattern);
  return match ? Number(match[1]) : undefined;
}

function extractStringLiteral(input: string | null): string | undefined {
  if (!input) {
    return undefined;
  }
  const firstMatch = input.match(/["']([^"']+)["']/);
  return firstMatch ? firstMatch[1] : undefined;
}

function buildEvidenceSignal(
  node: Node,
  annotationName: string,
  confidence: number,
  metadata: Record<string, unknown> = {}
): AnnotationFact['evidence'][number] {
  return {
    nodeId: node.id,
    facetName: 'validation',
    profileName: 'spring-cloud',
    confidence,
    evidence: [`Detected @${annotationName} on ${node.kind} ${node.qualifiedName}`],
    scope: 'node',
    filePath: node.filePath,
    metadata,
  };
}

class ValidationAdapter implements AnnotationAdapter {
  id = 'validation';
  framework = 'bean-validation';

  supports(node: Node, _context: ArchitectureContext): boolean {
    return hasDecoratorNamed(node, VALIDATION_ANNOTATIONS);
  }

  collectFacts(node: Node, _context: ArchitectureContext): AnnotationFact[] {
    const facts: AnnotationFact[] = [];

    if (!node.decorators) {
      return facts;
    }

    for (const decorator of node.decorators) {
      const parsed = parseAnnotation(decorator);
      const { name, args } = parsed;

      if (name === 'NotNull' || name === 'NotBlank') {
        const constraint = name === 'NotNull' ? 'not-null' : 'not-blank';
        facts.push({
          adapterId: this.id,
          nodeId: node.id,
          kind: 'config-binding',
          name: node.name,
          metadata: { annotation: name, constraint },
          confidence: 0.7,
          evidence: [
            buildEvidenceSignal(node, name, 0.7, { annotation: name, constraint }),
          ],
        });
      }

      if (name === 'Valid' || name === 'Validated') {
        facts.push({
          adapterId: this.id,
          nodeId: node.id,
          kind: 'lifecycle',
          name: node.name,
          metadata: { annotation: name, propagatesValidation: true },
          confidence: 0.7,
          evidence: [
            buildEvidenceSignal(node, name, 0.7, {
              annotation: name,
              propagatesValidation: true,
            }),
          ],
        });
      }

      if (name === 'Size') {
        const min = extractNumberLiteral(args, 'min');
        const max = extractNumberLiteral(args, 'max');
        facts.push({
          adapterId: this.id,
          nodeId: node.id,
          kind: 'config-binding',
          name: node.name,
          metadata: { annotation: name, min, max },
          confidence: 0.7,
          evidence: [
            buildEvidenceSignal(node, name, 0.7, {
              annotation: name,
              min,
              max,
            }),
          ],
        });
      }

      if (name === 'Pattern') {
        const regex = extractStringLiteral(args);
        facts.push({
          adapterId: this.id,
          nodeId: node.id,
          kind: 'config-binding',
          name: node.name,
          metadata: { annotation: name, regex },
          confidence: 0.7,
          evidence: [
            buildEvidenceSignal(node, name, 0.7, {
              annotation: name,
              regex,
            }),
          ],
        });
      }
    }

    return facts;
  }

  assignFacet(fact: AnnotationFact, _context: ArchitectureContext): Partial<NodeArchitectureFacet>[] {
    const evidenceMessages = fact.evidence.flatMap(signal => signal.evidence);

    return [
      {
        nodeId: fact.nodeId,
        facetName: this.id,
        role: 'Component',
        layer: 'infra',
        confidence: 0.6,
        evidence: evidenceMessages,
        profileId: 'spring-cloud',
      },
    ];
  }
}

export const validationAdapter: AnnotationAdapter = new ValidationAdapter();
