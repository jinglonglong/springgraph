/**
 * MCP tool tests — verify each tool returns the correct response shape
 * against a mocked SpringKg with a fresh in-memory database.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMockSpringKg, seedEndpoint, seedFeignClient, seedSymbol, seedConfigProperty, seedEdge } from '../../springkg-cli/__tests__/test-helpers.js';
import { handleFindEntry } from '../src/tools/find-entry.js';
import { handleFindFeign } from '../src/tools/find-feign.js';
import { handleAssetsOverview } from '../src/tools/assets-overview.js';
import { handleTraceFlow } from '../src/tools/trace-flow.js';

let mockSk: ReturnType<typeof createMockSpringKg>;
const sk = () => mockSk as unknown as import('@jinglonglong/springkg-core').SpringKg;

beforeEach(() => {
  mockSk = createMockSpringKg();
});

afterEach(async () => {
  await mockSk.close();
});

function textOf(result: { content: ReadonlyArray<{ type: string; text: string }> }): string {
  return result.content.map((c) => c.text).join('\n');
}

describe('spring_find_entry', () => {
  it('finds endpoint by URL', async () => {
    const db = mockSk.db.getDb();
    seedEndpoint(db, { path: '/api/users', method: 'GET', source_file_path: 'src/UserController.java', source_line: 13 });

    const result = await handleFindEntry(sk(), { url: '/api/users' });
    const text = textOf(result);
    expect(text).toContain('## Endpoint GET /api/users');
    expect(text).toContain('src/UserController.java:13');
  });

  it('returns guidance when no filter given', async () => {
    const result = await handleFindEntry(sk(), {});
    const text = textOf(result);
    expect(text).toContain('Provide at least one filter');
  });

  it('returns not-found guidance when URL has no match', async () => {
    const result = await handleFindEntry(sk(), { url: '/api/nonexistent' });
    const text = textOf(result);
    expect(text).toContain('Not Found');
  });

  it('finds by controller class name (fuzzy)', async () => {
    const db = mockSk.db.getDb();
    seedSymbol(db, { id: 'ctrl:UserController', kind: 'controller', name: 'UserController', qualified_name: 'com.example.user.UserController' });
    const result = await handleFindEntry(sk(), { controller: 'User' });
    const text = textOf(result);
    expect(text).toContain('## Controller Match');
    expect(text).toContain('UserController');
  });

  it('finds by Feign client name', async () => {
    const db = mockSk.db.getDb();
    seedFeignClient(db, { client_name: 'OrderClient', target_service: 'order-service', method_count: 3 });
    const result = await handleFindEntry(sk(), { feign_name: 'Order' });
    const text = textOf(result);
    expect(text).toContain('## Feign Match');
    expect(text).toContain('OrderClient');
    expect(text).toContain('order-service');
  });

  it('finds scheduled tasks by metadata', async () => {
    const db = mockSk.db.getDb();
    seedSymbol(db, { id: 'job:warmup', kind: 'method', name: 'warmup', qualified_name: 'com.example.UserCacheJob.warmup', metadata: { scheduled: true, fixedDelay: 60000 } });
    const result = await handleFindEntry(sk(), { scheduled: 'warmup' });
    const text = textOf(result);
    expect(text).toContain('## Scheduled Task');
    expect(text).toContain('fixedDelay=60000');
  });
});

describe('spring_find_feign', () => {
  it('finds by client name', async () => {
    const db = mockSk.db.getDb();
    seedFeignClient(db, { client_name: 'OrderClient', target_service: 'order-service', method_count: 3 });
    const result = await handleFindFeign(sk(), { name: 'OrderClient' });
    const text = textOf(result);
    expect(text).toContain('## Feign Client');
    expect(text).toContain('OrderClient');
    expect(text).toContain('order-service');
  });

  it('finds by target_service (reverse lookup)', async () => {
    const db = mockSk.db.getDb();
    seedFeignClient(db, { client_name: 'OrderClient', target_service: 'order-service', method_count: 3 });
    const result = await handleFindFeign(sk(), { target_service: 'order-service' });
    const text = textOf(result);
    expect(text).toContain('## Feign Client');
    expect(text).toContain('OrderClient');
  });

  it('returns not-found when no match', async () => {
    const result = await handleFindFeign(sk(), { name: 'NonExistent' });
    const text = textOf(result);
    expect(text).toContain('Not Found');
  });

  it('returns guidance when no filter given', async () => {
    const result = await handleFindFeign(sk(), {});
    const text = textOf(result);
    expect(text).toContain('Provide at least one filter');
  });
});

describe('spring_assets_overview', () => {
  it('returns 3 sections (Services, Middlewares, Sensitive Config)', async () => {
    const result = await handleAssetsOverview(sk(), {});
    const text = textOf(result);
    expect(text).toContain('## Services');
    expect(text).toContain('## Middlewares');
    expect(text).toContain('## Sensitive Config');
  });

  it('lists services from spring_symbols', async () => {
    const db = mockSk.db.getDb();
    seedSymbol(db, { id: 'ctrl:UC', kind: 'controller', name: 'UserController', qualified_name: 'com.example.UserController', file_path: 'src/UserController.java' });
    seedSymbol(db, { id: 'svc:US', kind: 'service', name: 'UserService', qualified_name: 'com.example.UserService', file_path: 'src/UserService.java' });
    const result = await handleAssetsOverview(sk(), {});
    const text = textOf(result);
    expect(text).toContain('UserController');
    expect(text).toContain('UserService');
    expect(text).toContain('## Services (2)');
  });

  it('CRITICAL: never includes value_hash for sensitive config rows', async () => {
    const db = mockSk.db.getDb();
    seedConfigProperty(db, { key: 'spring.datasource.password', value_hash: 'SECRETHASH12345', is_sensitive: true });
    seedConfigProperty(db, { key: 'spring.datasource.url', value_hash: 'URLHASH67890', is_sensitive: false });

    const result = await handleAssetsOverview(sk(), {});
    const text = textOf(result);
    expect(text).toContain('spring.datasource.password');
    expect(text).toContain('## Sensitive Config');
    // Sensitive row's hash must NOT leak
    expect(text).not.toContain('SECRETHASH12345');
    // Non-sensitive row's hash also excluded (we only print key + file:line for all)
    expect(text).not.toContain('URLHASH67890');
  });

  it('handles empty database gracefully', async () => {
    const result = await handleAssetsOverview(sk(), {});
    const text = textOf(result);
    expect(text).toContain('No controllers or services indexed yet');
    expect(text).toContain('No middlewares indexed yet');
    expect(text).toContain('No sensitive config properties indexed yet');
  });
});

describe('spring_trace_flow', () => {
  it('returns guidance when url is missing', async () => {
    const result = await handleTraceFlow(sk(), {});
    const text = textOf(result);
    expect(text).toContain('Required input');
  });

  it('returns not-found for unknown URL', async () => {
    const result = await handleTraceFlow(sk(), { url: '/api/nonexistent' });
    const text = textOf(result);
    expect(text).toContain('Not Found');
  });

  it('returns Endpoint section for depth 1', async () => {
    const db = mockSk.db.getDb();
    seedEndpoint(db, { id: 'ep:1', path: '/api/users', method: 'GET', source_file_path: 'src/UC.java', source_line: 1, handler_class_id: 'ctrl:UC' });
    const result = await handleTraceFlow(sk(), { url: '/api/users', depth: 1 });
    const text = textOf(result);
    expect(text).toContain('## Endpoint GET /api/users');
  });

  it('returns Endpoint + Controller sections for depth 2', async () => {
    const db = mockSk.db.getDb();
    seedEndpoint(db, { id: 'ep:1', path: '/api/users', method: 'GET', source_file_path: 'src/UC.java', source_line: 1, handler_class_id: 'ctrl:UC' });
    seedSymbol(db, { id: 'ctrl:UC', kind: 'controller', name: 'UserController', qualified_name: 'com.example.UserController', file_path: 'src/UC.java' });
    const result = await handleTraceFlow(sk(), { url: '/api/users', depth: 2 });
    const text = textOf(result);
    expect(text).toContain('## Endpoint GET /api/users');
    expect(text).toContain('## Controller');
    expect(text).toContain('UserController');
  });

  it('follows CALLS edges to services for depth 3', async () => {
    const db = mockSk.db.getDb();
    seedEndpoint(db, { id: 'ep:1', path: '/api/users', method: 'GET', source_file_path: 'src/UC.java', source_line: 1, handler_class_id: 'ctrl:UC' });
    seedSymbol(db, { id: 'ctrl:UC', kind: 'controller', name: 'UserController', qualified_name: 'com.example.UserController', file_path: 'src/UC.java' });
    seedSymbol(db, { id: 'svc:US', kind: 'service', name: 'UserService', qualified_name: 'com.example.UserService', file_path: 'src/US.java' });
    seedEdge(db, { id: 'e1', source_id: 'ctrl:UC', target_id: 'svc:US', kind: 'CALLS' });

    const result = await handleTraceFlow(sk(), { url: '/api/users', depth: 3 });
    const text = textOf(result);
    expect(text).toContain('## Service');
    expect(text).toContain('UserService');
  });
});
