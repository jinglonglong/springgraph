import { describe, expect, it } from 'vitest';

import type { SpringKgEdge, SpringKgNode } from '@colbymchenry/springkg-shared';

import { CommunityBuilder } from '../community-builder.js';

function node(id: string, kind: SpringKgNode['kind'], qualifiedName: string, filePath?: string): SpringKgNode {
  return {
    id,
    kind,
    springgraphNodeId: `cg:${id}`,
    name: qualifiedName.split('.').at(-1),
    qualifiedName,
    filePath: filePath ?? `src/${qualifiedName.replace(/\./g, '/')}.java`,
    metadata: {},
    confidence: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

function edge(id: string, sourceId: string, targetId: string, kind: SpringKgEdge['kind'] = 'CALLS'): SpringKgEdge {
  return { id, sourceId, targetId, kind, confidence: 1, createdAt: 1 };
}

describe('CommunityBuilder', () => {
  it('builds one community per connected component', () => {
    const builder = new CommunityBuilder();
    const nodes = [
      node('a', 'controller', 'com.example.order.OrderController'),
      node('b', 'service', 'com.example.order.OrderService'),
      node('c', 'mapper', 'com.example.order.OrderMapper'),
      node('d', 'service', 'com.example.user.UserService'),
      node('e', 'controller', 'com.example.user.UserController'),
      node('f', 'service', 'com.example.billing.BillingService'),
      node('g', 'service', 'com.example.audit.AuditService'),
      node('h', 'service', 'com.example.notify.NotifyService'),
    ];
    const edges = [
      edge('1', 'a', 'b'),
      edge('2', 'b', 'c'),
      edge('3', 'd', 'e'),
    ];

    const communities = builder.build(nodes, edges);
    expect(communities).toHaveLength(5);
    expect(communities.map((community) => community.memberCount).sort((a, b) => b - a)).toEqual([3, 2, 1, 1, 1]);
  });

  it('uses package affinity to split cross-linked packages into separate communities', () => {
    const builder = new CommunityBuilder();
    const nodes = [
      node('o1', 'controller', 'com.example.order.OrderController'),
      node('o2', 'service', 'com.example.order.OrderService'),
      node('o3', 'mapper', 'com.example.order.OrderMapper'),
      node('o4', 'service', 'com.example.order.cancel.CancelService'),
      node('o5', 'component', 'com.example.order.cancel.CancelAssembler'),
      node('u1', 'controller', 'com.example.user.UserController'),
      node('u2', 'service', 'com.example.user.UserService'),
    ];
    const edges = [
      edge('1', 'o1', 'o2'),
      edge('2', 'o2', 'o3'),
      edge('3', 'o3', 'o4'),
      edge('4', 'o4', 'o5'),
      edge('5', 'u1', 'u2'),
      edge('6', 'o2', 'u2'),
      edge('7', 'o1', 'u1'),
      edge('8', 'o4', 'u2'),
    ];

    const communities = builder.build(nodes, edges);

    expect(communities.length).toBeGreaterThanOrEqual(2);
    expect(communities.map((community) => community.label)).toContain('order');
    expect(communities.map((community) => community.label)).toContain('user');
  });

  it('filters denylisted node kinds and utility names out of communities', () => {
    const builder = new CommunityBuilder();
    const nodes = [
      node('controller', 'controller', 'com.example.order.OrderController'),
      node('service', 'service', 'com.example.order.OrderService'),
      node('parameter', 'feature_community_member' as SpringKgNode['kind'], 'com.example.order.OrderService.value'),
      node('result', 'component', 'com.example.shared.CommonResult'),
    ];
    const edges = [
      edge('1', 'controller', 'service'),
      edge('2', 'service', 'result'),
      edge('3', 'service', 'parameter'),
    ];

    const communities = builder.build(nodes, edges, { denylistKinds: ['feature_community_member'], denylistNames: ['CommonResult'] });

    expect(communities).toHaveLength(1);
    expect(communities[0]?.memberSpringNodeIds).toEqual(['controller', 'service']);
  });
});
