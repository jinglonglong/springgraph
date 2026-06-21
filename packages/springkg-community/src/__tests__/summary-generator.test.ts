import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

import type { FeatureCommunity, SpringDatabase } from '../types.js';
import { SummaryGenerator } from '../summary-generator.js';

function createDb(schemaSql: string): SpringDatabase {
  const db = new DatabaseSync(':memory:');
  db.exec(schemaSql);
  return {
    getDb() {
      return db as unknown as ReturnType<SpringDatabase['getDb']>;
    },
  };
}

const BASE_SCHEMA = `
CREATE TABLE feature_communities (id TEXT PRIMARY KEY, label TEXT, summary TEXT DEFAULT '', member_count INTEGER DEFAULT 0, dirty INTEGER DEFAULT 1, last_summarized_at INTEGER, keywords TEXT);
CREATE TABLE feature_community_members (id TEXT PRIMARY KEY, community_id TEXT, spring_node_id TEXT, membership_score REAL);
CREATE TABLE spring_symbols (id TEXT PRIMARY KEY, kind TEXT, codegraph_node_id TEXT, name TEXT, qualified_name TEXT, file_path TEXT, start_line INTEGER, end_line INTEGER, metadata TEXT, confidence REAL, created_at INTEGER, updated_at INTEGER);
CREATE TABLE spring_edges (id TEXT PRIMARY KEY, source_id TEXT, target_id TEXT, kind TEXT, metadata TEXT, confidence REAL, created_at INTEGER);
CREATE TABLE spring_endpoints (id TEXT PRIMARY KEY, method TEXT, path TEXT, handler_class_id TEXT, handler_method_id TEXT, source_file_path TEXT, source_line INTEGER);
CREATE TABLE spring_sql_statements (id TEXT PRIMARY KEY, mapper_id TEXT, sql_hash TEXT, sql_text TEXT, parameter_count INTEGER, tables TEXT, source_file_path TEXT, source_line INTEGER);
CREATE TABLE runtime_config_properties (id TEXT PRIMARY KEY, key TEXT, value_hash TEXT, is_sensitive INTEGER, source_file_path TEXT, source_line INTEGER, bean_id TEXT);
`;

function community(overrides: Partial<FeatureCommunity> = {}): FeatureCommunity {
  return {
    id: overrides.id ?? 'community:order',
    label: overrides.label ?? 'order',
    summary: overrides.summary ?? '',
    memberCount: overrides.memberCount ?? 3,
    dirty: overrides.dirty ?? true,
    lastSummarizedAt: overrides.lastSummarizedAt,
    dominantPackage: overrides.dominantPackage ?? 'order',
    keywords: overrides.keywords ?? [],
    memberSpringNodeIds: overrides.memberSpringNodeIds ?? ['controller', 'service', 'mapper'],
  };
}

describe('SummaryGenerator', () => {
  it('generates all seven sections from indexed community data', () => {
    const db = createDb(BASE_SCHEMA);
    const raw = db.getDb();
    raw.prepare('INSERT INTO feature_communities (id, label, member_count, dirty) VALUES (?, ?, ?, ?)').run('community:order', 'order', 3, 1);
    raw.prepare('INSERT INTO feature_community_members (id, community_id, spring_node_id, membership_score) VALUES (?, ?, ?, ?)').run('m1', 'community:order', 'controller', 1);
    raw.prepare('INSERT INTO feature_community_members (id, community_id, spring_node_id, membership_score) VALUES (?, ?, ?, ?)').run('m2', 'community:order', 'service', 1);
    raw.prepare('INSERT INTO feature_community_members (id, community_id, spring_node_id, membership_score) VALUES (?, ?, ?, ?)').run('m3', 'community:order', 'mapper', 1);
    raw.prepare('INSERT INTO spring_symbols VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('controller', 'controller', 'cg:1', 'OrderController', 'com.example.order.OrderController', 'OrderController.java', 10, 50, '{"doc":"handles order create"}', 1, 1, 1000);
    raw.prepare('INSERT INTO spring_symbols VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('service', 'service', 'cg:2', 'OrderService', 'com.example.order.OrderService', 'OrderService.java', 5, 80, '{"doc":"process order"}', 1, 1, 2000);
    raw.prepare('INSERT INTO spring_symbols VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('mapper', 'mapper', 'cg:3', 'OrderMapper', 'com.example.order.OrderMapper', 'OrderMapper.xml', 1, 20, '{}', 1, 1, 3000);
    raw.prepare('INSERT INTO spring_endpoints VALUES (?, ?, ?, ?, ?, ?, ?)').run('e1', 'POST', '/orders', 'controller', 'service', 'OrderController.java', 12);
    raw.prepare('INSERT INTO spring_sql_statements VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('sql1', 'mapper', 'hash1', 'SELECT * FROM orders WHERE id = ?', 1, '["orders"]', 'OrderMapper.xml', 4);
    raw.prepare('INSERT INTO runtime_config_properties VALUES (?, ?, ?, ?, ?, ?, ?)').run('cfg1', 'spring.datasource.password', 'hash', 1, 'application.yml', 8, null);
    raw.prepare('INSERT INTO spring_edges VALUES (?, ?, ?, ?, ?, ?, ?)').run('used1', 'cfg1', 'service', 'USED_BY', null, 1, 1);
    raw.prepare('INSERT INTO feature_communities (id, label, summary, member_count, dirty) VALUES (?, ?, ?, ?, ?)').run('community:payments', 'payments', 'payment summary', 1, 0);
    raw.prepare('INSERT INTO feature_community_members (id, community_id, spring_node_id, membership_score) VALUES (?, ?, ?, ?)').run('m4', 'community:payments', 'payment-service', 1);
    raw.prepare('INSERT INTO spring_edges VALUES (?, ?, ?, ?, ?, ?, ?)').run('cross1', 'service', 'payment-service', 'CALLS', null, 1, 1);

    const summary = new SummaryGenerator().generate(community(), db);

    expect(summary.match(/^## /gm)).toHaveLength(7);
    expect(summary).toContain('POST /orders');
    expect(summary).toContain('OrderService');
    expect(summary).toContain('SELECT * FROM orders');
    expect(summary).toContain('spring.datasource.password');
    expect(summary).toContain('payments');
  });

  it('handles an empty community gracefully', () => {
    const db = createDb(BASE_SCHEMA);
    const summary = new SummaryGenerator().generate(community({ memberCount: 0, memberSpringNodeIds: [] }), db);

    expect(summary.match(/^## /gm)).toHaveLength(7);
    expect(summary).toContain('_No endpoint members._');
    expect(summary).toContain('_No services, controllers, or Feign clients found._');
  });

  it('degrades safely when optional tables are missing', () => {
    const db = createDb(`
      CREATE TABLE feature_communities (id TEXT PRIMARY KEY, label TEXT, summary TEXT DEFAULT '', member_count INTEGER DEFAULT 0, dirty INTEGER DEFAULT 1, last_summarized_at INTEGER);
      CREATE TABLE feature_community_members (id TEXT PRIMARY KEY, community_id TEXT, spring_node_id TEXT, membership_score REAL);
      CREATE TABLE spring_symbols (id TEXT PRIMARY KEY, kind TEXT, codegraph_node_id TEXT, name TEXT, qualified_name TEXT, file_path TEXT, start_line INTEGER, end_line INTEGER, metadata TEXT, confidence REAL, created_at INTEGER, updated_at INTEGER);
    `);
    const raw = db.getDb();
    raw.prepare('INSERT INTO spring_symbols VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('service', 'service', 'cg:1', 'OrderService', 'com.example.order.OrderService', 'OrderService.java', 5, 80, '{}', 1, 1, 2000);
    raw.prepare('INSERT INTO feature_community_members (id, community_id, spring_node_id, membership_score) VALUES (?, ?, ?, ?)').run('m1', 'community:order', 'service', 1);

    const summary = new SummaryGenerator().generate(community({ memberSpringNodeIds: ['service'] }), db);

    expect(summary).toContain('Unavailable: spring_endpoints table missing');
    expect(summary).toContain('Unavailable: runtime_config_properties table missing');
  });
});
