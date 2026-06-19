import { describe, expect, it } from 'vitest';

import { FeignRequestResponseType } from '../src/feign-dto';
import type { CodegraphEdgeLike, CodegraphNodeLike, SpringKgEdge, SpringKgNode } from '../src/shared-types';
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
    decorators: overrides.decorators ?? ['@FeignClient(name="user-service")'],
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
  const id = overrides.id ?? 'method-create';
  const name = overrides.name ?? 'create';

  return {
    id,
    kind: 'method',
    name,
    qualifiedName: overrides.qualifiedName ?? `com.example.UserClient.${name}`,
    filePath: overrides.filePath ?? 'src/UserClient.java',
    language: overrides.language ?? 'java',
    startLine: overrides.startLine ?? 3,
    endLine: overrides.endLine ?? 8,
    decorators: overrides.decorators ?? ['@PostMapping("/users")'],
    signature: overrides.signature,
    returnType: overrides.returnType ?? 'UserDto',
    visibility: overrides.visibility,
    isExported: overrides.isExported,
    isStatic: overrides.isStatic,
    isAbstract: overrides.isAbstract,
    updatedAt: overrides.updatedAt,
    metadata: overrides.metadata ?? { returnTypeNodeId: 'dto-user' },
  };
}

function makeParameterNode(overrides: Partial<CodegraphNodeLike> = {}): CodegraphNodeLike {
  const id = overrides.id ?? 'param-request';
  const name = overrides.name ?? 'req';

  return {
    id,
    kind: 'parameter',
    name,
    qualifiedName: overrides.qualifiedName ?? `com.example.UserClient.create.${name}`,
    filePath: overrides.filePath ?? 'src/UserClient.java',
    language: overrides.language ?? 'java',
    startLine: overrides.startLine ?? 3,
    endLine: overrides.endLine ?? 3,
    decorators: overrides.decorators ?? ['@RequestBody'],
    signature: overrides.signature,
    returnType: overrides.returnType,
    visibility: overrides.visibility,
    isExported: overrides.isExported,
    isStatic: overrides.isStatic,
    isAbstract: overrides.isAbstract,
    updatedAt: overrides.updatedAt,
    metadata: overrides.metadata ?? { typeName: 'CreateUserRequest', typeNodeId: 'dto-create-user-request' },
  };
}

async function enhance(nodes: CodegraphNodeLike[], edges: CodegraphEdgeLike[] = []) {
  const resolver = new FeignRequestResponseType();
  return resolver.enhance({ codegraphNodes: nodes, codegraphEdges: edges, changedFiles: [], cg: makeCodegraphStub() });
}

function findDtoNodes(nodes: readonly SpringKgNode[]): SpringKgNode[] {
  return nodes.filter((node) => node.kind === 'dto');
}

function findUsesDtoEdges(edges: readonly SpringKgEdge[]): SpringKgEdge[] {
  return edges.filter((edge) => edge.kind === 'USES_DTO');
}

describe('FeignRequestResponseType', () => {
  it('extracts request and response dto bindings from a feign method signature', async () => {
    const clientNode = makeInterfaceNode();
    const methodNode = makeMethodNode();
    const requestParam = makeParameterNode();

    const result = await enhance(
      [clientNode, methodNode, requestParam],
      [
        { source: clientNode.id, target: methodNode.id, kind: 'contains' },
        { source: methodNode.id, target: requestParam.id, kind: 'contains' },
      ],
    );

    const dtoNodes = findDtoNodes(result.nodes);
    const usesDtoEdges = findUsesDtoEdges(result.edges);
    const requestDto = dtoNodes.find((node) => node.metadata?.role === 'request');
    const responseDto = dtoNodes.find((node) => node.metadata?.role === 'response');

    expect(result.symbolsAdded).toBe(2);
    expect(result.edgesAdded).toBe(2);
    expect(result.byKind.dto).toBe(2);
    expect(requestDto).toMatchObject({
      kind: 'dto',
      codegraphNodeId: 'dto-create-user-request',
      name: 'CreateUserRequest',
      metadata: {
        fromFeignMethodId: methodNode.id,
        role: 'request',
        typeName: 'CreateUserRequest',
      },
      confidence: 0.9,
    });
    expect(responseDto).toMatchObject({
      kind: 'dto',
      codegraphNodeId: 'dto-user',
      name: 'UserDto',
      metadata: {
        fromFeignMethodId: methodNode.id,
        role: 'response',
        typeName: 'UserDto',
      },
      confidence: 0.9,
    });
    expect(usesDtoEdges).toHaveLength(2);
    expect(usesDtoEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: methodNode.id,
          targetId: requestDto?.id,
          kind: 'USES_DTO',
          confidence: 0.9,
          metadata: { role: 'request' },
        }),
        expect.objectContaining({
          sourceId: methodNode.id,
          targetId: responseDto?.id,
          kind: 'USES_DTO',
          confidence: 0.9,
          metadata: { role: 'response' },
        }),
      ]),
    );
  });
});
