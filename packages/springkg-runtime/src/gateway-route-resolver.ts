// packages/springkg-runtime/src/gateway-route-resolver.ts
// Team D: Runtime Asset Layer - Gateway Route Resolver

import type { SpringKgNode, SpringKgEdge } from '@colbymchenry/springkg-shared';

export interface GatewayRouteInput {
  id: string;
  uri: string;
  predicates?: string[];
  filters?: string[];
  sourceFile?: string;
}

export class GatewayRouteResolver {
  private symbols: SpringKgNode[] = [];
  private edges: SpringKgEdge[] = [];

  async upsertSymbol(node: SpringKgNode): Promise<void> {
    const existing = this.symbols.findIndex((s) => s.id === node.id);
    if (existing >= 0) {
      this.symbols[existing] = node;
    } else {
      this.symbols.push(node);
    }
  }

  async upsertEdge(edge: SpringKgEdge): Promise<void> {
    const existing = this.edges.findIndex((e) => e.id === edge.id);
    if (existing >= 0) {
      this.edges[existing] = edge;
    } else {
      this.edges.push(edge);
    }
  }

  addRoute(route: GatewayRouteInput): void {
    const nodeId = `gateway_route:${route.id}`;
    const node: SpringKgNode = {
      id: nodeId,
      kind: 'gateway_route',
      codegraphNodeId: '',
      name: route.id,
      qualifiedName: route.uri,
      filePath: route.sourceFile,
      metadata: {
        uri: route.uri,
        predicates: route.predicates || [],
        filters: route.filters || [],
      },
      confidence: 1.0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.upsertSymbol(node);
  }

  resolve(): { symbols: SpringKgNode[]; edges: SpringKgEdge[] } {
    return { symbols: this.symbols, edges: this.edges };
  }
}
