import { describe, expect, it } from 'vitest';

import { FeignProviderBridge } from '../src/feign-provider-bridge';
import type { SpringgraphNodeLike } from '../src/shared-types';
import { makeSpringgraphStub } from '../src/shared-types';

function makeNode(overrides: Partial<SpringgraphNodeLike> & Pick<SpringgraphNodeLike, 'id' | 'kind' | 'name'>): SpringgraphNodeLike {
  return {
    id: overrides.id,
    kind: overrides.kind,
    name: overrides.name,
    qualifiedName: overrides.qualifiedName ?? overrides.name,
    filePath: overrides.filePath ?? `src/${overrides.name}.java`,
    language: overrides.language ?? 'java',
    startLine: overrides.startLine ?? 1,
    endLine: overrides.endLine ?? 1,
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

async function enhance(nodes: SpringgraphNodeLike[]) {
  const resolver = new FeignProviderBridge();
  return resolver.enhance({ springgraphNodes: nodes, springgraphEdges: [], changedFiles: [], cg: makeSpringgraphStub() });
}

describe('FeignProviderBridge', () => {
  it('links same-monorepo exact feign methods to matching endpoints', async () => {
    const feignMethod = makeNode({
      id: 'feign-method-1',
      kind: 'feign_method',
      name: 'getUser',
      metadata: {
        feignPath: '/users/{id}',
        httpMethod: 'GET',
        targetServiceName: 'user-svc',
      },
    });
    const endpoint = makeNode({
      id: 'endpoint-1',
      kind: 'endpoint',
      name: 'GET /users/{id}',
      metadata: {
        httpMethod: 'GET',
        serviceHint: 'user-svc',
      },
    });

    const result = await enhance([feignMethod, endpoint]);

    expect(result.symbolsAdded).toBe(0);
    expect(result.edgesAdded).toBe(1);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      sourceId: 'feign-method-1',
      targetId: 'endpoint-1',
      kind: 'TARGETS_ENDPOINT',
      confidence: 1,
      metadata: {
        matchRule: 'same-monorepo-exact',
      },
    });
  });

  it('falls back to cross-service name matching when only the path aligns', async () => {
    const feignMethod = makeNode({
      id: 'feign-method-2',
      kind: 'feign_method',
      name: 'listOrders',
      metadata: {
        feignPath: '/orders',
        httpMethod: 'POST',
        targetServiceName: 'order-svc',
      },
    });
    const endpoint = makeNode({
      id: 'endpoint-2',
      kind: 'endpoint',
      name: 'GET /orders',
      metadata: {
        httpMethod: 'GET',
        serviceHint: 'inventory-svc',
      },
    });

    const result = await enhance([feignMethod, endpoint]);

    expect(result.symbolsAdded).toBe(0);
    expect(result.edgesAdded).toBe(1);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      sourceId: 'feign-method-2',
      targetId: 'endpoint-2',
      kind: 'TARGETS_ENDPOINT',
      confidence: 0.5,
      metadata: {
        matchRule: 'cross-service-name',
        targetServiceName: 'order-svc',
      },
    });
  });
});
