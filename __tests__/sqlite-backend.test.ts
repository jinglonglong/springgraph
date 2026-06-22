/**
 * SQLite backend reporting.
 *
 * node:sqlite (Node's built-in real SQLite) is the sole backend. Pin that
 * DatabaseConnection / Springgraph report it and come up in WAL.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DatabaseConnection } from '../src/db';
import { Springgraph } from '../src';

describe('DatabaseConnection — backend reporting', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'springgraph-backend-'));
  });

  afterEach(() => {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports the node-sqlite backend in WAL for an initialized DB', () => {
    const conn = DatabaseConnection.initialize(path.join(dir, 'test.db'));
    expect(conn.getBackend()).toBe('node-sqlite');
    expect(conn.getJournalMode()).toBe('wal');
    conn.close();
  });

  it('Springgraph.getBackend() delegates to the underlying DatabaseConnection', async () => {
    fs.writeFileSync(path.join(dir, 'x.ts'), `export function x(): void {}\n`);
    const cg = await Springgraph.init(dir, { index: true });
    try {
      expect(cg.getBackend()).toBe('node-sqlite');
    } finally {
      cg.destroy();
    }
  });
});
