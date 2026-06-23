/**
 * Database Migrations
 *
 * Schema versioning and migration support.
 */

import { SqliteDatabase } from './sqlite-adapter';

/**
 * Current schema version
 */
export const CURRENT_SCHEMA_VERSION = 7;

/**
 * Migration definition
 */
interface Migration {
  version: number;
  description: string;
  up: (db: SqliteDatabase) => void;
}

/**
 * All migrations in order
 *
 * Note: Version 1 is the initial schema, handled by schema.sql
 * Future migrations go here.
 */
const migrations: Migration[] = [
  {
    version: 2,
    description: 'Add project metadata, provenance tracking, and unresolved ref context',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS project_metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        ALTER TABLE unresolved_refs ADD COLUMN file_path TEXT NOT NULL DEFAULT '';
        ALTER TABLE unresolved_refs ADD COLUMN language TEXT NOT NULL DEFAULT 'unknown';
        ALTER TABLE edges ADD COLUMN provenance TEXT DEFAULT NULL;
        CREATE INDEX IF NOT EXISTS idx_unresolved_file_path ON unresolved_refs(file_path);
        CREATE INDEX IF NOT EXISTS idx_edges_provenance ON edges(provenance);
      `);
    },
  },
  {
    version: 3,
    description: 'Add lower(name) expression index for memory-efficient case-insensitive lookups',
    up: (db) => {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_nodes_lower_name ON nodes(lower(name));
      `);
    },
  },
  {
    version: 4,
    description:
      'Drop redundant idx_edges_source / idx_edges_target (covered by source_kind / target_kind composites)',
    up: (db) => {
      db.exec(`
        DROP INDEX IF EXISTS idx_edges_source;
        DROP INDEX IF EXISTS idx_edges_target;
      `);
    },
  },
  {
    version: 5,
    description:
      'Add nodes.return_type — normalized return/result type for receiver-type inference (C++ singletons/factories, #645)',
    up: (db) => {
      db.exec(`
        ALTER TABLE nodes ADD COLUMN return_type TEXT;
      `);
    },
  },
  {
    version: 6,
    description:
      'Add nodes.metadata — JSON object for architecture engine role/layer/module annotations',
    up: (db) => {
      db.exec(`
        ALTER TABLE nodes ADD COLUMN metadata TEXT;
      `);
    },
  },
  {
    // init-performance change, phase 1, task 1.3
    // (openspec/changes/optimize-initialization-performance/specs/incremental-content-hash).
    // The cheap_hash column is the first-tier skip key for `springgraph
    // init` on a tree whose files are byte-identical to the previous
    // index — the resolver compares the new file's xxhash/blake3/SHA-1
    // to files.cheap_hash and skips the SHA-256 + parse path on a match.
    // blob_oid is populated by the git-native-enumeration capability
    // and used as a free strong content key in git mode.
    version: 7,
    description:
      'Add files.cheap_hash + files.blob_oid for the init incremental-skip path; backfill cheap_hash from content_hash',
    up: (db) => {
      db.exec(`
        ALTER TABLE files ADD COLUMN cheap_hash TEXT;
        ALTER TABLE files ADD COLUMN blob_oid TEXT;
        -- Backfill cheap_hash from content_hash so the column is
        -- populated immediately after the migration. Note: on the next
        -- init the cheap-hash check will (almost always) fail because
        -- the stored value is a SHA-256 hex string, not an xxhash of
        -- the file content — so the resolver escalates to the strong
        -- hash, which DOES match, and skips. cheap_hash gets rewritten
        -- with the real xxhash for the next run. The first init after
        -- migration is therefore not skipped (expected) but every init
        -- from then on is.
        UPDATE files SET cheap_hash = content_hash WHERE cheap_hash IS NULL;
        -- Cover the first-tier skip path. The query planner will use
        -- this when cheap_hash is the only filter (the common case
        -- during a re-init on an unchanged tree).
        CREATE INDEX IF NOT EXISTS idx_files_cheap_hash ON files(cheap_hash);
      `);
    },
  },
];

/**
 * Get the current schema version from the database
 */
export function getCurrentVersion(db: SqliteDatabase): number {
  try {
    const row = db
      .prepare('SELECT MAX(version) as version FROM schema_versions')
      .get() as { version: number | null } | undefined;
    return row?.version ?? 0;
  } catch {
    // Table doesn't exist yet
    return 0;
  }
}

/**
 * Record a migration as applied
 */
function recordMigration(db: SqliteDatabase, version: number, description: string): void {
  db.prepare(
    'INSERT INTO schema_versions (version, applied_at, description) VALUES (?, ?, ?)'
  ).run(version, Date.now(), description);
}

/**
 * Run all pending migrations
 */
export function runMigrations(db: SqliteDatabase, fromVersion: number): void {
  const pending = migrations.filter((m) => m.version > fromVersion);

  if (pending.length === 0) {
    return;
  }

  // Sort by version
  pending.sort((a, b) => a.version - b.version);

  // Run each migration in a transaction
  for (const migration of pending) {
    db.transaction(() => {
      migration.up(db);
      recordMigration(db, migration.version, migration.description);
    })();
  }
}

/**
 * Check if the database needs migration
 */
export function needsMigration(db: SqliteDatabase): boolean {
  const current = getCurrentVersion(db);
  return current < CURRENT_SCHEMA_VERSION;
}

/**
 * Get list of pending migrations
 */
export function getPendingMigrations(db: SqliteDatabase): Migration[] {
  const current = getCurrentVersion(db);
  return migrations
    .filter((m) => m.version > current)
    .sort((a, b) => a.version - b.version);
}

/**
 * Get migration history from database
 */
export function getMigrationHistory(
  db: SqliteDatabase
): Array<{ version: number; appliedAt: number; description: string | null }> {
  const rows = db
    .prepare('SELECT version, applied_at, description FROM schema_versions ORDER BY version')
    .all() as Array<{ version: number; applied_at: number; description: string | null }>;

  return rows.map((row) => ({
    version: row.version,
    appliedAt: row.applied_at,
    description: row.description,
  }));
}
