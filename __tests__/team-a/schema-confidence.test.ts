import { describe, it, expect } from 'vitest';
import { makeTmpDir } from '../setup.js';
import { SpringDatabase } from '../../packages/springkg-core/src/db/spring-db.js';
import * as fs from 'fs';

describe('confidence column', () => {
  it('exists on spring_symbols with default 1.0', () => {
    const tmp = makeTmpDir('conf-sym-');
    try {
      const db = SpringDatabase.initialize(tmp);
      try {
        const cols = db.getDb().prepare("PRAGMA table_info(spring_symbols)").all() as Array<{ name: string; type: string; dflt_value: string }>;
        const conf = cols.find(c => c.name === 'confidence');
        expect(conf).toBeDefined();
        expect(conf!.type).toBe('REAL');
        expect(conf!.dflt_value).toBe('1.0');
      } finally {
        db.close();
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('exists on spring_edges with default 1.0', () => {
    const tmp = makeTmpDir('conf-edge-');
    try {
      const db = SpringDatabase.initialize(tmp);
      try {
        const cols = db.getDb().prepare("PRAGMA table_info(spring_edges)").all() as Array<{ name: string; type: string; dflt_value: string }>;
        const conf = cols.find(c => c.name === 'confidence');
        expect(conf).toBeDefined();
        expect(conf!.type).toBe('REAL');
        expect(conf!.dflt_value).toBe('1.0');
      } finally {
        db.close();
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('insert without confidence defaults to 1.0', () => {
    const tmp = makeTmpDir('conf-insert-');
    try {
      const db = SpringDatabase.initialize(tmp);
      try {
        db.getDb().prepare("INSERT INTO spring_symbols (id, kind, codegraph_node_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run('s:test:1', 'controller', 'cg:1', Date.now(), Date.now());
        const row = db.getDb().prepare("SELECT confidence FROM spring_symbols WHERE id = ?").get('s:test:1') as { confidence: number };
        expect(row.confidence).toBe(1.0);
      } finally {
        db.close();
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
