/**
 * Resolve Worker Pool Tests
 *
 * These tests exercise the parallel reference-resolution worker pool. They
 * require the worker to be compiled to `dist/parallel-resolution/resolve-worker.js`,
 * so `npm run build` must run before the test suite.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Springgraph } from '../src';
import { ResolveWorkerPool } from '../src/parallel-resolution/resolve-pool';
import { QueryBuilder } from '../src/db/queries';
import { DatabaseConnection } from '../src/db';
import { removeDirWithRetries, safeCloseSpringgraph } from './setup';
import type { UnresolvedRef } from '../src/resolution/types';
import type { Node, UnresolvedReference } from '../src/types';

describe('ResolveWorkerPool', () => {
  let tempDir: string;
  let cg: Springgraph;
  let dbPath: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'springgraph-resolve-pool-'));
    cg = Springgraph.initSync(tempDir);
    dbPath = path.join(tempDir, '.springgraph', 'springgraph.db');
    // Initialize the resolver so framework detection runs.
    cg.reinitializeResolver();
  });

  afterEach(async () => {
    await safeCloseSpringgraph(cg);
    cg = undefined as unknown as Springgraph;
    await removeDirWithRetries(tempDir);
  });

  function readUnresolvedRefs(): UnresolvedRef[] {
    const db = DatabaseConnection.open(dbPath);
    try {
      const queries = new QueryBuilder(db.getDb());
      return queries.getUnresolvedReferencesBatch(0, 1000) as unknown as UnresolvedRef[];
    } finally {
      db.close();
    }
  }

  function insertNodesAndRefs(nodes: Node[], refs: UnresolvedReference[]): void {
    const db = DatabaseConnection.open(dbPath);
    const queries = new QueryBuilder(db.getDb());
    try {
      for (const node of nodes) {
        queries.insertNode(node);
      }
      queries.insertUnresolvedRefsBatch(refs);
    } finally {
      db.close();
    }
  }

  function makeNode(id: string, kind: Node['kind'], name: string, filePath: string, language: string, extra?: Partial<Node>): Node {
    return {
      id,
      kind,
      name,
      qualifiedName: `${filePath}::${name}`,
      filePath,
      language: language as Node['language'],
      startLine: 1,
      endLine: 10,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
      ...extra,
    };
  }

  it('resolves references using worker threads', async () => {
    const nodes: Node[] = [
      makeNode('func:a.ts:helper:1', 'function', 'helper', 'a.ts', 'typescript'),
      makeNode('func:a.ts:caller:1', 'function', 'caller', 'a.ts', 'typescript'),
    ];
    const refs: UnresolvedReference[] = [
      {
        fromNodeId: 'func:a.ts:caller:1',
        referenceName: 'helper',
        referenceKind: 'calls',
        line: 5,
        column: 0,
        filePath: 'a.ts',
        language: 'typescript',
      },
    ];
    insertNodesAndRefs(nodes, refs);

    const pool = new ResolveWorkerPool(tempDir, dbPath, 2, cg.getDetectedFrameworks());
    try {
      await pool.start();
      const unresolved = readUnresolvedRefs();
      expect(unresolved.length).toBe(1);

      const result = await pool.submitBatch(unresolved);
      expect(result.resolved.length).toBe(1);
      expect(result.resolved[0]!.targetNodeId).toBe('func:a.ts:helper:1');
      expect(result.unresolved.length).toBe(0);
    } finally {
      await pool.close();
    }
  });

  it('leaves unresolvable references in unresolved', async () => {
    const nodes: Node[] = [makeNode('func:b.ts:real:1', 'function', 'real', 'b.ts', 'typescript')];
    const refs: UnresolvedReference[] = [
      {
        fromNodeId: 'func:b.ts:real:1',
        referenceName: 'doesNotExist',
        referenceKind: 'calls',
        line: 2,
        column: 0,
        filePath: 'b.ts',
        language: 'typescript',
      },
    ];
    insertNodesAndRefs(nodes, refs);

    const pool = new ResolveWorkerPool(tempDir, dbPath, 2, cg.getDetectedFrameworks());
    try {
      await pool.start();
      const unresolved = readUnresolvedRefs();
      const result = await pool.submitBatch(unresolved);
      expect(result.resolved.length).toBe(0);
      expect(result.unresolved.length).toBe(1);
      expect(result.unresolved[0]!.referenceName).toBe('doesNotExist');
    } finally {
      await pool.close();
    }
  });

  it('emits aggregate progress across workers', async () => {
    const nodes: Node[] = [];
    const refs: UnresolvedReference[] = [];
    for (let i = 0; i < 20; i++) {
      const targetId = `func:p.ts:target${i}:1`;
      nodes.push(makeNode(targetId, 'function', `target${i}`, 'p.ts', 'typescript'));
      refs.push({
        fromNodeId: 'func:p.ts:caller:1',
        referenceName: `target${i}`,
        referenceKind: 'calls',
        line: i + 1,
        column: 0,
        filePath: 'p.ts',
        language: 'typescript',
      });
    }
    nodes.push(makeNode('func:p.ts:caller:1', 'function', 'caller', 'p.ts', 'typescript'));
    insertNodesAndRefs(nodes, refs);

    const progressCalls: Array<{ current: number; total: number }> = [];
    const pool = new ResolveWorkerPool(tempDir, dbPath, 2, cg.getDetectedFrameworks(), (current, total) => {
      progressCalls.push({ current, total });
    }, 0);
    try {
      await pool.start();
      const unresolved = readUnresolvedRefs();
      await pool.submitBatch(unresolved);
      expect(progressCalls.length).toBeGreaterThan(0);
      const last = progressCalls[progressCalls.length - 1]!;
      expect(last.total).toBeGreaterThan(0);
      expect(last.current).toBeGreaterThanOrEqual(last.total);
    } finally {
      await pool.close();
    }
  });

  it('returns deferred chain refs for a second pass', async () => {
    // Java-style chain: createFoo().bar where createFoo returns Foo and Foo has bar().
    const nodes: Node[] = [
      makeNode('class:c.java:Foo:1', 'class', 'Foo', 'Foo.java', 'java'),
      makeNode('method:c.java:Foo.bar:1', 'method', 'bar', 'Foo.java', 'java', {
        qualifiedName: 'Foo.java::Foo::bar',
      }),
      makeNode('method:c.java:createFoo:1', 'method', 'createFoo', 'Factory.java', 'java', {
        returnType: 'Foo',
      }),
    ];
    const refs: UnresolvedReference[] = [
      {
        fromNodeId: 'method:c.java:createFoo:1',
        referenceName: 'createFoo().bar',
        referenceKind: 'calls',
        line: 10,
        column: 0,
        filePath: 'Factory.java',
        language: 'java',
      },
    ];
    insertNodesAndRefs(nodes, refs);

    const pool = new ResolveWorkerPool(tempDir, dbPath, 2, cg.getDetectedFrameworks());
    try {
      await pool.start();
      const unresolved = readUnresolvedRefs();
      const result = await pool.submitBatch(unresolved);
      expect(result.deferredChainRefs.length).toBe(1);
      expect(result.deferredChainRefs[0]!.referenceName).toBe('createFoo().bar');
    } finally {
      await pool.close();
    }
  });

  it('gracefully aborts pending work', async () => {
    const nodes: Node[] = [];
    const refs: UnresolvedReference[] = [];
    for (let i = 0; i < 100; i++) {
      nodes.push(makeNode(`func:abort.ts:t${i}:1`, 'function', `t${i}`, 'abort.ts', 'typescript'));
      refs.push({
        fromNodeId: 'func:abort.ts:caller:1',
        referenceName: `t${i}`,
        referenceKind: 'calls',
        line: i + 1,
        column: 0,
        filePath: 'abort.ts',
        language: 'typescript',
      });
    }
    nodes.push(makeNode('func:abort.ts:caller:1', 'function', 'caller', 'abort.ts', 'typescript'));
    insertNodesAndRefs(nodes, refs);

    const pool = new ResolveWorkerPool(tempDir, dbPath, 4, cg.getDetectedFrameworks());
    await pool.start();

    const unresolved = readUnresolvedRefs();

    // Fire off several batches without awaiting, then abort.
    const promises: Promise<unknown>[] = [];
    for (let i = 0; i < 10; i++) {
      promises.push(pool.submitBatch(unresolved.slice(i * 10, (i + 1) * 10)));
    }
    pool.abort();

    await expect(Promise.all(promises)).rejects.toThrow('aborted');
  });

  it('emits per-worker progress callbacks that sum to the pool total', async () => {
    const nodeCount = 80;
    const nodes: Node[] = [];
    const refs: UnresolvedReference[] = [];
    nodes.push(makeNode('func:perw.ts:caller:1', 'function', 'caller', 'perw.ts', 'typescript'));
    for (let i = 0; i < nodeCount; i++) {
      nodes.push(makeNode(`func:perw.ts:helper${i}:1`, 'function', `helper${i}`, 'perw.ts', 'typescript'));
      refs.push({
        fromNodeId: 'func:perw.ts:caller:1',
        referenceName: `helper${i}`,
        referenceKind: 'calls',
        line: i + 1,
        column: 0,
        filePath: 'perw.ts',
        language: 'typescript',
      });
    }
    insertNodesAndRefs(nodes, refs);

    const samples: Array<{ id: number; current: number; total: number }[]> = [];
    const pool = new ResolveWorkerPool(
      tempDir,
      dbPath,
      3,
      cg.getDetectedFrameworks(),
      undefined,
      0, // disable aggregate throttle so per-worker fires on every event
      (workers) => samples.push(workers.map((w) => ({ ...w })))
    );
    try {
      await pool.start();
      const unresolved = readUnresolvedRefs();
      // Split into 4 small batches so multiple workers are exercised and
      // the pool's per-worker state visibly changes between snapshots.
      const batches = [
        unresolved.slice(0, 20),
        unresolved.slice(20, 40),
        unresolved.slice(40, 60),
        unresolved.slice(60, 80),
      ];
      await Promise.all(batches.map((b) => pool.submitBatch(b)));

      // Every snapshot must have exactly `threads` entries.
      expect(samples.length).toBeGreaterThan(0);
      for (const s of samples) {
        expect(s.length).toBe(3);
        for (const w of s) {
          expect(w.id).toBeGreaterThanOrEqual(0);
          expect(w.id).toBeLessThan(3);
          expect(w.current).toBeLessThanOrEqual(w.total);
        }
      }
      // The sum of per-worker totals must equal the total refs we submitted.
      const last = samples[samples.length - 1]!;
      const sumTotal = last.reduce((acc, w) => acc + w.total, 0);
      expect(sumTotal).toBe(nodeCount);
      // Every worker that received work must have advanced at least once.
      const lastIds = last.filter((w) => w.total > 0).map((w) => w.id).sort();
      expect(lastIds.length).toBeGreaterThan(1);
    } finally {
      await pool.close();
    }
  });
});
