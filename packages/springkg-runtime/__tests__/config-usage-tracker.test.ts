import { describe, it, expect, beforeEach } from 'vitest';
import { ConfigPropertyUsageTracker } from '../src/config-usage-tracker.js';

function createMockKg() {
  const edges: any[] = [];

  return {
    edges,
    upsertEdge: async (edge: any) => {
      const existing = edges.findIndex(e => e.id === edge.id);
      if (existing >= 0) {
        edges[existing] = edge;
      } else {
        edges.push(edge);
      }
    },
    codegraph: {
      findNodes: async ({ decoratorPattern }: { decoratorPattern: string }) => {
        // Return mock nodes based on test fixtures
        return [];
      }
    },
    getConfigProperties: async () => []
  };
}

describe('ConfigPropertyUsageTracker', () => {
  let tracker: ConfigPropertyUsageTracker;

  beforeEach(() => {
    tracker = new ConfigPropertyUsageTracker();
  });

  it('case 1: UserService.java with @Value("${spring.datasource.url}") on field -> 1 USED_BY edge', async () => {
    const kg = createMockKg();

    // Mock codegraph nodes with @Value
    kg.codegraph.findNodes = async () => [
      {
        id: 'field:UserService:dbUrl',
        name: 'dbUrl',
        kind: 'field',
        serviceId: 'order-service',
        decorators: '@Value("${spring.datasource.url}")'
      }
    ];

    // Mock config properties from T15
    kg.getConfigProperties = async () => [
      {
        serviceId: 'order-service',
        key: 'spring.datasource.url',
        id: 'config_property:order-service:spring.datasource.url'
      }
    ];

    const result = await tracker.enhance({ projectPath: '/fake', kg });

    expect(result.edgesCount).toBe(1);
    const edge = kg.edges.find(e => e.kind === 'USED_BY');
    expect(edge).toBeDefined();
    expect(edge.sourceId).toContain('config_property:order-service:spring.datasource.url');
    expect(edge.targetId).toBe('field:UserService:dbUrl');
  });

  it('case 2: AppProperties.java with @ConfigurationProperties(prefix = "app.datasource") and runtime_config_properties has app.datasource.max-pool-size, app.datasource.min-idle -> 2 USED_BY edges', async () => {
    const kg = createMockKg();

    // Mock codegraph nodes with @ConfigurationProperties
    kg.codegraph.findNodes = async () => [
      {
        id: 'class:AppProperties',
        name: 'AppProperties',
        kind: 'class',
        serviceId: 'order-service',
        decorators: '@ConfigurationProperties(prefix = "app.datasource")'
      }
    ];

    // Mock config properties
    kg.getConfigProperties = async () => [
      {
        serviceId: 'order-service',
        key: 'app.datasource.max-pool-size',
        id: 'config_property:order-service:app.datasource.max-pool-size'
      },
      {
        serviceId: 'order-service',
        key: 'app.datasource.min-idle',
        id: 'config_property:order-service:app.datasource.min-idle'
      }
    ];

    const result = await tracker.enhance({ projectPath: '/fake', kg });

    expect(result.edgesCount).toBe(2);
    const edges = kg.edges.filter(e => e.kind === 'USED_BY');
    expect(edges.length).toBe(2);
    expect(edges[0].sourceId).toContain('config_property:order-service:app.datasource');
    expect(edges[0].targetId).toBe('class:AppProperties');
  });
});
