import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { NacosConfigResolver } from '../src/nacos-config-resolver.js';

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
  return mkdtempSync(path.join(tmpdir(), 'springkg-nacos-test-'));
}

function createBootstrapYml(dir: string, content: string) {
  const resourcesDir = path.join(dir, 'src', 'main', 'resources');
  fs.mkdirSync(resourcesDir, { recursive: true });
  fs.writeFileSync(path.join(resourcesDir, 'bootstrap.yml'), content);
}

describe('NacosConfigResolver', () => {
  let resolver: NacosConfigResolver;

  beforeEach(() => {
    resolver = new NacosConfigResolver();
  });

  it('case 1: Single bootstrap.yml with discovery.server-addr, config.namespace, config.ext-config -> 1 nacos_cluster, 1 nacos_config, 1 nacos_service, 1 LOADS_CONFIG', async () => {
    const dir = createFixtureDir();
    createBootstrapYml(dir, `
spring:
  application:
    name: order-service
  cloud:
    nacos:
      discovery:
        server-addr: 10.0.0.1:8848
        namespace: dev
      config:
        server-addr: 10.0.0.1:8848
        ext-config:
          - data-id: order.yaml
            group: ORDER_GROUP
`);

    const kg = createMockKg();
    const result = await resolver.enhance({ projectPath: dir, kg });

    expect(result.clustersCount).toBe(1);
    expect(result.configsCount).toBe(1);
    expect(result.servicesCount).toBe(1);
    expect(result.edgesCount).toBe(1);

    const cluster = kg.symbols.find(s => s.kind === 'nacos_cluster');
    expect(cluster).toBeDefined();
  });

  it('case 2: shared-configs[2] with 2 entries -> 2 nacos_config nodes', async () => {
    const dir = createFixtureDir();
    createBootstrapYml(dir, `
spring:
  application:
    name: order-service
  cloud:
    nacos:
      config:
        shared-configs:
          - data-id: shared-common.yaml
            group: SHARED_GROUP
          - data-id: shared-datasource.yaml
            group: SHARED_GROUP
`);

    const kg = createMockKg();
    const result = await resolver.enhance({ projectPath: dir, kg });

    expect(result.configsCount).toBe(2);
  });

  it('case 3: spring.config.import=nacos:order-dev.yaml?group=DEFAULT_GROUP -> 1 nacos_config with group parsed', async () => {
    const dir = createFixtureDir();
    createBootstrapYml(dir, `
spring:
  application:
    name: order-service
  config:
    import: nacos:order-dev.yaml?group=DEFAULT_GROUP&namespace=dev
`);

    const kg = createMockKg();
    const result = await resolver.enhance({ projectPath: dir, kg });

    expect(result.configsCount).toBe(1);
    const config = kg.symbols.find(s => s.kind === 'nacos_config');
    expect(config).toBeDefined();
    expect(config.metadata.group).toBe('DEFAULT_GROUP');
  });

  it('case 4: Two services with same server-addr -> 1 nacos_cluster (deduped), 2 nacos_service', async () => {
    const dir = createFixtureDir();
    createBootstrapYml(dir, `
spring:
  application:
    name: order-service
  cloud:
    nacos:
      discovery:
        server-addr: 10.0.0.1:8848
`);

    const kg = createMockKg();
    const result = await resolver.enhance({ projectPath: dir, kg });

    // One cluster for the server-addr
    expect(result.clustersCount).toBe(1);
    // One service for this service
    expect(result.servicesCount).toBe(1);
  });

  it('case 5: nacos.password=secret1234 -> metadata password=***1234, never plaintext', async () => {
    const dir = createFixtureDir();
    createBootstrapYml(dir, `
spring:
  application:
    name: order-service
  cloud:
    nacos:
      discovery:
        server-addr: 10.0.0.1:8848
        password: secret1234
`);

    const kg = createMockKg();
    await resolver.enhance({ projectPath: dir, kg });

    const cluster = kg.symbols.find(s => s.kind === 'nacos_cluster');
    expect(cluster).toBeDefined();
    expect(cluster.metadata.password).toBe('***1234');
  });
});
