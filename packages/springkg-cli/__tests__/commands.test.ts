/**
 * CLI command tests — verify each command runs without error and produces
 * expected output against a mocked SpringKg.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockSpringKg, seedEndpoint, seedFeignClient, seedSymbol, seedConfigProperty, seedEdge } from './test-helpers.js';
import { runStatus } from '../src/commands/status.js';
import { runInspectEndpoint } from '../src/commands/inspect.js';

// Mock @colbymchenry/springkg-core — return our mock SpringKg
let mockSk: ReturnType<typeof createMockSpringKg>;
vi.mock('@colbymchenry/springkg-core', () => ({
  SpringKg: {
    open: async () => mockSk,
    init: async () => mockSk,
  },
}));

beforeEach(() => {
  mockSk = createMockSpringKg();
});

afterEach(async () => {
  await mockSk.close();
});

describe('status command', () => {
  it('reports zero counts on empty database', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runStatus('/tmp/test');
    const output = spy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Symbols: 0');
    expect(output).toContain('Edges: 0');
    spy.mockRestore();
  });

  it('reports correct counts after seeding', async () => {
    const db = mockSk.db.getDb();
    seedSymbol(db, { id: 's1', kind: 'controller', name: 'UserController' });
    seedSymbol(db, { id: 's2', kind: 'service', name: 'UserService' });
    seedEndpoint(db, { path: '/api/users', method: 'GET', handler_class_id: 's1' });
    seedFeignClient(db, { client_name: 'OrderClient', target_service: 'order-service', method_count: 3 });
    seedConfigProperty(db, { key: 'spring.datasource.password', value_hash: 'hash123', is_sensitive: true });
    seedConfigProperty(db, { key: 'spring.datasource.url', value_hash: 'hash456', is_sensitive: false });

    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runStatus('/tmp/test');
    const output = spy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Symbols: 2');
    expect(output).toContain('Endpoints: 1');
    expect(output).toContain('Feign clients: 1');
    expect(output).toContain('Sensitive configs: 1');
    spy.mockRestore();
  });
});

describe('inspect endpoint command', () => {
  it('finds an endpoint by URL', async () => {
    const db = mockSk.db.getDb();
    seedEndpoint(db, { path: '/api/users', method: 'GET', source_file_path: 'src/UserController.java', source_line: 13 });

    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runInspectEndpoint('/tmp/test', '/api/users');
    const output = spy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('## Endpoint GET /api/users');
    expect(output).toContain('src/UserController.java:13');
    spy.mockRestore();
  });

  it('returns guidance when no match', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runInspectEndpoint('/tmp/test', '/api/nonexistent');
    const output = spy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('No endpoint found');
    spy.mockRestore();
  });
});

describe('inspect feign command', () => {
  it('finds a feign client by name', async () => {
    const db = mockSk.db.getDb();
    seedFeignClient(db, { client_name: 'OrderClient', target_service: 'order-service', method_count: 3 });

    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runInspectEndpoint; // noop
    const { runInspectFeign } = await import('../src/commands/inspect.js');
    await runInspectFeign('/tmp/test', 'OrderClient');
    const output = spy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('## Feign Client OrderClient');
    expect(output).toContain('order-service');
    expect(output).toContain('Method count: 3');
    spy.mockRestore();
  });
});

describe('inspect config command — sensitive value protection', () => {
  it('never prints the value for sensitive rows', async () => {
    const db = mockSk.db.getDb();
    seedConfigProperty(db, { key: 'spring.datasource.password', value_hash: 'a1b2c3d4e5f6', is_sensitive: true });

    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { runInspectConfig } = await import('../src/commands/inspect.js');
    await runInspectConfig('/tmp/test', 'password');
    const output = spy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('[SENSITIVE]');
    expect(output).toContain('***');
    // The value hash must NOT be printed (it could leak value content)
    expect(output).not.toContain('a1b2c3d4e5f6');
    spy.mockRestore();
  });

  it('prints value hash for non-sensitive rows', async () => {
    const db = mockSk.db.getDb();
    seedConfigProperty(db, { key: 'spring.datasource.url', value_hash: 'urlhash', is_sensitive: false });

    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { runInspectConfig } = await import('../src/commands/inspect.js');
    await runInspectConfig('/tmp/test', 'datasource.url');
    const output = spy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).not.toContain('[SENSITIVE]');
    expect(output).toContain('urlhash');
    spy.mockRestore();
  });
});

describe('inspect mapper command', () => {
  it('finds a mapper by namespace', async () => {
    const db = mockSk.db.getDb();
    seedSymbol(db, { id: 'm1', kind: 'mapper', name: 'UserMapper', qualified_name: 'com.example.UserMapper', file_path: 'src/UserMapper.java' });
    db.prepare(`
      INSERT OR REPLACE INTO spring_sql_statements (id, mapper_id, sql_hash, sql_text, parameter_count, tables, source_file_path, source_line)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('sql:findAll', 'm1', 'hash1', 'SELECT * FROM users', 0, JSON.stringify(['users']), 'src/UserMapper.java', 8);

    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { runInspectMapper } = await import('../src/commands/inspect.js');
    await runInspectMapper('/tmp/test', 'UserMapper');
    const output = spy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('## Mapper com.example.UserMapper');
    expect(output).toContain('SELECT * FROM users');
    expect(output).toContain('users');
    spy.mockRestore();
  });
});
