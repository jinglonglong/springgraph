import * as fs from 'fs';
import * as path from 'path';
import { Node } from '../../types';
import { ArchitectureContext, ArchitectureSignal } from '../types';
import { AnnotationAdapter, AnnotationFact } from './types';

/**
 * Lombok annotations recognized by this adapter.
 */
const LOMBOK_ANNOTATIONS = [
  'Getter',
  'Setter',
  'Data',
  'Builder',
  'NoArgsConstructor',
  'AllArgsConstructor',
  'RequiredArgsConstructor',
  'Slf4j',
  'Accessors',
];

/**
 * Extract the simple Lombok annotation name from a decorator string.
 * Handles both `@Getter` and `@lombok.Getter` forms.
 */
function getLombokAnnotationName(decorator: string): string | undefined {
  const match = decorator.match(/^(?:lombok\.)?([A-Za-z][A-Za-z0-9_]*)$/);
  return match?.[1];
}

/**
 * True when the node carries at least one recognized Lombok annotation.
 */
function hasLombokAnnotation(node: Node): boolean {
  if (!node.decorators || node.decorators.length === 0) return false;
  return node.decorators.some(d => {
    const base = getLombokAnnotationName(d);
    return base !== undefined && LOMBOK_ANNOTATIONS.includes(base);
  });
}

/**
 * Build a consistent evidence signal for a detected Lombok annotation.
 */
function createSignal(
  node: Node,
  annotation: string,
  message: string
): ArchitectureSignal {
  return {
    nodeId: node.id,
    facetName: 'lombok',
    profileName: 'lombok',
    confidence: 0.95,
    evidence: [message],
    scope: 'node',
    filePath: node.filePath,
    metadata: { annotation },
  };
}

/**
 * Best-effort check that a class declares at least one non-static final field.
 *
 * The current Node type does not surface field modifiers, so we inspect the
 * source text bounded by the class declaration lines. This lets us honor the
 * @RequiredArgsConstructor + final-field rule for Spring constructor-injection
 * detection without materializing generated method nodes.
 */
function classHasFinalField(node: Node, ctx: ArchitectureContext): boolean {
  if (node.kind !== 'class' || !node.filePath) return false;

  const filePath = path.resolve(ctx.projectRoot, node.filePath);
  let source: string;
  try {
    source = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return false;
  }

  const lines = source.split(/\r?\n/);
  const classStart = Math.max(0, node.startLine - 1);
  const classEnd = Math.min(lines.length, node.endLine);

  for (let i = classStart; i < classEnd; i++) {
    const line = lines[i];
    // Look for a field declaration containing `final` but not `static final`.
    if (line && /\bfinal\b/.test(line) && !/\bstatic\s+final\b/.test(line) && /;\s*$/.test(line)) {
      return true;
    }
  }

  return false;
}

/**
 * Lombok annotation adapter.
 *
 * Detects common Lombok annotations and emits lightweight facts describing the
 * generated members. This adapter deliberately does **not** create method nodes
 * for generated getters/setters; it only produces AnnotationFacts for downstream
 * facet/role assignment.
 */
export const lombokAdapter: AnnotationAdapter = {
  id: 'lombok',
  framework: 'lombok',

  supports(node: Node, _ctx: ArchitectureContext): boolean {
    return hasLombokAnnotation(node);
  },

  collectFacts(node: Node, ctx: ArchitectureContext): AnnotationFact[] {
    const facts: AnnotationFact[] = [];
    if (!node.decorators) return facts;

    const annotations = node.decorators
      .map(d => ({ raw: d, base: getLombokAnnotationName(d) }))
      .filter((d): d is { raw: string; base: string } => d.base !== undefined);

    for (const { raw, base } of annotations) {
      switch (base) {
        case 'Getter':
        case 'Setter':
        case 'Data': {
          const generates =
            base === 'Data' ? ['getter', 'setter'] : [base.toLowerCase()];
          facts.push({
            adapterId: 'lombok',
            nodeId: node.id,
            kind: 'generated-property',
            name: base,
            metadata: { generates },
            confidence: 0.95,
            evidence: [
              createSignal(
                node,
                raw,
                `Lombok @${base} generates accessors on ${node.kind} ${node.qualifiedName}`
              ),
            ],
          });
          break;
        }

        case 'RequiredArgsConstructor': {
          if (node.kind === 'class' && classHasFinalField(node, ctx)) {
            facts.push({
              adapterId: 'lombok',
              nodeId: node.id,
              kind: 'generated-method',
              name: base,
              metadata: {
                generates: 'constructor',
                role: 'ConstructorInjection',
              },
              confidence: 0.9,
              evidence: [
                createSignal(
                  node,
                  raw,
                  `Lombok @${base} generates a constructor for final fields, enabling constructor injection on ${node.qualifiedName}`
                ),
              ],
            });
          }
          break;
        }

        case 'NoArgsConstructor':
        case 'AllArgsConstructor':
          facts.push({
            adapterId: 'lombok',
            nodeId: node.id,
            kind: 'generated-method',
            name: base,
            metadata: { generates: 'constructor' },
            confidence: 0.9,
            evidence: [
              createSignal(
                node,
                raw,
                `Lombok @${base} generates a constructor on ${node.qualifiedName}`
              ),
            ],
          });
          break;

        case 'Slf4j':
          facts.push({
            adapterId: 'lombok',
            nodeId: node.id,
            kind: 'lifecycle',
            name: base,
            metadata: { generates: 'logger' },
            confidence: 0.95,
            evidence: [
              createSignal(
                node,
                raw,
                `Lombok @${base} injects a logger field on ${node.qualifiedName}`
              ),
            ],
          });
          break;

        case 'Builder':
        case 'Accessors':
        default:
          // Recognized but intentionally produces no fact. @Builder and
          // @Accessors only influence generated code shape, not architectural
          // role assignment.
          break;
      }
    }

    return facts;
  },
};

export default lombokAdapter;
