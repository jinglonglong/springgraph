import { describe, it, expect, afterEach } from 'vitest';
import { makeTmpDir } from '../setup.js';
import { SpringDatabase } from '../../packages/springkg-core/src/db/spring-db.js';
import * as fs from 'fs';

describe('WAL mode', () => {
  it('enables WAL on fresh database', () => {
    const tmp = makeTmpDir('wal-test-');
    afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

    const db = SpringDatabase.initialize(tmp);
    expect(db.getJournalMode()).toBe('wal');
    db.close();
  });

  it('preserves WAL on reopen', () => {
    const tmp = makeTmpDir('wal-reopen-');
    afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

    const a = SpringDatabase.initialize(tmp);
    a.close();
    const b = SpringDatabase.open(tmp);
    expect(b.getJournalMode()).toBe('wal');
    b.close();
  });
});

describe('Concurrent access', () => {
  it('two writers do not throw database-locked', () => {
    const tmp = makeTmpDir('concurrent-');
    afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

    const a = SpringDatabase.initialize(tmp);
    const b = SpringDatabase.open(tmp);

    // Both can write
    a.getDb().prepare("INSERT INTO spring_symbols (id, kind, codegraph_node_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run('s:a:1', 'controller', 'cg:1', Date.now(), Date.now());
    b.getDb().prepare("INSERT INTO spring_symbols (id, kind, codegraph_node_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run('s:b:1', 'service', 'cg:2', Date.now(), Date.now());

    const count = a.getDb().prepare("SELECT COUNT(*) as c FROM spring_symbols").get() as { c: number };
    expect(count.c).toBe(2);

    a.close();
    b.close();
  });
});
