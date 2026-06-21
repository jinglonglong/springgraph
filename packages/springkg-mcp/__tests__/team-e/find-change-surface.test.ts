import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockSpringKg, seedEdge, seedEndpoint, seedSymbol } from '../../../springkg-cli/__tests__/test-helpers.js';
import { handleFindChangeSurface } from '../../src/tools/find-change-surface.js';

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

describe('spring_find_change_surface', () => {
  it('returns affected symbols, endpoints, and suggested tests', async () => {
    const db = mockSk.db.getDb();
    seedSymbol(db, { id: 'ctrl:orders', kind: 'controller', name: 'OrderController', qualified_name: 'com.example.OrderController', file_path: 'src/order/OrderController.java' });
    seedSymbol(db, { id: 'svc:orders', kind: 'service', name: 'OrderService', qualified_name: 'com.example.OrderService', file_path: 'src/order/OrderService.java' });
    seedEdge(db, { id: 'edge:surface:1', source_id: 'ctrl:orders', target_id: 'svc:orders', kind: 'CALLS' });
    seedEndpoint(db, { id: 'ep:orders', path: '/orders', method: 'GET', handler_class_id: 'ctrl:orders', source_file_path: 'src/order/OrderController.java', source_line: 8 });

    const result = await handleFindChangeSurface(sk(), { files: ['src/order/OrderController.java'], depth: 2 });
    const text = textOf(result);
    expect(text).toContain('## Changed Files');
    expect(text).toContain('## Affected Symbols');
    expect(text).toContain('## Endpoints');
    expect(text).toContain('## Suggested Tests');
    expect(text).toContain('/orders');
  });
});
