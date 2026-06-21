import { describe, it, expect, beforeEach } from 'vitest';
import { registerCustomRule, ruleBasedAdapter } from '../src/architecture/adapters/rule-based';
import { AnnotationAdapterRegistry } from '../src/architecture/adapters/types';
import { springAnnotationsAdapter } from '../src/architecture/adapters/spring-annotations';
import { Node } from '../src/types';
import { ArchitectureContext } from '../src/architecture/types';

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

describe('CustomAnnotationRules', () => {
  let registry: AnnotationAdapterRegistry;

  beforeEach(() => {
    registry = new AnnotationAdapterRegistry();
  });

  it('should register custom rules without core changes', () => {
    const customRule = {
      adapterId: 'my-company',
      annotation: 'MyCustomService',
      produces: {
        role: 'CustomService',
        layer: 'business',
        tags: ['custom', 'company-specific'],
      },
    };

    registerCustomRule(customRule);

    // The rule should be registered in the rule-based adapter
    // We can verify this by checking that the adapter supports nodes with the custom annotation
    const node = makeNode({
      decorators: ['@MyCustomService'],
    });

    expect(ruleBasedAdapter.supports(node, mockContext)).toBe(true);
  });

  it('should collect facts for custom annotations', () => {
    const customRule = {
      adapterId: 'my-company',
      annotation: 'MyEventHandler',
      produces: {
        role: 'EventHandler',
        layer: 'business',
        tags: ['event', 'handler'],
      },
    };

    registerCustomRule(customRule);

    const node = makeNode({
      id: 'handler-1',
      name: 'UserEventHandler',
      decorators: ['@MyEventHandler'],
    });

    const facts = ruleBasedAdapter.collectFacts(node, mockContext);
    expect(facts).toHaveLength(1);
    expect(facts[0].kind).toBe('bean');
    expect(facts[0].metadata.role).toBe('EventHandler');
    expect(facts[0].metadata.layer).toBe('business');
    expect(facts[0].metadata.tags).toEqual(['event', 'handler']);
  });

  it('should assign facets for custom annotations', () => {
    const customRule = {
      adapterId: 'my-company',
      annotation: 'MyRepository',
      produces: {
        role: 'CustomRepository',
        layer: 'data',
        tags: ['repository'],
      },
    };

    registerCustomRule(customRule);

    const node = makeNode({
      id: 'repo-1',
      name: 'UserRepository',
      decorators: ['@MyRepository'],
    });

    const facts = ruleBasedAdapter.collectFacts(node, mockContext);
    expect(facts).toHaveLength(1);

    const facets = ruleBasedAdapter.assignFacet(facts[0], mockContext);
    expect(facets).toHaveLength(1);
    expect(facets[0].role).toBe('CustomRepository');
    expect(facets[0].layer).toBe('data');
  });

  it('should handle multiple custom rules from same adapter', () => {
    const rules = [
      {
        adapterId: 'my-company',
        annotation: 'MyService',
        produces: { role: 'Service', layer: 'business' },
      },
      {
        adapterId: 'my-company',
        annotation: 'MyRepo',
        produces: { role: 'Repository', layer: 'data' },
      },
      {
        adapterId: 'my-company',
        annotation: 'MyController',
        produces: { role: 'Controller', layer: 'entry' },
      },
    ];

    rules.forEach(rule => registerCustomRule(rule));

    // Test each rule works independently
    const serviceNode = makeNode({
      decorators: ['@MyService'],
    });
    const repoNode = makeNode({
      decorators: ['@MyRepo'],
    });
    const controllerNode = makeNode({
      decorators: ['@MyController'],
    });

    expect(ruleBasedAdapter.supports(serviceNode, mockContext)).toBe(true);
    expect(ruleBasedAdapter.supports(repoNode, mockContext)).toBe(true);
    expect(ruleBasedAdapter.supports(controllerNode, mockContext)).toBe(true);

    // Each should produce facts with correct metadata
    const serviceFacts = ruleBasedAdapter.collectFacts(serviceNode, mockContext);
    expect(serviceFacts[0].metadata.role).toBe('Service');

    const repoFacts = ruleBasedAdapter.collectFacts(repoNode, mockContext);
    expect(repoFacts[0].metadata.role).toBe('Repository');

    const controllerFacts = ruleBasedAdapter.collectFacts(controllerNode, mockContext);
    expect(controllerFacts[0].metadata.role).toBe('Controller');
  });

  it('should not affect existing adapters when adding custom rules', () => {
    const customRule = {
      adapterId: 'my-company',
      annotation: 'MyCustomAnnotation',
      produces: { role: 'Custom', layer: 'unknown' },
    };

    registerCustomRule(customRule);

    // Existing Spring adapter should still work
    const springNode = makeNode({
      decorators: ['@Service'],
    });

    expect(springAnnotationsAdapter.supports(springNode, mockContext)).toBe(true);
    const facts = springAnnotationsAdapter.collectFacts(springNode, mockContext);
    expect(facts[0].metadata.role).toBe('Service');
  });
});
