/**
 * SpringDatabase — wrapper around the springkg SQLite database.
 *
 * Mirrors the CodeGraph DatabaseConnection pattern: static factory methods,
 * configureConnection with exact PRAGMA order, transaction wrapper, and
 * schema-version bookkeeping via schema_versions.
 *
 * Uses node:sqlite directly (available in Node 22.5+) instead of
 * deep-importing CodeGraph's internal adapter, which is blocked by exports.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
import { runMigrations as runPendingMigrations, getCurrentVersion, CURRENT_SCHEMA_VERSION } from './migrations.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface RawStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  iterate(...params: unknown[]): IterableIterator<unknown>;
}

type SqliteDatabase = {
  prepare(sql: string): RawStatement;
  exec(sql: string): void;
  pragma(str: string, options?: { simple?: boolean }): unknown;
  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T;
  close(): void;
  readonly open: boolean;
};

function wrapDatabaseSync(raw: InstanceType<typeof DatabaseSync>): SqliteDatabase {
  const wrapped = raw as unknown as SqliteDatabase;

  (wrapped as Record<string, unknown>).pragma = function pragma(sql: string, options?: { simple?: boolean }): unknown {
    const pragmaBody = sql.replace(/^PRAGMA\s+/i, '').trim();
    const isSet = /^[A-Z_]+\s*=/.test(pragmaBody.toUpperCase());
    if (isSet) {
      raw.exec(`PRAGMA ${pragmaBody}`);
      return undefined;
    }
    const stmt = raw.prepare(`PRAGMA ${pragmaBody}`);
    const row = stmt.get() as Record<string, unknown> | undefined;
    if (options?.simple && row) {
      const vals = Object.values(row);
      return vals[0];
    }
    return row;
  };

  // Add transaction() wrapper
  (wrapped as Record<string, unknown>).transaction = function transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T {
    return (...args: unknown[]): T => {
      raw.exec('BEGIN');
      try {
        const result = fn(...args);
        raw.exec('COMMIT');
        return result;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    };
  };

  return wrapped;
}

function configureConnection(db: SqliteDatabase): void {
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000');
  db.pragma('temp_store = MEMORY');
  db.pragma('mmap_size = 268435456');
}

function getSpringDatabasePath(projectPath: string): string {
  return path.join(projectPath, '.codegraph', 'springkg.db');
}

function ensureDatabaseDirectory(dbPath: string): void {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function applySchema(db: SqliteDatabase): void {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);

  const currentVersion = getCurrentVersion(db);
  if (currentVersion < CURRENT_SCHEMA_VERSION) {
    db.prepare(
      'INSERT OR IGNORE INTO schema_versions (version, applied_at, description) VALUES (?, ?, ?)' 
    ).run(CURRENT_SCHEMA_VERSION, Date.now(), 'Initial schema');
  }

  runPendingMigrations(db, getCurrentVersion(db));
}

export class SpringDatabase {
  private static activeConnections = new Set<SpringDatabase>();

  private constructor(private db: SqliteDatabase, readonly path: string) {
    SpringDatabase.activeConnections.add(this);
  }

  static initializeDatabase(projectPath: string): string {
    const dbPath = getSpringDatabasePath(projectPath);
    ensureDatabaseDirectory(dbPath);

    const raw = new DatabaseSync(dbPath);
    const db = wrapDatabaseSync(raw);
    try {
      configureConnection(db);
      applySchema(db);
    } finally {
      db.close();
    }

    return dbPath;
  }

  static initialize(projectPath: string): SpringDatabase {
    const dbPath = SpringDatabase.initializeDatabase(projectPath);

    const raw = new DatabaseSync(dbPath);
    const db = wrapDatabaseSync(raw);
    configureConnection(db);

    return new SpringDatabase(db, dbPath);
  }

  static open(projectPath: string): SpringDatabase {
    const dbPath = getSpringDatabasePath(projectPath);

    if (!fs.existsSync(dbPath)) {
      throw new Error(`Database not found: ${dbPath}`);
    }

    const raw = new DatabaseSync(dbPath);
    const db = wrapDatabaseSync(raw);
    configureConnection(db);

    const springDb = new SpringDatabase(db, dbPath);
    springDb.runMigrations();

    return springDb;
  }

  getDb(): SqliteDatabase {
    return this.db;
  }

  getPath(): string {
    return this.path;
  }

  getJournalMode(): string {
    const raw = this.db.pragma('journal_mode');
    const row = Array.isArray(raw) ? raw[0] : raw;
    const mode = row && typeof row === 'object'
      ? (row as Record<string, unknown>).journal_mode
      : row;
    return String(mode ?? '').toLowerCase();
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  runMigrations(): void {
    const current = getCurrentVersion(this.db);
    if (current < CURRENT_SCHEMA_VERSION) {
      runPendingMigrations(this.db, current);
    }
  }

  isOpen(): boolean {
    return this.db !== null && this.db.open;
  }

  close(): void {
    this.db.close();
    SpringDatabase.activeConnections.delete(this);
  }

  static closeAll(): void {
    for (const conn of SpringDatabase.activeConnections) {
      try {
        if (conn.isOpen()) {
          conn.close();
        }
      } catch {}
    }
    SpringDatabase.activeConnections.clear();
  }
}

export { runMigrations, getCurrentVersion, CURRENT_SCHEMA_VERSION } from './migrations.js';
