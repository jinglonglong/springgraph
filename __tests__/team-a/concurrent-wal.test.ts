import { describe, it, expect } from 'vitest';
import { makeTmpDir } from '../setup.js';
import { SpringDatabase } from '../../packages/springkg-core/src/db/spring-db.js';
import * as fs from 'fs';

describe('WAL mode', () => {
  it('enables WAL on fresh database', () => {
    const tmp = makeTmpDir('wal-test-');
    try {
      const db = SpringDatabase.initialize(tmp);
      try {
        expect(db.getJournalMode()).toBe('wal');
      } finally {
        db.close();
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('preserves WAL on reopen', () => {
    const tmp = makeTmpDir('wal-reopen-');
    try {
      const a = SpringDatabase.initialize(tmp);
      a.close();
      const b = SpringDatabase.open(tmp);
      try {
        expect(b.getJournalMode()).toBe('wal');
      } finally {
        b.close();
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('Concurrent access', () => {
  it('two writers do not throw database-locked', () => {
    const tmp = makeTmpDir('concurrent-');
    try {
      const a = SpringDatabase.initialize(tmp);
      try {
        const b = SpringDatabase.open(tmp);
        try {
          a.getDb().prepare("INSERT INTO spring_symbols (id, kind, codegraph_node_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run('s:a:1', 'controller', 'cg:1', Date.now(), Date.now());
          b.getDb().prepare("INSERT INTO spring_symbols (id, kind, codegraph_node_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run('s:b:1', 'service', 'cg:2', Date.now(), Date.now());

          const count = a.getDb().prepare("SELECT COUNT(*) as c FROM spring_symbols").get() as { c: number };
          expect(count.c).toBe(2);
        } finally {
          b.close();
        }
      } finally {
        a.close();
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
