import { describe, expect, it } from 'vitest';

import { EndpointResolver } from '../src/endpoint-resolver';
import type { CodegraphEdgeLike, CodegraphNodeLike, SpringKgEdge, SpringKgNode } from '../src/shared-types';
import { makeCodegraphStub } from '../src/shared-types';

function makeClassNode(overrides: Partial<CodegraphNodeLike> = {}): CodegraphNodeLike {
  const id = overrides.id ?? 'controller-1';
  const name = overrides.name ?? 'UserController';

  return {
    id,
    kind: 'class',
    name,
    qualifiedName: overrides.qualifiedName ?? `com.example.${name}`,
    filePath: overrides.filePath ?? `src/${name}.java`,
    language: overrides.language ?? 'java',
    startLine: overrides.startLine ?? 1,
    endLine: overrides.endLine ?? 50,
    decorators: overrides.decorators ?? ['@RestController'],
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

function makeMethodNode(overrides: Partial<CodegraphNodeLike> = {}): CodegraphNodeLike {
  const id = overrides.id ?? 'method-1';
  const name = overrides.name ?? 'getUser';

  return {
    id,
    kind: 'method',
    name,
    qualifiedName: overrides.qualifiedName ?? `com.example.UserController.${name}`,
    filePath: overrides.filePath ?? 'src/UserController.java',
    language: overrides.language ?? 'java',
    startLine: overrides.startLine ?? 5,
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

function makeParameterNode(overrides: Partial<CodegraphNodeLike> = {}): CodegraphNodeLike {
  const id = overrides.id ?? 'param-1';
  const name = overrides.name ?? 'value';

  return {
    id,
    kind: 'parameter',
    name,
    qualifiedName: overrides.qualifiedName ?? `com.example.UserController.getUser.${name}`,
    filePath: overrides.filePath ?? 'src/UserController.java',
    language: overrides.language ?? 'java',
    startLine: overrides.startLine ?? 6,
    endLine: overrides.endLine ?? 6,
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

async function enhance(nodes: CodegraphNodeLike[], edges: CodegraphEdgeLike[] = []) {
  const resolver = new EndpointResolver();
  return resolver.enhance({ codegraphNodes: nodes, codegraphEdges: edges, changedFiles: [], cg: makeCodegraphStub() });
}

function findHandledBy(edges: readonly SpringKgEdge[]) {
  return edges.filter((edge) => edge.kind === 'HANDLED_BY');
}

function findCalls(edges: readonly SpringKgEdge[]) {
  return edges.filter((edge) => edge.kind === 'CALLS');
}

function asEndpoint(node: SpringKgNode | undefined): SpringKgNode {
  expect(node).toBeDefined();
  return node as SpringKgNode;
}

describe('EndpointResolver', () => {
  it('does not emit an endpoint for a class-level RequestMapping without a method mapping', async () => {
    const controller = makeClassNode({ decorators: ['@RestController', '@RequestMapping("/api/v1")'] });
    const method = makeMethodNode({ decorators: [] });
    const result = await enhance(
      [controller, method],
      [{ source: controller.id, target: method.id, kind: 'contains' }],
    );

    expect(result.symbolsAdded).toBe(0);
    expect(result.edgesAdded).toBe(0);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it('emits a GET endpoint from a method-level GetMapping without class mapping', async () => {
    const controller = makeClassNode();
    const method = makeMethodNode({
      decorators: ['@GetMapping("/users/{id}")'],
      metadata: { returnTypeNodeId: 'dto-user' },
    });
    const result = await enhance(
      [controller, method],
      [
        { source: controller.id, target: method.id, kind: 'contains' },
        { source: method.id, target: 'service-1', kind: 'calls' },
      ],
    );

    expect(result.symbolsAdded).toBe(1);
    expect(result.byKind.endpoint).toBe(1);
    const endpoint = asEndpoint(result.nodes[0]);
    expect(endpoint.name).toBe('GET /users/{id}');
    expect(endpoint.metadata).toMatchObject({
      httpMethod: 'GET',
      methodPath: '/users/{id}',
      controllerCodegraphNodeId: controller.id,
      responseDtoCodegraphNodeId: 'dto-user',
    });
    expect(findHandledBy(result.edges)).toHaveLength(1);
    expect(findHandledBy(result.edges)[0]).toMatchObject({
      sourceId: endpoint.id,
      targetId: method.id,
      kind: 'HANDLED_BY',
      confidence: 1,
    });
    expect(findCalls(result.edges)).toHaveLength(1);
    expect(findCalls(result.edges)[0]).toMatchObject({
      sourceId: method.id,
      targetId: 'service-1',
      kind: 'CALLS',
      confidence: 1,
    });
  });

  it('merges class-level and method-level mappings into one normalized path', async () => {
    const controller = makeClassNode({ decorators: ['@RestController', '@RequestMapping("/api")'] });
    const method = makeMethodNode({ decorators: ['@GetMapping("/users")'] });
    const result = await enhance(
      [controller, method],
      [{ source: controller.id, target: method.id, kind: 'contains' }],
    );

    expect(result.symbolsAdded).toBe(1);
    const endpoint = asEndpoint(result.nodes[0]);
    expect(endpoint.name).toBe('GET /api/users');
    expect(endpoint.metadata).toMatchObject({
      httpMethod: 'GET',
      classPath: '/api',
      methodPath: '/users',
    });
  });

  it('fans out RequestMapping arrays into one endpoint per path', async () => {
    const controller = makeClassNode();
    const method = makeMethodNode({
      decorators: ['@RequestMapping({ value: ["/a", "/b"], method: RequestMethod.GET })'],
    });
    const result = await enhance(
      [controller, method],
      [{ source: controller.id, target: method.id, kind: 'contains' }],
    );

    expect(result.symbolsAdded).toBe(2);
    expect(result.nodes.map((node) => node.name).sort()).toEqual(['GET /a', 'GET /b']);
    expect(findHandledBy(result.edges)).toHaveLength(2);
  });

  it('extracts request params and response DTO metadata from a search endpoint', async () => {
    const controller = makeClassNode();
    const method = makeMethodNode({
      id: 'method-search',
      name: 'search',
      decorators: ['@GetMapping("/search")'],
      metadata: { returnTypeNodeId: 'dto-user-list' },
    });
    const queryParam = makeParameterNode({
      id: 'param-q',
      name: 'query',
      decorators: ['@RequestParam("q")'],
      metadata: { typeName: 'String' },
    });
    const limitParam = makeParameterNode({
      id: 'param-limit',
      name: 'limit',
      decorators: ['@RequestParam(name="limit")'],
      metadata: { typeName: 'int' },
    });
    const result = await enhance(
      [controller, method, queryParam, limitParam],
      [
        { source: controller.id, target: method.id, kind: 'contains' },
        { source: method.id, target: queryParam.id, kind: 'contains' },
        { source: method.id, target: limitParam.id, kind: 'contains' },
      ],
    );

    expect(result.symbolsAdded).toBe(1);
    const endpoint = asEndpoint(result.nodes[0]);
    expect(endpoint.name).toBe('GET /search');
    expect(endpoint.metadata).toMatchObject({
      httpMethod: 'GET',
      methodPath: '/search',
      responseDtoCodegraphNodeId: 'dto-user-list',
    });
    expect(endpoint.metadata?.params).toEqual([
      { name: 'q', kind: 'RequestParam', typeName: 'String', required: true },
      { name: 'limit', kind: 'RequestParam', typeName: 'int', required: true },
    ]);
  });
});
