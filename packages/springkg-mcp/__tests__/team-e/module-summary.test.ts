import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockSpringKg, seedConfigProperty, seedEdge, seedSymbol } from '../../../springkg-cli/__tests__/test-helpers.js';
import { handleModuleSummary } from '../../src/tools/module-summary.js';

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

describe('spring_module_summary', () => {
  it('returns the expected summary sections', async () => {
    const db = mockSk.db.getDb();
    seedSymbol(db, { id: 'ctrl:orders', kind: 'controller', name: 'OrderController', qualified_name: 'com.example.order.OrderController', file_path: 'src/order/OrderController.java' });
    seedSymbol(db, { id: 'svc:orders', kind: 'service', name: 'OrderService', qualified_name: 'com.example.order.OrderService', file_path: 'src/order/OrderService.java' });
    seedSymbol(db, { id: 'mapper:orders', kind: 'mapper', name: 'OrderMapper', qualified_name: 'com.example.order.OrderMapper', file_path: 'src/order/OrderMapper.java' });
    seedSymbol(db, { id: 'feign:inventory', kind: 'feign_client', name: 'InventoryClient', qualified_name: 'com.example.inventory.InventoryClient', file_path: 'src/inventory/InventoryClient.java' });
    seedEdge(db, { id: 'edge:mod:1', source_id: 'svc:orders', target_id: 'feign:inventory', kind: 'calls' });
    seedConfigProperty(db, { key: 'order.timeout', value_hash: 'timeout-hash', is_sensitive: false, source_file_path: 'src/order/application-order.yml', source_line: 4 });

    const result = await handleModuleSummary(sk(), { modulePath: 'com.example.order' });
    const text = textOf(result);
    expect(text).toContain('## Controllers');
    expect(text).toContain('## Services');
    expect(text).toContain('## Mappers');
    expect(text).toContain('## Configs');
    expect(text).toContain('## Dependencies');
    expect(text).toContain('## Statistics');
    expect(text).toContain('## Recent');
  });
});
