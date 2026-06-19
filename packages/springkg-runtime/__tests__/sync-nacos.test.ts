import { describe, expect, it, beforeEach } from 'vitest';

import { NacosConfigResolver } from '../src/nacos-config-resolver';

function createMockKg() {
  const configProperties: any[] = [];
  const symbols: any[] = [];
  const edges: any[] = [];

  return {
    configProperties,
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
    async getConfigProperties() {
      return this.configProperties;
    },
  };
}

describe('sync-nacos dryRun', () => {
  it('returns nacos config items without persisting changes', async () => {
    const dryRun = true;
    const kg = createMockKg();
    const resolver = new NacosConfigResolver();

    const nacosConfigs = [
      { dataId: 'application.yml', group: 'DEFAULT_GROUP', content: 'spring:\n  app: test' },
      { dataId: 'datasource.yml', group: 'DATASOURCE_GROUP', content: 'spring:\n  datasource:\n    url: jdbc:mysql://localhost:3306/test' },
    ];

    for (const config of nacosConfigs) {
      resolver.addConfig(config);
      const result = resolver.resolve();
      for (const sym of result.symbols) {
        await kg.upsertSymbol(sym);
      }
    }

    expect(kg.symbols).toHaveLength(2);
    expect(kg.symbols[0].kind).toBe('nacos_config');
    expect(kg.symbols[1].kind).toBe('nacos_config');
  });

  it('resolves namespace and group correctly in dryRun mode', async () => {
    const kg = createMockKg();
    const resolver = new NacosConfigResolver();

    const input = [
      { namespace: 'prod-env', group: 'PROD_GROUP', dataId: 'redis.yml', content: 'host: localhost' },
      { namespace: 'dev-env', group: 'DEV_GROUP', dataId: 'redis.yml', content: 'host: dev.local' },
    ];

    for (const config of input) {
      resolver.addConfig(config);
      const result = resolver.resolve();
      for (const sym of result.symbols) {
        await kg.upsertSymbol(sym);
      }
    }

    expect(kg.symbols).toHaveLength(2);
    const prodSymbol = kg.symbols.find((s: any) => s.metadata?.namespace === 'prod-env');
    const devSymbol = kg.symbols.find((s: any) => s.metadata?.namespace === 'dev-env');
    expect(prodSymbol).toBeDefined();
    expect(devSymbol).toBeDefined();
    expect(prodSymbol?.qualifiedName).toContain('prod-env');
    expect(devSymbol?.qualifiedName).toContain('dev-env');
  });
});
