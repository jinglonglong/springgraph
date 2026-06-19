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

describe('NacosConfigResolver', () => {
  let resolver: NacosConfigResolver;
  let kg: ReturnType<typeof createMockKg>;

  beforeEach(() => {
    resolver = new NacosConfigResolver();
    kg = createMockKg();
  });

  it('extracts config properties from nacos config content', async () => {
    resolver.addConfig({
      dataId: 'application.yml',
      group: 'DEFAULT_GROUP',
      content: 'spring:\n  app: test\n  db: localhost',
    });

    const result = resolver.resolve();
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].kind).toBe('nacos_config');
    expect(result.symbols[0].name).toBe('application.yml');
  });

  it('marks sensitive properties correctly', async () => {
    resolver.addConfig({
      dataId: 'db.yml',
      group: 'DATASOURCE_GROUP',
      content: 'password: secret123\nusername: admin',
    });

    const props = await resolver.getConfigProperties();
    const password = props.find((p: any) => p.key === 'password');
    const username = props.find((p: any) => p.key === 'username');
    expect(password?.isSensitive).toBe(true);
    expect(username?.isSensitive).toBe(false);
  });

  it('handles multiple configs with different groups', async () => {
    resolver.addConfig({
      dataId: 'app.yml',
      group: 'GROUP_A',
      content: 'key: valueA',
    });
    resolver.addConfig({
      dataId: 'app.yml',
      group: 'GROUP_B',
      content: 'key: valueB',
    });

    const result = resolver.resolve();
    expect(result.symbols).toHaveLength(2);
    const groupA = result.symbols.find((s) => s.metadata?.group === 'GROUP_A');
    const groupB = result.symbols.find((s) => s.metadata?.group === 'GROUP_B');
    expect(groupA).toBeDefined();
    expect(groupB).toBeDefined();
  });

  it('uses namespace when provided', async () => {
    resolver.addConfig({
      dataId: 'redis.yml',
      group: 'CACHE_GROUP',
      namespace: 'prod-namespace',
      content: 'host: localhost\nport: 6379',
    });

    const result = resolver.resolve();
    expect(result.symbols[0].qualifiedName).toContain('prod-namespace');
  });

  it('returns correct property count in metadata', async () => {
    resolver.addConfig({
      dataId: 'multi.yml',
      group: 'DEFAULT_GROUP',
      content: 'prop1: val1\nprop2: val2\nprop3: val3',
    });

    const result = resolver.resolve();
    expect(result.symbols[0].metadata?.propertyCount).toBe(3);
  });
});
