import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockSpringKg, seedConfigProperty, seedEdge, seedSymbol } from '../../../springkg-cli/__tests__/test-helpers.js';
import { handleRuntimeDependency } from '../../src/tools/runtime-dependency.js';

let mockSk: ReturnType<typeof createMockSpringKg>;
const sk = () => mockSk as unknown as import('@jinglonglong/springkg-core').SpringKg;

function textOf(result: { content: ReadonlyArray<{ type: string; text: string }> }): string {
  return result.content.map((entry) => entry.text).join('\n');
}

beforeEach(() => {
  mockSk = createMockSpringKg();
});

afterEach(async () => {
  await mockSk.close();
});

describe('spring_runtime_dependency', () => {
  it('returns runtime dependency sections for a service', async () => {
    const db = mockSk.db.getDb();
    seedSymbol(db, { id: 'svc:orders', kind: 'service', name: 'OrderService', qualified_name: 'com.example.OrderService', file_path: 'src/OrderService.java' });
    seedSymbol(db, { id: 'mw:redis', kind: 'middleware', name: 'RedisTemplate', qualified_name: 'com.example.runtime.RedisTemplate', file_path: 'src/RedisConfig.java', metadata: { type: 'redis' } });
    seedSymbol(db, { id: 'feign:inventory', kind: 'feign_client', name: 'InventoryClient', qualified_name: 'com.example.InventoryClient', file_path: 'src/InventoryClient.java' });
    seedSymbol(db, { id: 'mapper:orders', kind: 'mapper_method', name: 'updateOrder', qualified_name: 'com.example.OrderMapper.updateOrder', file_path: 'src/OrderMapper.java' });
    seedEdge(db, { id: 'edge:runtime:1', source_id: 'svc:orders', target_id: 'mw:redis', kind: 'CALLS' });
    seedEdge(db, { id: 'edge:runtime:2', source_id: 'svc:orders', target_id: 'feign:inventory', kind: 'CALLS' });
    seedEdge(db, { id: 'edge:runtime:3', source_id: 'svc:orders', target_id: 'mapper:orders', kind: 'CALLS' });
    db.prepare(
      'INSERT INTO spring_sql_statements (id, mapper_id, sql_hash, sql_text, parameter_count, tables, source_file_path, source_line) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('sql:runtime', 'mapper:orders', 'hash-runtime', 'select * from orders where id = #{id}', 1, JSON.stringify(['orders']), 'src/OrderMapper.xml', 10);
    seedConfigProperty(db, { key: 'order.timeout', value_hash: 'timeout', is_sensitive: false, source_file_path: 'src/OrderServiceConfig.java', source_line: 3, bean_id: 'OrderServiceProperties' });

    const result = await handleRuntimeDependency(sk(), { serviceName: 'OrderService' });
    const text = textOf(result);
    expect(text).toContain('## Database');
    expect(text).toContain('## Redis');
    expect(text).toContain('## Feign');
    expect(text).toContain('## Config Keys');
    expect(text).toContain('orders');
  });
});
