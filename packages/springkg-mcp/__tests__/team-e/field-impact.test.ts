import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockSpringKg, seedEdge, seedSymbol } from '../../../springkg-cli/__tests__/test-helpers.js';
import { handleFieldImpact } from '../../src/tools/field-impact.js';

let mockSk: ReturnType<typeof createMockSpringKg>;
const sk = () => mockSk as unknown as import('@colbymchenry/springkg-core').SpringKg;

function textOf(result: { content: ReadonlyArray<{ type: string; text: string }> }): string {
  return result.content.map((entry) => entry.text).join('\n');
}

beforeEach(() => {
  mockSk = createMockSpringKg();
});

afterEach(async () => {
  await mockSk.close();
});

describe('spring_field_impact', () => {
  it('returns mapper usage, read/write sites, and schema impact', async () => {
    const db = mockSk.db.getDb();
    seedSymbol(db, { id: 'field:status', kind: 'field', name: 'status', qualified_name: 'com.example.Order.status', file_path: 'src/Order.java' });
    seedSymbol(db, { id: 'svc:update', kind: 'service', name: 'updateStatus', qualified_name: 'com.example.OrderService.updateStatus', file_path: 'src/OrderService.java' });
    seedEdge(db, { id: 'edge:field:1', source_id: 'svc:update', target_id: 'field:status', kind: 'READS' });
    db.prepare(
      'INSERT INTO spring_sql_statements (id, mapper_id, sql_hash, sql_text, parameter_count, tables, source_file_path, source_line) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('sql:status', 'mapper:update', 'hash-status', 'update orders set status = #{status} where id = #{id}', 2, JSON.stringify(['orders']), 'src/OrderMapper.xml', 12);

    const result = await handleFieldImpact(sk(), { fieldName: 'status' });
    const text = textOf(result);
    expect(text).toContain('## Mappers Using Field');
    expect(text).toContain('## Callers Reading/Writing');
    expect(text).toContain('## Schema Impact');
    expect(text).toContain('orders');
  });
});
