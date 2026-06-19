// packages/springkg-core/src/db/spring-db.ts
// SpringDatabase — WAL-mode SQLite wrapper for springkg.db

import * as fs from 'fs';
import * as path from 'path';
import { SPRINGKG_CONFIG } from '@colbymchenry/springkg-shared';

// ---------------------------------------------------------------------------
// SqliteDatabase interface (mirrors node:sqlite + our adapter wrapper)
// ---------------------------------------------------------------------------

interface SqliteStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  pragma(str: string): unknown;
  close(): void;
  readonly open: boolean;
}

// ---------------------------------------------------------------------------
// createDatabase factory
// ---------------------------------------------------------------------------

/**
 * Create a SqliteDatabase backed by Node's built-in `node:sqlite`.
 *
 * Acceptable import paths (in order of preference):
 *  1. @colbymchenry/codegraph/dist/db/sqlite-adapter.js  (deep import — stable)
 *  2. @colbymchenry/codegraph/dist/index.js             (re-exported factory)
 *  3. node:sqlite DatabaseSync                          (builtin, no wrapper)
 */
function createDatabase(dbPath: string): { db: SqliteDatabase; backend: 'node-sqlite' } {
  // Try deep import first (the intended path)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@colbymchenry/codegraph/dist/db/sqlite-adapter.js') as {
      createDatabase: (path: string) => { db: SqliteDatabase };
    };
    const { db } = mod.createDatabase(dbPath);
    return { db, backend: 'node-sqlite' };
  } catch {
    // Try index re-export
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('@colbymchenry/codegraph/dist/index.js') as {
        createDatabase: (path: string) => { db: SqliteDatabase };
      };
      if (typeof mod.createDatabase === 'function') {
        const { db } = mod.createDatabase(dbPath);
        return { db, backend: 'node-sqlite' };
      }
    } catch {
      // fall through to builtin
    }

    // Builtin fallback — wrap DatabaseSync in a SqliteDatabase-compatible interface
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { DatabaseSync } = require('node:sqlite');
      const _db = new DatabaseSync(dbPath) as {
        prepare(sql: string): SqliteStatement;
        exec(sql: string): void;
        get isOpen(): boolean;
        close(): void;
      };
      const db: SqliteDatabase = {
        prepare(sql: string): SqliteStatement {
          const stmt = _db.prepare(sql);
          return {
            run(...params: unknown[]) {
              const r = stmt.run(...params);
              return { changes: Number(r?.changes ?? 0), lastInsertRowid: r?.lastInsertRowid ?? 0n };
            },
            get(...params: unknown[]) { return stmt.get(...params); },
            all(...params: unknown[]) { return stmt.all(...params); },
          };
        },
        exec(sql: string): void { _db.exec(sql); },
        pragma(str: string): unknown {
          const trimmed = str.trim();
          if (trimmed.includes('=')) {
            _db.exec(`PRAGMA ${trimmed}`);
            return;
          }
          const row = _db.prepare(`PRAGMA ${trimmed}`).get();
          return row;
        },
        close(): void { if (_db.isOpen) _db.close(); },
        get open(): boolean { return _db.isOpen; },
      };
      return { db, backend: 'node-sqlite' };
    } catch (err) {
      throw new Error(
        'SpringDatabase requires Node.js 22.5+ with the built-in node:sqlite module.\n' +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Unreachable but satisfies TypeScript
  throw new Error('SpringDatabase: could not resolve a SQLite backend');
}

// ---------------------------------------------------------------------------
// SpringDatabase
// ---------------------------------------------------------------------------

/**
 * WAL-mode SQLite wrapper for `.codegraph/springkg.db`.
 *
 * Mirrors the `DatabaseConnection` pattern from CodeGraph but scoped to the
 * springkg schema and config exposed by `@colbymchenry/springkg-shared`.
 */
export class SpringDatabase {
  private db: SqliteDatabase;
  private dbPath: string;
  private _closed: boolean = false;

  private constructor(db: SqliteDatabase, dbPath: string) {
    this.db = db;
    this.dbPath = dbPath;
  }

  // -------------------------------------------------------------------------
  // Static factories
  // -------------------------------------------------------------------------

  /**
   * Create a new springkg.db — creates the `.codegraph/` directory, opens the
   * DB, applies all PRAGMAs, loads the schema, and runs any pending migrations.
   */
  static initialize(projectPath: string): SpringDatabase {
    const dbPath = path.join(projectPath, '.codegraph', SPRINGKG_CONFIG.db.filename);
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const { db } = createDatabase(dbPath);
    configureConnection(db);

    // Load schema — copy-assets produces springkg-schema.sql in dist,
    // but source still has schema.sql (for tsx dev runs)
    const schemaPath = fs.existsSync(path.join(__dirname, 'springkg-schema.sql'))
      ? path.join(__dirname, 'springkg-schema.sql')
      : path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(schema);

    // Ensure initial version is recorded so re-open doesn't re-apply the schema
    const currentVersion = getCurrentVersion(db);
    if (currentVersion === 0) {
      db.prepare(
        'INSERT OR IGNORE INTO schema_versions (version, applied_at, description) VALUES (?, ?, ?)'
      ).run(1, Date.now(), 'Initial schema');
    }

    const inst = new SpringDatabase(db, dbPath);
    inst.runMigrations();
    return inst;
  }

  /**
   * Open an existing springkg.db. Throws if the file does not exist.
   */
  static open(projectPath: string): SpringDatabase {
    const dbPath = path.join(projectPath, '.codegraph', SPRINGKG_CONFIG.db.filename);
    if (!fs.existsSync(dbPath)) {
      throw new Error(`SpringDatabase: database not found at ${dbPath}`);
    }

    const { db } = createDatabase(dbPath);
    configureConnection(db);

    const inst = new SpringDatabase(db, dbPath);
    inst.runMigrations();
    return inst;
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  getDb(): unknown {
    return this.db;
  }

  getPath(): string {
    return this.dbPath;
  }

  getJournalMode(): string {
    const raw = this.db.pragma('journal_mode');
    const row = Array.isArray(raw) ? raw[0] : raw;
    const mode = row && typeof row === 'object'
      ? (row as Record<string, unknown>).journal_mode
      : row;
    return String(mode ?? '').toLowerCase();
  }

  isOpen(): boolean {
    return this._closed === false && this.db.open;
  }

  // -------------------------------------------------------------------------
  // Transaction
  // -------------------------------------------------------------------------

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Migrations
  // -------------------------------------------------------------------------

  /**
   * Read `db/migrations/NNN_*.sql`, apply each whose version is newer than the
   * current `schema_versions.version`, one transaction per file.
   */
  runMigrations(): void {
    const migrationsDir = path.join(__dirname, 'migrations');
    if (!fs.existsSync(migrationsDir)) return;

    const files = fs.readdirSync(migrationsDir)
      .filter(f => /^\d{3,}_.+\.sql$/.test(f))
      .sort();

    const currentVersion = getCurrentVersion(this.db);

    for (const file of files) {
      const versionStr = file.split('_')[0];
      if (versionStr === undefined) continue;
      const version = parseInt(versionStr, 10);
      if (isNaN(version) || version <= currentVersion) continue;

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      this.db.exec('BEGIN');
      try {
        this.db.exec(sql);
        this.db.prepare(
          'INSERT INTO schema_versions (version, applied_at, description) VALUES (?, ?, ?)'
        ).run(version, Date.now(), file);
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw new Error(`SpringDatabase migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Close
  // -------------------------------------------------------------------------

  /**
   * Close the underlying connection. Idempotent — safe to call multiple times.
   */
  close(): void {
    if (this._closed) return;
    this._closed = true;
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function configureConnection(db: SqliteDatabase): void {
  db.pragma('busy_timeout = 5000');       // MUST be first
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000');
  db.pragma('temp_store = MEMORY');
}

function getCurrentVersion(db: SqliteDatabase): number {
  try {
    const row = db
      .prepare('SELECT MAX(version) as version FROM schema_versions')
      .get() as { version: number | null } | undefined;
    return row?.version ?? 0;
  } catch {
    return 0;
  }
}
