import { Node } from '../../types';
import { ArchitectureContext, ArchitectureSignal, NodeArchitectureFacet } from '../types';
import { AnnotationAdapter, AnnotationFact } from './types';

/**
 * OpenAPI/Swagger annotations recognized by this adapter.
 *
 * Supports both Swagger 2.x (`io.swagger.annotations.*`) and
 * OpenAPI 3.x (`io.swagger.v3.oas.annotations.*`) namespaces.
 */
const OPENAPI_ANNOTATIONS = new Set([
  // OpenAPI 3.x
  'Operation',
  'Tag',
  // Swagger 2.x
  'ApiOperation',
  'ApiModelProperty',
]);

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

function extractStringArray(input: string | null, key: string): string[] {
  if (!input) {
    return [];
  }

  const keyPattern = new RegExp(`${key}\\s*=\\s*\\{([^}]*)\\}`);
  const match = input.match(keyPattern);
  if (!match || !match[1]) {
    return [];
  }

  const values: string[] = [];
  const literalPattern = /["']([^"']*)["']/g;
  let literalMatch;
  while ((literalMatch = literalPattern.exec(match[1])) !== null) {
    if (literalMatch[1] !== undefined) {
      values.push(literalMatch[1]);
    }
  }

  return values;
}

function buildEvidenceSignal(
  node: Node,
  annotationName: string,
  metadata: Record<string, unknown>,
  confidence: number
): ArchitectureSignal {
  return {
    nodeId: node.id,
    facetName: 'openapi',
    profileName: 'openapi',
    confidence,
    evidence: [`Detected @${annotationName} on ${node.kind} ${node.qualifiedName}`],
    scope: 'node',
    filePath: node.filePath,
    metadata,
  };
}

class OpenApiAdapter implements AnnotationAdapter {
  readonly id = 'openapi';
  readonly framework = 'openapi';

  supports(node: Node, _context: ArchitectureContext): boolean {
    if (!node.decorators || node.decorators.length === 0) {
      return false;
    }

    return node.decorators.some(decorator => {
      const { name } = parseAnnotation(decorator);
      return OPENAPI_ANNOTATIONS.has(name);
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

      if (name === 'Operation') {
        const summary = extractStringLiteral(parsed.args, 'summary');
        const description = extractStringLiteral(parsed.args, 'description');
        const tags = extractStringArray(parsed.args, 'tags');

        facts.push({
          adapterId: this.id,
          nodeId: node.id,
          kind: 'bean',
          name: node.name,
          metadata: {
            annotation: name,
            summary,
            description,
            tags,
          },
          confidence: 0.7,
          evidence: [
            buildEvidenceSignal(node, name, { summary, description, tags }, 0.7),
          ],
        });
      }

      if (name === 'ApiOperation') {
        const summary = extractStringLiteral(parsed.args, 'value') ?? extractStringLiteral(parsed.args, 'summary');
        const description = extractStringLiteral(parsed.args, 'notes') ?? extractStringLiteral(parsed.args, 'description');
        const tags = extractStringArray(parsed.args, 'tags');

        facts.push({
          adapterId: this.id,
          nodeId: node.id,
          kind: 'bean',
          name: node.name,
          metadata: {
            annotation: name,
            summary,
            description,
            tags,
          },
          confidence: 0.7,
          evidence: [
            buildEvidenceSignal(node, name, { summary, description, tags }, 0.7),
          ],
        });
      }

      if (name === 'Tag') {
        const tagName = extractStringLiteral(parsed.args, 'name');

        facts.push({
          adapterId: this.id,
          nodeId: node.id,
          kind: 'mapping',
          name: tagName || node.name,
          metadata: {
            annotation: name,
            tagName,
          },
          confidence: 0.7,
          evidence: [
            buildEvidenceSignal(node, name, { tagName }, 0.7),
          ],
        });
      }

      if (name === 'ApiModelProperty') {
        const description = extractStringLiteral(parsed.args, 'value') ?? extractStringLiteral(parsed.args, 'notes');
        const example = extractStringLiteral(parsed.args, 'example');

        facts.push({
          adapterId: this.id,
          nodeId: node.id,
          kind: 'generated-property',
          name: node.name,
          metadata: {
            annotation: name,
            description,
            example,
          },
          confidence: 0.7,
          evidence: [
            buildEvidenceSignal(node, name, { description, example }, 0.7),
          ],
        });
      }
    }

    return facts;
  }

  assignFacet(_fact: AnnotationFact, _context: ArchitectureContext): Partial<NodeArchitectureFacet>[] {
    return [
      {
        role: 'Endpoint',
        layer: 'entry',
        confidence: 0.7,
      },
    ];
  }
}

export const openApiAdapter: AnnotationAdapter = new OpenApiAdapter();
