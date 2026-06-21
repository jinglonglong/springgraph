import { Node } from '../../types';
import { ArchitectureContext, ArchitectureLayer, ArchitectureSignal, NodeArchitectureFacet } from '../types';
import { AnnotationAdapter, AnnotationFact, RuleBasedAdapter, RuleBasedAdapterRule } from './types';

const VALID_LAYERS: ArchitectureLayer[] = [
  'entry',
  'remote',
  'business',
  'data',
  'model',
  'infra',
  'unknown',
];

/**
 * Normalize a decorator string such as `@Service`, `@org.foo.Service(...)`,
 * or `Service` into its simple annotation name for matching against rules.
 */
function normalizeAnnotationName(decorator: string): string {
  let raw = decorator.trim();
  if (raw.startsWith('@')) {
    raw = raw.slice(1);
  }

  const openParen = raw.indexOf('(');
  const fullName = openParen !== -1 ? raw.slice(0, openParen) : raw;
  return fullName.split('.').pop() || fullName;
}

function createEvidenceSignal(
  node: Node,
  rule: RuleBasedAdapterRule,
  confidence: number
): ArchitectureSignal {
  return {
    nodeId: node.id,
    facetName: 'rule-based',
    profileName: rule.adapterId || 'custom',
    confidence,
    evidence: [
      `Detected custom annotation @${rule.annotation} on ${node.kind} ${node.qualifiedName} via rule "${rule.adapterId}"`,
    ],
    scope: 'node',
    filePath: node.filePath,
    metadata: {
      annotation: rule.annotation,
      role: rule.produces.role,
      layer: rule.produces.layer,
      tags: rule.produces.tags,
    },
  };
}

/**
 * User-extensible rule-based annotation adapter.
 *
 * Companies can register custom annotation-to-architecture mappings at runtime
 * without modifying the core adapters. Each rule maps an annotation name to a
 * produced architectural role, layer, and optional tags.
 */
class RuleBasedAdapterImpl implements AnnotationAdapter, RuleBasedAdapter {
  readonly id = 'rule-based';
  readonly framework = 'custom';

  private rules: RuleBasedAdapterRule[] = [];

  supports(node: Node, _context: ArchitectureContext): boolean {
    if (!node.decorators || node.decorators.length === 0) {
      return false;
    }

    const ruleAnnotations = new Set(this.rules.map(r => r.annotation));
    return node.decorators.some(decorator => {
      const name = normalizeAnnotationName(decorator);
      return ruleAnnotations.has(name);
    });
  }

  registerRule(rule: RuleBasedAdapterRule): void {
    this.rules.push(rule);
  }

  collectFacts(node: Node, _context: ArchitectureContext): AnnotationFact[] {
    const facts: AnnotationFact[] = [];

    if (!node.decorators || this.rules.length === 0) {
      return facts;
    }

    for (const decorator of node.decorators) {
      const annotationName = normalizeAnnotationName(decorator);

      for (const rule of this.rules) {
        if (rule.annotation !== annotationName) {
          continue;
        }

        const confidence = 0.9;
        facts.push({
          adapterId: this.id,
          nodeId: node.id,
          kind: 'bean',
          name: node.name,
          metadata: {
            ruleId: rule.adapterId,
            annotation: rule.annotation,
            role: rule.produces.role,
            layer: rule.produces.layer,
            tags: rule.produces.tags,
          },
          confidence,
          evidence: [createEvidenceSignal(node, rule, confidence)],
        });
      }
    }

    return facts;
  }

  assignFacet(fact: AnnotationFact, _context: ArchitectureContext): Partial<NodeArchitectureFacet>[] {
    const metadata = fact.metadata || {};
    const role = (metadata.role as string) || 'CustomComponent';
    const rawLayer = metadata.layer as string | undefined;
    const layer: ArchitectureLayer = rawLayer && VALID_LAYERS.includes(rawLayer as ArchitectureLayer)
      ? (rawLayer as ArchitectureLayer)
      : 'unknown';

    const evidenceMessages = fact.evidence.flatMap(signal => signal.evidence);

    return [
      {
        nodeId: fact.nodeId,
        facetName: this.id,
        role,
        layer,
        confidence: fact.confidence,
        evidence: evidenceMessages,
        profileId: (metadata.ruleId as string) || 'custom',
      },
    ];
  }
}

export const ruleBasedAdapter: AnnotationAdapter = new RuleBasedAdapterImpl();

/**
 * Register a company-specific or custom annotation rule at runtime.
 */
export function registerCustomRule(rule: RuleBasedAdapterRule): void {
  (ruleBasedAdapter as RuleBasedAdapterImpl).registerRule(rule);
}
