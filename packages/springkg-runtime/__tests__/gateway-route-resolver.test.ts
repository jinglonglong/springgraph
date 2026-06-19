import { describe, expect, it, beforeEach } from 'vitest';

import { GatewayRouteResolver } from '../src/gateway-route-resolver';

function createMockKg() {
  const symbols: any[] = [];
  const edges: any[] = [];

  return {
    symbols,
    edges,
    async upsertSymbol(node: any) {
      const idx = symbols.findIndex((s) => s.id === node.id);
      if (idx >= 0) symbols[idx] = node;
      else symbols.push(node);
    },
    async upsertEdge(edge: any) {
      const idx = edges.findIndex((e) => e.id === edge.id);
      if (idx >= 0) edges[idx] = edge;
      else edges.push(edge);
    },
  };
}

describe('GatewayRouteResolver', () => {
  let resolver: GatewayRouteResolver;
  let kg: ReturnType<typeof createMockKg>;

  beforeEach(() => {
    resolver = new GatewayRouteResolver();
    kg = createMockKg();
  });

  it('extracts route with uri and id', () => {
    resolver.addRoute({
      id: 'user-route',
      uri: 'http://user-service:8080',
      sourceFile: 'gateway.yml',
    });

    const result = resolver.resolve();
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].kind).toBe('gateway_route');
    expect(result.symbols[0].name).toBe('user-route');
    expect(result.symbols[0].qualifiedName).toBe('http://user-service:8080');
  });

  it('captures predicates and filters in metadata', () => {
    resolver.addRoute({
      id: 'api-route',
      uri: 'lb://api-service',
      predicates: ['Path=/api/**'],
      filters: ['StripPrefix=1'],
      sourceFile: 'gateway.yml',
    });

    const result = resolver.resolve();
    expect(result.symbols[0].metadata?.predicates).toEqual(['Path=/api/**']);
    expect(result.symbols[0].metadata?.filters).toEqual(['StripPrefix=1']);
  });

  it('handles multiple routes', () => {
    resolver.addRoute({ id: 'route-a', uri: 'http://a.com' });
    resolver.addRoute({ id: 'route-b', uri: 'http://b.com' });
    resolver.addRoute({ id: 'route-c', uri: 'http://c.com' });

    const result = resolver.resolve();
    expect(result.symbols).toHaveLength(3);
  });

  it('updates existing route when added again with same id', () => {
    resolver.addRoute({
      id: 'dynamic-route',
      uri: 'http://old.com',
    });
    resolver.addRoute({
      id: 'dynamic-route',
      uri: 'http://new.com',
    });

    const result = resolver.resolve();
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].qualifiedName).toBe('http://new.com');
  });
});
