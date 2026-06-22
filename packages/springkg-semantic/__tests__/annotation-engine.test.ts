import { describe, expect, it } from 'vitest';

import { AnnotationSemanticEngine } from '../src/annotation-engine';
import type { SpringgraphEdgeLike, SpringgraphNodeLike, SpringKgNodeKind } from '../src/shared-types';
import { makeSpringgraphStub } from '../src/shared-types';

function makeClassNode(overrides: Partial<SpringgraphNodeLike> = {}): SpringgraphNodeLike {
  const id = overrides.id ?? 'class-1';
  const name = overrides.name ?? 'DemoType';

  return {
    id,
    kind: 'class',
    name,
    qualifiedName: overrides.qualifiedName ?? `com.example.${name}`,
    filePath: overrides.filePath ?? `src/${name}.java`,
    language: overrides.language ?? 'java',
    startLine: overrides.startLine ?? 1,
    endLine: overrides.endLine ?? 20,
    decorators: overrides.decorators ?? [],
    signature: overrides.signature,
    returnType: overrides.returnType,
    visibility: overrides.visibility,
    isExported: overrides.isExported,
    isStatic: overrides.isStatic,
    isAbstract: overrides.isAbstract,
    updatedAt: overrides.updatedAt,
    metadata: overrides.metadata,
  };
}

function makeInterfaceNode(overrides: Partial<SpringgraphNodeLike> = {}): SpringgraphNodeLike {
  return {
    ...makeClassNode(overrides),
    kind: 'interface',
  };
}

function makeChildNode(overrides: Partial<SpringgraphNodeLike> = {}): SpringgraphNodeLike {
  const id = overrides.id ?? 'child-1';
  const name = overrides.name ?? 'handleRequest';

  return {
    id,
    kind: overrides.kind ?? 'method',
    name,
    qualifiedName: overrides.qualifiedName ?? `com.example.DemoType.${name}`,
    filePath: overrides.filePath ?? 'src/DemoType.java',
    language: overrides.language ?? 'java',
    startLine: overrides.startLine ?? 3,
    endLine: overrides.endLine ?? 8,
    decorators: overrides.decorators,
    signature: overrides.signature,
    returnType: overrides.returnType,
    visibility: overrides.visibility,
    isExported: overrides.isExported,
    isStatic: overrides.isStatic,
    isAbstract: overrides.isAbstract,
    updatedAt: overrides.updatedAt,
    metadata: overrides.metadata,
  };
}

async function enhance(nodes: SpringgraphNodeLike[], edges: SpringgraphEdgeLike[] = []) {
  const engine = new AnnotationSemanticEngine();
  return engine.enhance({ springgraphNodes: nodes, springgraphEdges: edges, changedFiles: [], cg: makeSpringgraphStub() });
}

describe('AnnotationSemanticEngine', () => {
  it.each([
    ['@RestController', 'controller', true],
    ['@Controller', 'controller', true],
    ['@Repository', 'repository', true],
    ['@Component', 'component', true],
    ['@Configuration', 'configuration', false],
    ['@Mapper', 'mapper', false],
  ] satisfies Array<[string, SpringKgNodeKind, boolean]>)
  ('classifies %s as %s', async (decorator, expectedKind, expectedReuse) => {
    const result = await enhance([makeClassNode({ decorators: [decorator] })]);

    expect(result.symbolsAdded).toBe(1);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.kind).toBe(expectedKind);
    expect(result.nodes[0]?.confidence).toBe(expectedReuse ? 1 : 0.9);
    expect(result.byKind[expectedKind]).toBe(1);
  });

  it('classifies @Service as a reusable service and emits BELONGS_TO for contained methods', async () => {
    const serviceNode = makeClassNode({ id: 'service-1', name: 'UserService', decorators: ['@Service'] });
    const methodNode = makeChildNode({ id: 'method-1', name: 'findUser', qualifiedName: 'com.example.UserService.findUser' });
    const result = await enhance(
      [serviceNode, methodNode],
      [{ source: serviceNode.id, target: methodNode.id, kind: 'contains' }],
    );

    expect(result.symbolsAdded).toBe(1);
    expect(result.nodes[0]?.kind).toBe('service');
    expect(result.nodes[0]?.confidence).toBe(1);
    expect(result.edgesAdded).toBe(1);
    expect(result.edges[0]).toMatchObject({
      sourceId: methodNode.id,
      targetId: result.nodes[0]?.id,
      kind: 'BELONGS_TO',
      confidence: 1,
    });
  });

  it('classifies @FeignClient and extracts feignName metadata', async () => {
    const result = await enhance([
      makeInterfaceNode({
        id: 'feign-1',
        name: 'UserClient',
        decorators: ['@FeignClient(name="user-svc")'],
      }),
    ]);

    expect(result.symbolsAdded).toBe(1);
    expect(result.nodes[0]?.kind).toBe('feign_client');
    expect(result.nodes[0]?.confidence).toBe(0.9);
    expect(result.nodes[0]?.metadata).toEqual({ feignName: 'user-svc' });
  });

  it('emits no nodes for a class without Spring decorators', async () => {
    const result = await enhance([makeClassNode({ decorators: ['@CustomThing'] })]);

    expect(result.symbolsAdded).toBe(0);
    expect(result.edgesAdded).toBe(0);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.byKind).toEqual({});
  });
});
