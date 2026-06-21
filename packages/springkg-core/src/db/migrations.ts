/**
 * Database Migrations — springkg
 *
 * Manages schema_versions bookkeeping for springkg.db.
 * Migration 001 is the initial 8 data tables (already created by schema.sql
 * in a fresh DB; this migration exists for the upgrade path when opening a
 * pre-existing DB that has schema_versions but no data tables yet).
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// SqliteDatabase structural type (same as spring-db.ts)
type SqliteDatabase = {
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    iterate(...params: unknown[]): IterableIterator<unknown>;
  };
  exec(sql: string): void;
  pragma(str: string, options?: { simple?: boolean }): unknown;
  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T;
  close(): void;
  readonly open: boolean;
};

/**
 * Current schema version — bump when adding new migrations.
 */
export const CURRENT_SCHEMA_VERSION = 1;

/**
 * Get the current schema version from the database.
 * Returns 0 if schema_versions table doesn't exist yet.
 */
export function getCurrentVersion(db: SqliteDatabase): number {
  try {
    const row = db
      .prepare('SELECT MAX(version) as version FROM schema_versions')
      .get() as { version: number | null } | undefined;
    return row?.version ?? 0;
  } catch {
    // Table doesn't exist yet (shouldn't happen for a properly initialised DB)
    return 0;
  }
}

/**
 * Record a migration as applied in schema_versions.
 */
function recordMigration(db: SqliteDatabase, version: number, description: string): void {
  db.prepare(
    'INSERT INTO schema_versions (version, applied_at, description) VALUES (?, ?, ?)'
  ).run(version, Date.now(), description);
}

/**
 * Read a migration SQL file and execute it.
 */
function loadMigrationSql(filename: string): string {
  const filePath = path.join(__dirname, 'migrations', filename);
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Run all pending migrations from `fromVersion` up to CURRENT_SCHEMA_VERSION.
 *
 * Migration 001: creates the 8 data tables (spring_symbols, spring_edges,
 * spring_endpoints, spring_feign_clients, spring_sql_statements,
 * runtime_config_properties, feature_communities, feature_community_members).
 * It is only needed when opening a DB that has schema_versions but is missing
 * the data tables (e.g. a DB created before the schema was split into
 * schema.sql + migrations).
 */
export function runMigrations(db: SqliteDatabase, fromVersion: number): void {
  if (fromVersion >= CURRENT_SCHEMA_VERSION) {
    return;
  }

  const migrations: Array<{ version: number; description: string; filename: string }> = [
    {
      version: 1,
      description: 'Create 8 data tables: spring_symbols, spring_edges, spring_endpoints, spring_feign_clients, spring_sql_statements, runtime_config_properties, feature_communities, feature_community_members',
      filename: '001_initial_8_tables.sql',
    },
  ];

  const pending = migrations.filter((m) => m.version > fromVersion);

  if (pending.length === 0) {
    return;
  }

  pending.sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    db.transaction(() => {
      const sql = loadMigrationSql(migration.filename);
      db.exec(sql);
      recordMigration(db, migration.version, migration.description);
    })();
  }
}
