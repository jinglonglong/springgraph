import { describe, expect, it } from 'vitest';

import { FeignResolver } from '../src/feign-resolver';
import type { CodegraphEdgeLike, CodegraphNodeLike, SpringKgNode } from '../src/shared-types';
import { makeCodegraphStub } from '../src/shared-types';

function makeInterfaceNode(overrides: Partial<CodegraphNodeLike> = {}): CodegraphNodeLike {
  const id = overrides.id ?? 'feign-client-1';
  const name = overrides.name ?? 'UserClient';

  return {
    id,
    kind: 'interface',
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

function makeMethodNode(overrides: Partial<CodegraphNodeLike> = {}): CodegraphNodeLike {
  const id = overrides.id ?? 'method-1';
  const name = overrides.name ?? 'list';

  return {
    id,
    kind: 'method',
    name,
    qualifiedName: overrides.qualifiedName ?? `com.example.UserClient.${name}`,
    filePath: overrides.filePath ?? 'src/UserClient.java',
    language: overrides.language ?? 'java',
    startLine: overrides.startLine ?? 3,
    endLine: overrides.endLine ?? 8,
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
  const name = overrides.name ?? 'filter';

  return {
    id,
    kind: 'parameter',
    name,
    qualifiedName: overrides.qualifiedName ?? `com.example.UserClient.list.${name}`,
    filePath: overrides.filePath ?? 'src/UserClient.java',
    language: overrides.language ?? 'java',
    startLine: overrides.startLine ?? 3,
    endLine: overrides.endLine ?? 3,
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

async function enhance(nodes: CodegraphNodeLike[], edges: CodegraphEdgeLike[] = []) {
  const resolver = new FeignResolver();
  return resolver.enhance({ codegraphNodes: nodes, codegraphEdges: edges, changedFiles: [], cg: makeCodegraphStub() });
}

function findNode(nodes: SpringKgNode[], kind: SpringKgNode['kind']): SpringKgNode {
  const node = nodes.find((candidate) => candidate.kind === kind);

  if (!node) {
    throw new Error(`Expected node of kind ${kind}`);
  }

  return node;
}

describe('FeignResolver', () => {
  it.each([
    ['@FeignClient(name="user-service")', 'user-service', 1],
    ['@FeignClient(value="order-svc")', 'order-svc', 1],
    ['@FeignClient(contextId="legacyX")', 'legacyX', 0.7],
  ] satisfies Array<[string, string, number]>)('resolves target service from %s', async (decorator, expectedService, expectedConfidence) => {
    const result = await enhance([makeInterfaceNode({ decorators: [decorator] })]);

    const feignClient = findNode(result.nodes, 'feign_client');
    const remoteService = findNode(result.nodes, 'remote_service');

    expect(result.symbolsAdded).toBe(2);
    expect(result.edgesAdded).toBe(0);
    expect(result.byKind.feign_client).toBe(1);
    expect(result.byKind.remote_service).toBe(1);
    expect(feignClient.confidence).toBe(expectedConfidence);
    expect(feignClient.metadata?.targetServiceName).toBe(expectedService);
    expect(remoteService.name).toBe(expectedService);
    expect(remoteService.metadata?.targetServiceName).toBe(expectedService);
  });

  it('captures feign client path metadata', async () => {
    const result = await enhance([
      makeInterfaceNode({ decorators: ['@FeignClient(name="x", path="/api/v2")'] }),
    ]);

    const feignClient = findNode(result.nodes, 'feign_client');

    expect(feignClient.metadata).toMatchObject({
      targetServiceName: 'x',
      path: '/api/v2',
    });
  });

  it('treats explicit urls as direct-connect remote services', async () => {
    const result = await enhance([
      makeInterfaceNode({ decorators: ['@FeignClient(name="x", url="http://static.example.com/x")'] }),
    ]);

    const feignClient = findNode(result.nodes, 'feign_client');
    const remoteService = findNode(result.nodes, 'remote_service');

    expect(feignClient.metadata).toMatchObject({
      targetServiceName: 'x',
      url: 'http://static.example.com/x',
      isDirectConnect: true,
    });
    expect(remoteService.confidence).toBe(1);
    expect(remoteService.metadata).toMatchObject({
      targetServiceName: 'x',
      url: 'http://static.example.com/x',
      isDirectConnect: true,
    });
  });

  it('scans mapped interface methods and emits BELONGS_TO edges', async () => {
    const clientNode = makeInterfaceNode({
      id: 'client-1',
      decorators: ['@FeignClient(name="user-service")'],
    });
    const methodNode = makeMethodNode({
      id: 'method-1',
      decorators: ['@GetMapping("/list")'],
      returnType: 'UserDto[]',
    });
    const parameterNode = makeParameterNode({
      id: 'param-1',
      metadata: { typeName: 'FilterDto' },
    });

    const result = await enhance(
      [clientNode, methodNode, parameterNode],
      [
        { source: clientNode.id, target: methodNode.id, kind: 'contains' },
        { source: methodNode.id, target: parameterNode.id, kind: 'contains' },
      ],
    );

    const feignClient = findNode(result.nodes, 'feign_client');
    const feignMethod = findNode(result.nodes, 'feign_method');

    expect(result.byKind.feign_client).toBe(1);
    expect(result.byKind.remote_service).toBe(1);
    expect(result.byKind.feign_method).toBe(1);
    expect(feignMethod.metadata).toMatchObject({
      feignPath: '/list',
      httpMethod: 'GET',
      returnType: 'UserDto[]',
      paramTypes: ['FilterDto'],
      targetServiceName: 'user-service',
    });
    expect(feignMethod.confidence).toBe(1);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      sourceId: feignMethod.id,
      targetId: feignClient.id,
      kind: 'BELONGS_TO',
      confidence: 1,
    });
  });
});
