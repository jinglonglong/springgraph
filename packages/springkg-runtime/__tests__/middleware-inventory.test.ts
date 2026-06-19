import { describe, it, expect, beforeEach } from 'vitest';
import { MiddlewareInventory } from '../src/middleware-inventory.js';

function createMockKg() {
  return {
    symbols: [] as any[],
    edges: [] as any[],
    configProperties: [] as any[],
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
    },
    getConfigProperties: async function(this: any) { return this.configProperties; }
  };
}

describe('MiddlewareInventory', () => {
  let inventory: MiddlewareInventory;

  beforeEach(() => {
    inventory = new MiddlewareInventory();
  });

  it('case 1: spring.datasource.url=jdbc:mysql://10.0.0.1:3306/order_db -> 1 middleware (mysql), 1 CONNECTS_TO edge', async () => {
    const kg = createMockKg();
    kg.configProperties = [{
      serviceId: 'order-service',
      key: 'spring.datasource.url',
      valueMasked: 'jdbc:mysql://10.0.0.1:3306/order_db'
    }];

    const result = await inventory.enhance({ projectPath: '/fake', kg });

    expect(result.middlewareCount).toBe(1);
    expect(result.edgesCount).toBe(1);
    const middleware = kg.symbols.find(s => s.kind === 'middleware');
    expect(middleware).toBeDefined();
    expect(middleware.metadata.subtype).toBe('mysql');
  });

  it('case 2: Multi-datasource (spring.datasource.order.url, spring.datasource.bill.url) -> 2 distinct middleware nodes', async () => {
    const kg = createMockKg();
    kg.configProperties = [
      { serviceId: 'order-service', key: 'spring.datasource.order.url', valueMasked: 'jdbc:mysql://10.0.0.1:3306/order_db' },
      { serviceId: 'order-service', key: 'spring.datasource.bill.url', valueMasked: 'jdbc:mysql://10.0.0.2:3306/bill_db' }
    ];

    const result = await inventory.enhance({ projectPath: '/fake', kg });

    expect(result.middlewareCount).toBe(2);
    const middlewareSymbols = kg.symbols.filter(s => s.kind === 'middleware');
    expect(middlewareSymbols.length).toBe(2);
  });

  it('case 3: spring.redis.host=10.0.0.2, spring.redis.port=6379 -> 1 cache/redis middleware', async () => {
    const kg = createMockKg();
    kg.configProperties = [
      { serviceId: 'order-service', key: 'spring.redis.host', valueMasked: '10.0.0.2' },
      { serviceId: 'order-service', key: 'spring.redis.port', valueMasked: '6379' }
    ];

    const result = await inventory.enhance({ projectPath: '/fake', kg });

    expect(result.middlewareCount).toBe(1);
    const middleware = kg.symbols.find(s => s.kind === 'middleware');
    expect(middleware).toBeDefined();
    expect(middleware.metadata.middlewareKind).toBe('cache');
    expect(middleware.metadata.subtype).toBe('redis');
  });

  it('case 4: spring.kafka.bootstrap-servers=10.0.0.3:9092 -> 1 mq/kafka', async () => {
    const kg = createMockKg();
    kg.configProperties = [{
      serviceId: 'order-service',
      key: 'spring.kafka.bootstrap-servers',
      valueMasked: '10.0.0.3:9092'
    }];

    const result = await inventory.enhance({ projectPath: '/fake', kg });

    expect(result.middlewareCount).toBe(1);
    const middleware = kg.symbols.find(s => s.kind === 'middleware');
    expect(middleware.metadata.middlewareKind).toBe('mq');
    expect(middleware.metadata.subtype).toBe('kafka');
  });

  it('case 5: spring.rabbitmq.host=10.0.0.4 -> 1 mq/rabbitmq', async () => {
    const kg = createMockKg();
    kg.configProperties = [{
      serviceId: 'order-service',
      key: 'spring.rabbitmq.host',
      valueMasked: '10.0.0.4'
    }];

    const result = await inventory.enhance({ projectPath: '/fake', kg });

    expect(result.middlewareCount).toBe(1);
    const middleware = kg.symbols.find(s => s.kind === 'middleware');
    expect(middleware.metadata.middlewareKind).toBe('mq');
    expect(middleware.metadata.subtype).toBe('rabbitmq');
  });

  it('case 6: xxl.job.admin.addresses=http://10.0.0.5:8080/xxl-job-admin -> 1 job_scheduler/xxl-job', async () => {
    const kg = createMockKg();
    kg.configProperties = [{
      serviceId: 'order-service',
      key: 'xxl.job.admin.addresses',
      valueMasked: 'http://10.0.0.5:8080/xxl-job-admin'
    }];

    const result = await inventory.enhance({ projectPath: '/fake', kg });

    expect(result.middlewareCount).toBe(1);
    const middleware = kg.symbols.find(s => s.kind === 'middleware');
    expect(middleware.metadata.middlewareKind).toBe('job_scheduler');
    expect(middleware.metadata.subtype).toBe('xxl-job');
  });
});
