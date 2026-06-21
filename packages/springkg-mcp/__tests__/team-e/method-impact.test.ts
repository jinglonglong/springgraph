import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockSpringKg, seedEdge, seedEndpoint, seedSymbol } from '../../../springkg-cli/__tests__/test-helpers.js';
import { handleMethodImpact } from '../../src/tools/method-impact.js';

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

describe('spring_method_impact', () => {
  it('returns callers, callees, transactions, and exception handlers', async () => {
    const db = mockSk.db.getDb();
    seedSymbol(db, { id: 'svc:orderApprove', kind: 'service', name: 'approve', qualified_name: 'com.example.OrderService.approve', file_path: 'src/OrderService.java', metadata: { annotations: ['Transactional'] } });
    seedSymbol(db, { id: 'ctrl:submit', kind: 'controller_method', name: 'submit', qualified_name: 'com.example.OrderController.submit', file_path: 'src/OrderController.java' });
    seedSymbol(db, { id: 'mapper:update', kind: 'mapper_method', name: 'updateOrder', qualified_name: 'com.example.OrderMapper.updateOrder', file_path: 'src/OrderMapper.java' });
    seedSymbol(db, { id: 'handler:ex', kind: 'method', name: 'handleOrderException', qualified_name: 'com.example.OrderService.handleOrderException', file_path: 'src/OrderService.java', metadata: { annotations: ['ExceptionHandler'] } });
    seedEdge(db, { id: 'edge:1', source_id: 'ctrl:submit', target_id: 'svc:orderApprove', kind: 'CALLS' });
    seedEdge(db, { id: 'edge:2', source_id: 'svc:orderApprove', target_id: 'mapper:update', kind: 'CALLS' });
    seedEndpoint(db, { id: 'endpoint:/orders/approve', path: '/orders/approve', method: 'POST', handler_method_id: 'svc:orderApprove', source_file_path: 'src/OrderController.java', source_line: 18 });

    const result = await handleMethodImpact(sk(), { methodName: 'approve' });
    const text = textOf(result);
    expect(text).toContain('## Callers');
    expect(text).toContain('## Callees');
    expect(text).toContain('## Transactions');
    expect(text).toContain('## Exception Handlers');
    expect(text).toContain('/orders/approve');
  });
});
