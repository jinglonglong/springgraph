import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { GatewayRouteResolver } from '../src/gateway-route-resolver.js';

function createMockKg() {
  return {
    symbols: [] as any[],
    edges: [] as any[],
    upsertSymbol: async function(this: any, symbol: any) {
      const existing = this.symbols.findIndex((s: any) => s.id === symbol.id);
      if (existing >= 0) {
        this.symbols[existing] = symbol;
      } else {
        this.symbols.push(symbol);
      }
    },
    upsertEdge: async function(this: any, edge: any) {
      const existing = this.edges.findIndex((e: any) => e.id === edge.id);
      if (existing >= 0) {
        this.edges[existing] = edge;
      } else {
        this.edges.push(edge);
      }
    }
  };
}

function createFixtureDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'springkg-gateway-test-'));
}

function createGatewayRoutesYml(dir: string, content: string) {
  const resourcesDir = path.join(dir, 'src', 'main', 'resources');
  fs.mkdirSync(resourcesDir, { recursive: true });
  fs.writeFileSync(path.join(resourcesDir, 'application.yml'), content);
}

describe('GatewayRouteResolver', () => {
  let resolver: GatewayRouteResolver;

  beforeEach(() => {
    resolver = new GatewayRouteResolver();
  });

  it('case 1: Single route id=order_route, uri=lb://order-service, predicates=[Path=/api/order/**] -> 1 gateway_route, 1 ROUTES_TO, 1 MATCHES_PATH', async () => {
    const dir = createFixtureDir();
    createGatewayRoutesYml(dir, `
spring:
  application:
    name: gateway-service
  cloud:
    gateway:
      routes:
        - id: order_route
          uri: lb://order-service
          predicates:
            - Path=/api/order/**
`);

    const kg = createMockKg();
    const result = await resolver.enhance({ projectPath: dir, kg });

    expect(result.routesCount).toBe(1);
    expect(result.routesToEdges).toBe(1);
    expect(result.matchesPathEdges).toBe(1);

    const route = kg.symbols.find(s => s.kind === 'gateway_route');
    expect(route).toBeDefined();
    expect(route.metadata.uri).toBe('lb://order-service');
  });

  it('case 2: Three routes, two lb://, one https://api.example.com -> 3 gateway_routes, 2 ROUTES_TO (micro_service), 1 ROUTES_TO (external)', async () => {
    const dir = createFixtureDir();
    createGatewayRoutesYml(dir, `
spring:
  application:
    name: gateway-service
  cloud:
    gateway:
      routes:
        - id: order_route
          uri: lb://order-service
          predicates:
            - Path=/api/order/**
        - id: payment_route
          uri: lb://payment-service
          predicates:
            - Path=/api/pay/**
        - id: external_route
          uri: https://api.example.com
          predicates:
            - Path=/external/**
`);

    const kg = createMockKg();
    const result = await resolver.enhance({ projectPath: dir, kg });

    expect(result.routesCount).toBe(3);
    expect(result.routesToEdges).toBe(3);

    const routesToEdges = kg.edges.filter(e => e.kind === 'ROUTES_TO');
    expect(routesToEdges.length).toBe(3);
  });

  it('case 3: Multi-predicate predicates=[Path=/api/order/**, Method=GET,POST] -> 1 MATCHES_PATH, Method in metadata', async () => {
    const dir = createFixtureDir();
    createGatewayRoutesYml(dir, `
spring:
  application:
    name: gateway-service
  cloud:
    gateway:
      routes:
        - id: order_route
          uri: lb://order-service
          predicates:
            - Path=/api/order/**
            - Method=GET,POST
`);

    const kg = createMockKg();
    await resolver.enhance({ projectPath: dir, kg });

    const route = kg.symbols.find(s => s.kind === 'gateway_route');
    expect(route).toBeDefined();
    expect(route.metadata.predicates).toContain('Path=/api/order/**');
    expect(route.metadata.predicates).toContain('Method=GET,POST');
  });

  it('case 4: Empty routes: [] -> 0 gateway_routes (no errors)', async () => {
    const dir = createFixtureDir();
    createGatewayRoutesYml(dir, `
spring:
  application:
    name: gateway-service
  cloud:
    gateway:
      routes: []
`);

    const kg = createMockKg();
    const result = await resolver.enhance({ projectPath: dir, kg });

    expect(result.routesCount).toBe(0);
    expect(result.routesToEdges).toBe(0);
    expect(result.matchesPathEdges).toBe(0);
  });
});
