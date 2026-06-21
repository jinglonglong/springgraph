import { Node } from '../../types';
import { ArchitectureContext, ArchitectureSignal } from '../types';
import { AnnotationAdapter, AnnotationFact, SynthesizedEdge } from './types';

const MAPSTRUCT_ANNOTATIONS = new Set([
  'Mapper',
  'Mapping',
  'Mappings',
  'BeanMapping',
  'IterableMapping',
]);

interface ParsedAnnotation {
  name: string;
  raw: string;
  attributes: Record<string, string>;
}

function normalizeAnnotationName(decorator: string): string {
  return decorator.replace(/^@/, '');
}

function parseAnnotationAttributes(body: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  if (!body.trim()) return attributes;

  let depth = 0;
  let current = '';
  const parts: string[] = [];

  for (const char of body) {
    if (char === '(' || char === '{' || char === '[') {
      depth++;
      current += char;
    } else if (char === ')' || char === '}' || char === ']') {
      depth--;
      current += char;
    } else if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());

  for (const part of parts) {
    const eqIndex = part.indexOf('=');
    if (eqIndex === -1) continue;
    const key = part.slice(0, eqIndex).trim();
    let value = part.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    attributes[key] = value;
  }

  return attributes;
}

function parseDecorator(decorator: string): ParsedAnnotation | null {
  const name = normalizeAnnotationName(decorator);
  const parenIndex = name.indexOf('(');

  if (parenIndex === -1) {
    const baseName = name;
    if (!MAPSTRUCT_ANNOTATIONS.has(baseName)) return null;
    return { name: baseName, raw: decorator, attributes: {} };
  }

  const baseName = name.slice(0, parenIndex);
  if (!MAPSTRUCT_ANNOTATIONS.has(baseName)) return null;

  const body = name.slice(parenIndex + 1, name.length - (name.endsWith(')') ? 1 : 0));
  return { name: baseName, raw: decorator, attributes: parseAnnotationAttributes(body) };
}

function findMapStructDecorators(node: Node): ParsedAnnotation[] {
  if (!node.decorators || node.decorators.length === 0) return [];
  return node.decorators
    .map(parseDecorator)
    .filter((parsed): parsed is ParsedAnnotation => parsed !== null);
}

function createEvidence(node: Node, message: string): ArchitectureSignal {
  return {
    nodeId: node.id,
    facetName: 'mapstruct',
    profileName: 'mapstruct',
    confidence: 0.85,
    evidence: [message],
    scope: 'node',
    filePath: node.filePath,
  };
}

function extractUsesClassNames(rawUses: string): string[] {
  const trimmed = rawUses.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('{')) {
    const inner = trimmed.slice(1, trimmed.endsWith('}') ? -1 : undefined);
    return inner
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => s.replace(/\.class$/, ''));
  }

  return [trimmed.replace(/\.class$/, '')];
}

class MapStructAdapter implements AnnotationAdapter {
  id = 'mapstruct';
  framework = 'mapstruct';

  supports(node: Node): boolean {
    return findMapStructDecorators(node).length > 0;
  }

  collectFacts(node: Node, _context: ArchitectureContext): AnnotationFact[] {
    const facts: AnnotationFact[] = [];
    const decorators = findMapStructDecorators(node);

    for (const decorator of decorators) {
      switch (decorator.name) {
        case 'Mapper': {
          const usesRaw = decorator.attributes.uses;
          const componentModel = decorator.attributes.componentModel;
          const isInterface = node.kind === 'interface';

          const metadata: Record<string, unknown> = {
            annotation: decorator.raw,
            onInterface: isInterface,
          };

          if (usesRaw) {
            metadata.uses = extractUsesClassNames(usesRaw);
            metadata.usesRaw = usesRaw;
          }

          if (componentModel) {
            metadata.componentModel = componentModel;
          }

          facts.push({
            adapterId: this.id,
            nodeId: node.id,
            kind: 'bean',
            name: 'Mapper',
            metadata,
            confidence: 0.85,
            evidence: [
              createEvidence(
                node,
                `Detected @Mapper on ${isInterface ? 'interface' : node.kind} "${node.qualifiedName || node.name}"`
              ),
            ],
          });

          if (componentModel === 'spring') {
            facts.push({
              adapterId: this.id,
              nodeId: node.id,
              kind: 'bean',
              name: 'SpringComponent',
              metadata: {
                annotation: decorator.raw,
                componentModel: 'spring',
                derivedFrom: '@Mapper(componentModel = "spring")',
              },
              confidence: 0.8,
              evidence: [
                createEvidence(
                  node,
                  `@Mapper declares componentModel="spring"; emitting Spring bean role for "${node.name}"`
                ),
              ],
            });
          }
          break;
        }

        case 'Mapping':
        case 'Mappings':
        case 'BeanMapping':
        case 'IterableMapping': {
          const metadata: Record<string, unknown> = {
            annotation: decorator.raw,
          };

          if (decorator.attributes.source) {
            metadata.source = decorator.attributes.source;
          }
          if (decorator.attributes.target) {
            metadata.target = decorator.attributes.target;
          }
          if (decorator.attributes.elementTargetType) {
            metadata.elementTargetType = decorator.attributes.elementTargetType.replace(/\.class$/, '');
          }

          facts.push({
            adapterId: this.id,
            nodeId: node.id,
            kind: 'mapping',
            name: decorator.name,
            metadata,
            confidence: 0.8,
            evidence: [
              createEvidence(
                node,
                `Detected @${decorator.name} on "${node.name}"${
                  metadata.source && metadata.target
                    ? ` mapping source "${metadata.source}" to target "${metadata.target}"`
                    : ''
                }`
              ),
            ],
          });
          break;
        }
      }
    }

    return facts;
  }

  synthesizeEdges?(fact: AnnotationFact, _context: ArchitectureContext): SynthesizedEdge[] {
    if (fact.kind !== 'bean' || fact.name !== 'Mapper') return [];

    const uses = fact.metadata.uses;
    if (!Array.isArray(uses) || uses.length === 0) return [];

    return uses
      .filter((usedMapper): usedMapper is string => typeof usedMapper === 'string')
      .map(usedMapper => ({
        source: fact.nodeId,
        target: usedMapper,
        kind: 'references',
        provenance: 'heuristic',
        metadata: {
          synthesizedBy: 'mapstruct-uses',
          adapterId: this.id,
          referencedMapper: usedMapper,
          registeredAt: fact.metadata.annotation,
        },
      }));
  }

  assignFacet?(fact: AnnotationFact): Partial<import('../types').NodeArchitectureFacet>[] {
    if (fact.name === 'Mapper' && fact.kind === 'bean') {
      return [
        {
          role: 'Mapper',
          layer: 'data',
          confidence: 0.85,
          evidence: ['MapStruct @Mapper detected; assigned Mapper role in data layer'],
        },
      ];
    }

    if (fact.name === 'SpringComponent') {
      return [
        {
          role: 'Component',
          layer: 'infra',
          confidence: 0.8,
          evidence: ['@Mapper(componentModel = "spring") detected; also a Spring-managed component'],
        },
      ];
    }

    return [];
  }
}

export const mapStructAdapter: AnnotationAdapter = new MapStructAdapter();
