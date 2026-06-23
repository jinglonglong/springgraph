/**
 * Tests for the v7 schema migration introduced by the
 * init-performance change, phase 1, task 1.3
 * (openspec/changes/optimize-initialization-performance).
 *
 * v7 adds `files.cheap_hash` and `files.blob_oid` for the
 * incremental-skip path:
 *   - `cheap_hash` is the first-tier skip key (xxhash/blake3/SHA-1 of
 *     file content); the resolver compares a new file's cheap hash to
 *     this column and skips the expensive SHA-256 + parse path on a
 *     match. Backfilled from `content_hash` for existing rows so the
 *     column is populated immediately after the migration.
 *   - `blob_oid` is the git-native second-tier skip key; nullable.
 *
 * Two flavors of test, exercising the two `DatabaseConnection`
 * entry points:
 *
 *   1. **fresh-DB** via `DatabaseConnection.initialize` — runs
 *      `schema.sql` (which now includes the v7 columns) and records
 *      the schema version with the generic
 *      "Initial schema includes all migrations" description. The
 *      fresh-DB tests assert column / index presence only — the
 *      description assertion is intentionally NOT here, because
 *      `initialize` skips the migration history.
 *
 *   2. **v6 → v7** via `DatabaseConnection.open` — the only path
 *      that runs `runMigrations` for an existing database. We
 *      hand-build a minimal v6-shape database (just the `files`
 *      and `schema_versions` tables, no cheap_hash / blob_oid,
 *      schema_versions marked v=6), then call `open` and assert
 *      that v7 was applied: columns, index, backfill, and the v=7
 *      row's description (which is the migration's, not
 *      `initialize`'s generic one).
 *
 * Uses the built-in `node:sqlite` `DatabaseSync` (Node >= 22.5) and
 * the same `hasSqliteBindings` probe used by the rest of the suite.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Mirrors the detection in __tests__/pr19-improvements.test.ts.
function hasSqliteBindings(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.close();
    return true;
  } catch {
    return false;
  }
}

const HAS_SQLITE = hasSqliteBindings();

// =============================================================================
// Helpers
// =============================================================================

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'springgraph-init-mig-'));
}

function cleanupTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

/**
 * Build a minimal v6-shaped SQLite database at `dbPath`: just the
 * `files` table (without cheap_hash / blob_oid) and the
 * `schema_versions` table marked as version 6. Enough to exercise the
 * v6 → v7 transition through `DatabaseConnection.open`. We do NOT
 * reconstruct the full v1..v6 schema — `open` only needs the v=6
 * marker on `schema_versions` to decide which migrations to apply.
 */
function createV6ShapeDatabase(dbPath: string): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');

  // v6-shape: files has content_hash but no cheap_hash / blob_oid.
  // The v7 migration's ALTER TABLE statements will add those.
  db.exec(`
    CREATE TABLE files (
      path TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL,
      language TEXT NOT NULL,
      size INTEGER NOT NULL,
      modified_at INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL,
      node_count INTEGER DEFAULT 0,
      errors TEXT
    );
    CREATE TABLE schema_versions (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL,
      description TEXT
    );
    INSERT INTO schema_versions (version, applied_at, description)
    VALUES (6, 1700000000000, 'Test seed v6');
  `);

  // Sanity: no cheap_hash or blob_oid columns yet.
  const cols = db.prepare('PRAGMA table_info(files)').all() as Array<{
    name: string;
  }>;
  expect(cols.map((c) => c.name)).toContain('content_hash');
  expect(cols.map((c) => c.name)).not.toContain('cheap_hash');
  expect(cols.map((c) => c.name)).not.toContain('blob_oid');

  db.close();
}

function readColumns(dbPath: string): string[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbPath);
  const cols = db.prepare('PRAGMA table_info(files)').all() as Array<{
    name: string;
  }>;
  const names = cols.map((c) => c.name);
  db.close();
  return names;
}

function readIndexes(dbPath: string): string[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbPath);
  const indexes = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='files'`
    )
    .all() as Array<{ name: string }>;
  const names = indexes.map((i) => i.name);
  db.close();
  return names;
}

function readVersion(dbPath: string): number | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbPath);
  const row = db
    .prepare('SELECT MAX(version) as v FROM schema_versions')
    .get() as { v: number | null };
  db.close();
  return row.v;
}

function readVersionDescription(dbPath: string, version: number): string | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbPath);
  const row = db
    .prepare('SELECT description FROM schema_versions WHERE version = ?')
    .get(version) as { description: string | null } | undefined;
  db.close();
  return row?.description ?? null;
}

function readVersionList(dbPath: string): number[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbPath);
  const rows = db
    .prepare('SELECT version FROM schema_versions ORDER BY version')
    .all() as Array<{ version: number }>;
  db.close();
  return rows.map((r) => r.version);
}

// =============================================================================
// Tests — fresh-DB path (DatabaseConnection.initialize)
// =============================================================================

describe.skipIf(!HAS_SQLITE)('init-performance v7 — fresh-DB path', () => {
  let testDir: string;
  let dbPath: string;

  beforeEach(() => {
    testDir = makeTempDir();
    dbPath = path.join(testDir, 'springgraph.db');
  });

  afterEach(() => {
    cleanupTempDir(testDir);
  });

  it('a fresh DB has cheap_hash and blob_oid columns', async () => {
    const { DatabaseConnection } = await import('../src/db');
    DatabaseConnection.initialize(dbPath);

    const names = readColumns(dbPath);
    expect(names).toContain('content_hash');
    expect(names).toContain('cheap_hash');
    expect(names).toContain('blob_oid');
  });

  it('a fresh DB has the idx_files_cheap_hash index', async () => {
    const { DatabaseConnection } = await import('../src/db');
    DatabaseConnection.initialize(dbPath);

    const names = readIndexes(dbPath);
    expect(names).toContain('idx_files_cheap_hash');
  });

  it('CURRENT_SCHEMA_VERSION is 7', async () => {
    const { CURRENT_SCHEMA_VERSION } = await import('../src/db/migrations');
    expect(CURRENT_SCHEMA_VERSION).toBe(7);
  });
});

// =============================================================================
// Tests — v6 → v7 transition (DatabaseConnection.open)
// =============================================================================

describe.skipIf(!HAS_SQLITE)('init-performance v7 — v6 → v7 transition', () => {
  let testDir: string;
  let dbPath: string;

  beforeEach(() => {
    testDir = makeTempDir();
    dbPath = path.join(testDir, 'springgraph.db');
    createV6ShapeDatabase(dbPath);
  });

  afterEach(() => {
    cleanupTempDir(testDir);
  });

  it('open() adds cheap_hash and blob_oid columns to files', async () => {
    const { DatabaseConnection } = await import('../src/db');
    DatabaseConnection.open(dbPath).close();

    const names = readColumns(dbPath);
    expect(names).toContain('content_hash');
    expect(names).toContain('cheap_hash');
    expect(names).toContain('blob_oid');
  });

  it('open() adds the idx_files_cheap_hash index', async () => {
    const { DatabaseConnection } = await import('../src/db');
    DatabaseConnection.open(dbPath).close();

    const names = readIndexes(dbPath);
    expect(names).toContain('idx_files_cheap_hash');
  });

  it('open() records the v7 migration with the migration description (not initialize\'s generic text)', async () => {
    const { DatabaseConnection } = await import('../src/db');
    DatabaseConnection.open(dbPath).close();

    expect(readVersion(dbPath)).toBe(7);
    const desc = readVersionDescription(dbPath, 7);
    expect(desc).not.toBeNull();
    // The migration's own description, not the generic
    // "Initial schema includes all migrations" used by
    // DatabaseConnection.initialize for fresh DBs.
    expect(desc).toMatch(/cheap_hash.*blob_oid/);
    expect(desc).not.toMatch(/Initial schema includes all migrations/);
  });

  it('open() backfills cheap_hash from content_hash on existing rows', async () => {
    // Seed a row at v6 (files has content_hash but no cheap_hash).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite');
    const seed = new DatabaseSync(dbPath);
    seed
      .prepare(
        `INSERT INTO files (path, content_hash, language, size, modified_at, indexed_at, node_count)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run('src/example.ts', 'a1b2c3d4e5f6', 'typescript', 1234, 1700000000000, 1700000000000, 0);
    seed.close();

    const { DatabaseConnection } = await import('../src/db');
    DatabaseConnection.open(dbPath).close();

    const db = new DatabaseSync(dbPath);
    const row = db
      .prepare(
        `SELECT content_hash, cheap_hash, blob_oid FROM files WHERE path = ?`
      )
      .get('src/example.ts') as {
      content_hash: string;
      cheap_hash: string | null;
      blob_oid: string | null;
    };

    expect(row.cheap_hash).toBe(row.content_hash);
    // blob_oid is not backfilled — only git-native can populate it.
    expect(row.blob_oid).toBeNull();
    db.close();
  });

  it('open() is idempotent (re-running open does not duplicate the v=7 row)', async () => {
    const { DatabaseConnection } = await import('../src/db');
    DatabaseConnection.open(dbPath).close();
    DatabaseConnection.open(dbPath).close();
    DatabaseConnection.open(dbPath).close();

    const versions = readVersionList(dbPath);
    // Exactly one v=6 row (the seed) and one v=7 row (the migration).
    expect(versions).toEqual([6, 7]);
  });

  it('open() leaves blob_oid NULL for newly-inserted rows after migration', async () => {
    const { DatabaseConnection } = await import('../src/db');
    DatabaseConnection.open(dbPath).close();

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbPath);
    db.prepare(
      `INSERT INTO files (path, content_hash, language, size, modified_at, indexed_at, node_count)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('src/new.ts', 'newhash', 'typescript', 100, 1700000000000, 1700000000000, 0);

    const row = db
      .prepare('SELECT cheap_hash, blob_oid FROM files WHERE path = ?')
      .get('src/new.ts') as { cheap_hash: string | null; blob_oid: string | null };
    expect(row.cheap_hash).toBeNull();
    expect(row.blob_oid).toBeNull();
    db.close();
  });
});

// =============================================================================
// Placeholder so the file always reports at least one passing test on
// machines without the node:sqlite binding.
// =============================================================================

describe('init-performance v7 (no SQLite binding)', () => {
  it.skipIf(HAS_SQLITE)('is skipped when node:sqlite is unavailable', () => {
    expect(true).toBe(true);
  });
});
