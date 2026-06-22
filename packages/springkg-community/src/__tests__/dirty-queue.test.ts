import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

import type { SpringKgEdge, SpringKgNode } from '@colbymchenry/springkg-shared';

import { DirtyQueue } from '../dirty-queue.js';
import type { SpringDatabase } from '../types.js';

const SCHEMA = `
CREATE TABLE feature_communities (id TEXT PRIMARY KEY, label TEXT, summary TEXT DEFAULT '', member_count INTEGER DEFAULT 0, dirty INTEGER DEFAULT 1, last_summarized_at INTEGER, keywords TEXT);
CREATE TABLE feature_community_members (id TEXT PRIMARY KEY, community_id TEXT, spring_node_id TEXT, membership_score REAL);
CREATE TABLE spring_symbols (id TEXT PRIMARY KEY, kind TEXT, springgraph_node_id TEXT, name TEXT, qualified_name TEXT, file_path TEXT, start_line INTEGER, end_line INTEGER, metadata TEXT, confidence REAL, created_at INTEGER, updated_at INTEGER);
CREATE TABLE spring_edges (id TEXT PRIMARY KEY, source_id TEXT, target_id TEXT, kind TEXT, metadata TEXT, confidence REAL, created_at INTEGER);
CREATE TABLE spring_endpoints (id TEXT PRIMARY KEY, method TEXT, path TEXT, handler_class_id TEXT, handler_method_id TEXT, source_file_path TEXT, source_line INTEGER);
CREATE TABLE spring_sql_statements (id TEXT PRIMARY KEY, mapper_id TEXT, sql_hash TEXT, sql_text TEXT, parameter_count INTEGER, tables TEXT, source_file_path TEXT, source_line INTEGER);
CREATE TABLE runtime_config_properties (id TEXT PRIMARY KEY, key TEXT, value_hash TEXT, is_sensitive INTEGER, source_file_path TEXT, source_line INTEGER, bean_id TEXT);
`;

function createDb(): SpringDatabase {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare('INSERT INTO spring_symbols VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('controller', 'controller', 'cg:1', 'OrderController', 'com.example.order.OrderController', 'OrderController.java', 10, 40, '{}', 1, 1, 1000);
  db.prepare('INSERT INTO spring_symbols VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('service', 'service', 'cg:2', 'OrderService', 'com.example.order.OrderService', 'OrderService.java', 5, 60, '{}', 1, 1, 2000);
  db.prepare('INSERT INTO spring_endpoints VALUES (?, ?, ?, ?, ?, ?, ?)').run('ep1', 'GET', '/orders', 'controller', 'service', 'OrderController.java', 12);
  return {
    getDb() {
      return db as unknown as ReturnType<SpringDatabase['getDb']>;
    },
  };
}

function graph(): { nodes: SpringKgNode[]; edges: SpringKgEdge[] } {
  return {
    nodes: [
      {
        id: 'controller',
        kind: 'controller',
        springgraphNodeId: 'cg:1',
        name: 'OrderController',
        qualifiedName: 'com.example.order.OrderController',
        filePath: 'OrderController.java',
        metadata: {},
        confidence: 1,
        createdAt: 1,
        updatedAt: 1000,
      },
      {
        id: 'service',
        kind: 'service',
        springgraphNodeId: 'cg:2',
        name: 'OrderService',
        qualifiedName: 'com.example.order.OrderService',
        filePath: 'OrderService.java',
        metadata: {},
        confidence: 1,
        createdAt: 1,
        updatedAt: 2000,
      },
    ],
    edges: [
      { id: 'call1', sourceId: 'controller', targetId: 'service', kind: 'CALLS', confidence: 1, createdAt: 1 },
    ],
  };
}

describe('DirtyQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('throttles rapid dirty marks into one persisted flush', async () => {
    const db = createDb();
    let loads = 0;
    const queue = new DirtyQueue({
      db,
      throttleMs: 60_000,
      graphLoader: async () => {
        loads += 1;
        return graph();
      },
      setTimeoutFn: setTimeout,
      clearTimeoutFn: clearTimeout,
    });

    queue.markDirty('OrderController.java');
    queue.markDirty('OrderService.java');
    queue.markDirty('OrderService.java');

    await vi.advanceTimersByTimeAsync(60_000);

    const raw = db.getDb();
    const communities = raw.prepare('SELECT COUNT(*) AS count FROM feature_communities').get() as { count: number };
    expect(loads).toBe(1);
    expect(communities.count).toBe(1);
  });

  it('flushes immediately when triggered manually', async () => {
    const db = createDb();
    const queue = new DirtyQueue({
      db,
      throttleMs: 60_000,
      graphLoader: async () => graph(),
      setTimeoutFn: setTimeout,
      clearTimeoutFn: clearTimeout,
    });

    queue.markDirty('OrderController.java');
    const processed = await queue.flush();

    expect(processed).toBe(1);
    const communities = db.getDb().prepare('SELECT COUNT(*) AS count FROM feature_communities').get() as { count: number };
    expect(communities.count).toBe(1);
  });

  it('is idempotent across repeated flushes of the same graph', async () => {
    const db = createDb();
    const queue = new DirtyQueue({
      db,
      throttleMs: 60_000,
      graphLoader: async () => graph(),
      setTimeoutFn: setTimeout,
      clearTimeoutFn: clearTimeout,
    });

    queue.markDirty('OrderController.java');
    await queue.flush();
    queue.markDirty('OrderController.java');
    await queue.flush();

    const raw = db.getDb();
    const communities = raw.prepare('SELECT COUNT(*) AS count FROM feature_communities').get() as { count: number };
    const members = raw.prepare('SELECT COUNT(*) AS count FROM feature_community_members').get() as { count: number };
    expect(communities.count).toBe(1);
    expect(members.count).toBe(2);
  });
});
