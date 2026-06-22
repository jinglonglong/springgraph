/**
 * Test helper: create a mock SpringKg with an in-memory springkg.db.
 *
 * Lets us unit-test CLI commands + MCP tools without needing a real
 * indexed project. Returns an object with the same shape as SpringKg
 * (db, cg, close, etc.) backed by a fresh in-memory database.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

export interface MockSpringKg {
  db: { getDb(): InstanceType<typeof DatabaseSync> };
  cg: Record<string, unknown>;
  close(): Promise<void>;
}

const SCHEMA_SQL = fs.readFileSync(
  path.join(__dirname, '..', '..', 'springkg-core', 'src', 'db', 'schema.sql'),
  'utf-8'
);

export function createMockSpringKg(opts: { projectPath?: string } = {}): MockSpringKg {
  const projectPath = opts.projectPath ?? fs.mkdtempSync(path.join(os.tmpdir(), 'springkg-test-'));
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  raw.exec(SCHEMA_SQL);
  return {
    db: { getDb: () => raw as unknown as InstanceType<typeof DatabaseSync> },
    cg: {},
    close: async () => {
      try { raw.close(); } catch { /* idempotent — command's finally block may have closed first */ }
    },
  };
}

export function seedEndpoint(db: InstanceType<typeof DatabaseSync>, row: {
  id?: string;
  method?: string;
  path: string;
  handler_class_id?: string;
  handler_method_id?: string;
  source_file_path?: string;
  source_line?: number;
}): void {
  db.prepare(`
    INSERT OR REPLACE INTO spring_endpoints (id, method, path, handler_class_id, handler_method_id, source_file_path, source_line)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id ?? `endpoint:${row.path}`,
    row.method ?? 'GET',
    row.path,
    row.handler_class_id ?? null,
    row.handler_method_id ?? null,
    row.source_file_path ?? 'src/Controller.java',
    row.source_line ?? 1
  );
}

export function seedFeignClient(db: InstanceType<typeof DatabaseSync>, row: {
  id?: string;
  client_name: string;
  target_service: string;
  target_url?: string;
  method_count?: number;
}): void {
  db.prepare(`
    INSERT OR REPLACE INTO spring_feign_clients (id, client_name, target_service, target_url, method_count)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    row.id ?? `feign:${row.client_name}`,
    row.client_name,
    row.target_service,
    row.target_url ?? null,
    row.method_count ?? 0
  );
}

export function seedSymbol(db: InstanceType<typeof DatabaseSync>, row: {
  id: string;
  kind: string;
  springgraph_node_id?: string;
  name?: string;
  qualified_name?: string;
  file_path?: string;
  start_line?: number;
  end_line?: number;
  metadata?: Record<string, unknown> | null;
  confidence?: number;
}): void {
  db.prepare(`
    INSERT OR REPLACE INTO spring_symbols (id, kind, springgraph_node_id, name, qualified_name, file_path, start_line, end_line, metadata, confidence, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id,
    row.kind,
    row.springgraph_node_id ?? `${row.kind}:${row.id}`,
    row.name ?? null,
    row.qualified_name ?? null,
    row.file_path ?? null,
    row.start_line ?? 0,
    row.end_line ?? 0,
    row.metadata ? JSON.stringify(row.metadata) : null,
    row.confidence ?? 1.0,
    Date.now(),
    Date.now()
  );
}

export function seedConfigProperty(db: InstanceType<typeof DatabaseSync>, row: {
  id?: string;
  key: string;
  value_hash: string;
  is_sensitive: boolean;
  source_file_path?: string;
  source_line?: number;
  bean_id?: string;
}): void {
  db.prepare(`
    INSERT OR REPLACE INTO runtime_config_properties (id, key, value_hash, is_sensitive, source_file_path, source_line, bean_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id ?? `config:${row.key}`,
    row.key,
    row.value_hash,
    row.is_sensitive ? 1 : 0,
    row.source_file_path ?? 'src/Config.java',
    row.source_line ?? 1,
    row.bean_id ?? null
  );
}

export function seedEdge(db: InstanceType<typeof DatabaseSync>, row: {
  id: string;
  source_id: string;
  target_id: string;
  kind: string;
  metadata?: Record<string, unknown> | null;
}): void {
  db.prepare(`
    INSERT OR REPLACE INTO spring_edges (id, source_id, target_id, kind, metadata, confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id,
    row.source_id,
    row.target_id,
    row.kind,
    row.metadata ? JSON.stringify(row.metadata) : null,
    1.0,
    Date.now()
  );
}
