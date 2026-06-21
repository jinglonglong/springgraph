import { describe, it, expect, beforeEach } from 'vitest';
import {
  AnnotationAdapterRegistry,
  AnnotationAdapter,
  AnnotationFact,
  RuleBasedAdapter,
  RuleBasedAdapterRule,
  SynthesizedEdge,
} from '../src/architecture/adapters/types';
import { springAnnotationsAdapter } from '../src/architecture/adapters/spring-annotations';
import { mybatisAnnotationsAdapter } from '../src/architecture/adapters/mybatis-annotations';
import { springWebAdapter } from '../src/architecture/adapters/spring-web';
import { springScheduleEventAdapter } from '../src/architecture/adapters/spring-schedule-event';
import { lombokAdapter } from '../src/architecture/adapters/lombok';
import { mapStructAdapter } from '../src/architecture/adapters/mapstruct';
import { validationAdapter } from '../src/architecture/adapters/validation';
import { openApiAdapter } from '../src/architecture/adapters/openapi';
import { ruleBasedAdapter } from '../src/architecture/adapters/rule-based';
import { Node } from '../src/types';
import { ArchitectureContext, NodeArchitectureFacet } from '../src/architecture/types';

function makeNode(partial: Partial<Node> = {}): Node {
  return {
    id: partial.id ?? 'node-1',
    name: partial.name ?? 'TestNode',
    kind: partial.kind ?? 'class',
    filePath: partial.filePath ?? 'TestNode.java',
    language: partial.language ?? 'java',
    startLine: partial.startLine ?? 1,
    endLine: partial.endLine ?? 10,
    startColumn: partial.startColumn ?? 0,
    endColumn: partial.endColumn ?? 0,
    updatedAt: partial.updatedAt ?? Date.now(),
    decorators: partial.decorators,
    signature: partial.signature,
    qualifiedName: partial.qualifiedName ?? partial.name ?? 'TestNode',
  } as Node;
}

const mockContext: ArchitectureContext = {
  db: {} as any,
  projectRoot: '/tmp/test',
};

describe('AnnotationAdapterRegistry', () => {
  let registry: AnnotationAdapterRegistry;

  beforeEach(() => {
    registry = new AnnotationAdapterRegistry();
  });

  it('should register adapters and preserve insertion order', () => {
    const a: AnnotationAdapter = { id: 'a', framework: 'f1', supports: () => true, collectFacts: () => [] };
    const b: AnnotationAdapter = { id: 'b', framework: 'f2', supports: () => true, collectFacts: () => [] };

    registry.register(a);
    registry.register(b);

    const adapters = registry.getAdapters();
    expect(adapters).toHaveLength(2);
    expect(adapters[0].id).toBe('a');
    expect(adapters[1].id).toBe('b');
  });

  it('should retrieve a registered adapter by id', () => {
    const adapter: AnnotationAdapter = { id: 'test-adapter', framework: 'test', supports: () => true, collectFacts: () => [] };
    registry.register(adapter);

    expect(registry.getAdapter('test-adapter')).toBe(adapter);
  });

  it('should return undefined for an unknown adapter id', () => {
    expect(registry.getAdapter('missing')).toBeUndefined();
  });

  it('should return a defensive copy from getAdapters', () => {
    const adapter: AnnotationAdapter = { id: 'a', framework: 'f', supports: () => true, collectFacts: () => [] };
    registry.register(adapter);

    const first = registry.getAdapters();
    first.pop();

    expect(registry.getAdapters()).toHaveLength(1);
  });

  it('should clear all registered adapters', () => {
    registry.register({ id: 'a', framework: 'f', supports: () => true, collectFacts: () => [] });
    registry.clear();

    expect(registry.getAdapters()).toHaveLength(0);
    expect(registry.getAdapter('a')).toBeUndefined();
  });
});

describe('Unknown annotation handling', () => {
  it('should silently ignore unsupported annotations and return no facts', () => {
    const node = makeNode({
      decorators: ['@DefinitelyNotSpring', '@AlsoUnknown'],
    });

    expect(springAnnotationsAdapter.supports(node, mockContext)).toBe(false);
    expect(() => springAnnotationsAdapter.collectFacts(node, mockContext)).not.toThrow();
    expect(springAnnotationsAdapter.collectFacts(node, mockContext)).toHaveLength(0);
  });

  it('should not throw when a node has no decorators', () => {
    const node = makeNode({ decorators: undefined });

    expect(springAnnotationsAdapter.supports(node, mockContext)).toBe(false);
    expect(() => springAnnotationsAdapter.collectFacts(node, mockContext)).not.toThrow();
    expect(springAnnotationsAdapter.collectFacts(node, mockContext)).toHaveLength(0);
  });
});

describe('RuleBasedAdapter', () => {
  class TestRuleBasedAdapter implements RuleBasedAdapter {
    id = 'rule-based';
    framework = 'custom';
    private rules: RuleBasedAdapterRule[] = [];

    registerRule(rule: RuleBasedAdapterRule): void {
      this.rules.push(rule);
    }

    supports(node: Node, _context: ArchitectureContext): boolean {
      if (!node.decorators || node.decorators.length === 0) return false;
      return node.decorators.some(decorator => {
        const name = decorator.replace(/^@/, '').split('.').pop() ?? decorator;
        return this.rules.some(rule => rule.annotation === name);
      });
    }

    collectFacts(node: Node, _context: ArchitectureContext): AnnotationFact[] {
      if (!node.decorators) return [];
      const facts: AnnotationFact[] = [];

      for (const decorator of node.decorators) {
        const name = decorator.replace(/^@/, '').split('.').pop() ?? decorator;
        for (const rule of this.rules) {
          if (rule.annotation === name) {
            facts.push({
              adapterId: this.id,
              nodeId: node.id,
              kind: 'bean',
              name: node.name,
              metadata: { annotation: name, ...rule.produces },
              confidence: 0.8,
              evidence: [],
            });
          }
        }
      }

      return facts;
    }

    assignFacet(fact: AnnotationFact, _context: ArchitectureContext): Partial<NodeArchitectureFacet>[] {
      const role = (fact.metadata?.role as string) || 'Custom';
      const layer = (fact.metadata?.layer as any) || 'unknown';
      return [{ nodeId: fact.nodeId, facetName: this.id, role, layer, confidence: 0.8, evidence: [] }];
    }

    synthesizeEdges(fact: AnnotationFact, _context: ArchitectureContext): SynthesizedEdge[] {
      return [];
    }
  }

  it('should register a custom rule and detect a matching annotation', () => {
    const adapter = new TestRuleBasedAdapter();
    adapter.registerRule({
      adapterId: 'rule-based',
      annotation: 'MyCustomBean',
      produces: { role: 'CustomBean', layer: 'business', tags: ['custom'] },
    });

    const node = makeNode({ decorators: ['@MyCustomBean'] });

    expect(adapter.supports(node, mockContext)).toBe(true);

    const facts = adapter.collectFacts(node, mockContext);
    expect(facts).toHaveLength(1);
    expect(facts[0].kind).toBe('bean');
    expect(facts[0].metadata?.role).toBe('CustomBean');
    expect(facts[0].metadata?.layer).toBe('business');
  });

  it('should ignore annotations that do not match a registered rule', () => {
    const adapter = new TestRuleBasedAdapter();
    adapter.registerRule({
      adapterId: 'rule-based',
      annotation: 'MyCustomBean',
      produces: { role: 'CustomBean', layer: 'business' },
    });

    const node = makeNode({ decorators: ['@SomeOtherAnnotation'] });

    expect(adapter.supports(node, mockContext)).toBe(false);
    expect(adapter.collectFacts(node, mockContext)).toHaveLength(0);
  });

  it('should support multiple independent rules', () => {
    const adapter = new TestRuleBasedAdapter();
    adapter.registerRule({ adapterId: 'rule-based', annotation: 'Alpha', produces: { role: 'AlphaRole' } });
    adapter.registerRule({ adapterId: 'rule-based', annotation: 'Beta', produces: { role: 'BetaRole' } });

    const node = makeNode({ decorators: ['@Alpha', '@Beta'] });

    const facts = adapter.collectFacts(node, mockContext);
    expect(facts).toHaveLength(2);
    const roles = facts.map(f => f.metadata?.role);
    expect(roles).toContain('AlphaRole');
    expect(roles).toContain('BetaRole');
  });

  it('should not affect core adapters when rules are registered', () => {
    const adapter = new TestRuleBasedAdapter();
    adapter.registerRule({ adapterId: 'rule-based', annotation: 'Service', produces: { role: 'CustomService' } });

    const node = makeNode({ decorators: ['@Service'] });

    const customFacts = adapter.collectFacts(node, mockContext);
    expect(customFacts).toHaveLength(1);
    expect(customFacts[0].metadata?.role).toBe('CustomService');

    const springFacts = springAnnotationsAdapter.collectFacts(node, mockContext);
    expect(springFacts).toHaveLength(1);
    expect(springFacts[0].metadata?.role).toBe('Service');

    const customFacet = adapter.assignFacet(customFacts[0], mockContext)[0];
    const springFacet = springAnnotationsAdapter.assignFacet!(springFacts[0], mockContext)[0];
    expect(customFacet.role).toBe('CustomService');
    expect(springFacet.role).toBe('Service');
  });
});

describe('Adapter singleton exports', () => {
  it('should export singleton instances for every annotation adapter', () => {
    const adapters: AnnotationAdapter[] = [
      springAnnotationsAdapter,
      mybatisAnnotationsAdapter,
      springWebAdapter,
      springScheduleEventAdapter,
      lombokAdapter,
      mapStructAdapter,
      validationAdapter,
      openApiAdapter,
      ruleBasedAdapter,
    ];

    const ids = new Set<string>();
    for (const adapter of adapters) {
      expect(adapter).toBeDefined();
      expect(typeof adapter.id).toBe('string');
      expect(typeof adapter.framework).toBe('string');
      expect(typeof adapter.supports).toBe('function');
      expect(typeof adapter.collectFacts).toBe('function');
      expect(ids.has(adapter.id)).toBe(false);
      ids.add(adapter.id);
    }

    expect(adapters).toHaveLength(ids.size);
  });

  it('should detect supported annotations on each singleton adapter', () => {
    const cases: { adapter: AnnotationAdapter; decorator: string; kind: Node['kind'] }[] = [
      { adapter: springAnnotationsAdapter, decorator: '@Service', kind: 'class' },
      { adapter: mybatisAnnotationsAdapter, decorator: '@Select("SELECT 1")', kind: 'method' },
      { adapter: springWebAdapter, decorator: '@GetMapping("/hello")', kind: 'method' },
      { adapter: springScheduleEventAdapter, decorator: 'Scheduled', kind: 'method' },
      { adapter: lombokAdapter, decorator: 'Getter', kind: 'class' },
      { adapter: mapStructAdapter, decorator: '@Mapper', kind: 'interface' },
      { adapter: validationAdapter, decorator: '@Valid', kind: 'parameter' },
      { adapter: openApiAdapter, decorator: '@Operation("summary")', kind: 'method' },
    ];

    for (const { adapter, decorator, kind } of cases) {
      const node = makeNode({ decorators: [decorator], kind });
      expect(adapter.supports(node, mockContext)).toBe(true);
    }
  });
});
