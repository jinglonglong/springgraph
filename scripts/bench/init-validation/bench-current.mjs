#!/usr/bin/env node
/**
 * Quick single-binary bench. Runs init N times on the current build
 * and reports median wall-clock time. Use this after each phase to
 * measure incremental speedup vs the saved baseline report.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const [, , binary, fixtureDir, runsArg] = process.argv;
if (!binary || !fixtureDir || !runsArg) {
  console.error('usage: node bench-current.mjs <binary> <fixture-dir> <runs>');
  process.exit(1);
}
const N = Number(runsArg);

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function cleanSpringgraph() {
  const dir = path.join(fixtureDir, '.springgraph');
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function runOnce() {
  cleanSpringgraph();
  const start = Date.now();
  const proc = spawnSync('node', [binary, 'init', fixtureDir, '-f'], {
    encoding: 'utf-8',
    stdio: ['ignore', 'ignore', 'pipe'],
    timeout: 600_000,
  });
  const wallMs = Date.now() - start;
  if (proc.status !== 0) {
    // Show last 500 chars of stderr for debugging
    const stderr = (proc.stderr || '').slice(-500);
    throw new Error(`init failed: status=${proc.status} stderr=${stderr}`);
  }
  const { DatabaseSync } = require('node:sqlite');
  const dbPath = path.join(fixtureDir, '.springgraph', 'springgraph.db');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const counts = {
    nodeCount: db.prepare('SELECT COUNT(*) as n FROM nodes').get().n,
    edgeCount: db.prepare('SELECT COUNT(*) as n FROM edges').get().n,
    fileCount: db.prepare('SELECT COUNT(*) as n FROM files').get().n,
  };
  db.close();
  return { wallMs, ...counts };
}

const runs = [];
for (let i = 0; i < N; i++) {
  const r = runOnce();
  runs.push(r);
  console.error(`run ${i + 1}/${N}: ${r.wallMs}ms (files=${r.fileCount}, nodes=${r.nodeCount}, edges=${r.edgeCount})`);
}

const result = {
  binary: path.basename(path.dirname(path.dirname(binary))),
  runs,
  medianMs: median(runs.map((r) => r.wallMs)),
  minMs: Math.min(...runs.map((r) => r.wallMs)),
  maxMs: Math.max(...runs.map((r) => r.wallMs)),
  files: runs[0].fileCount,
  nodes: runs[0].nodeCount,
  edges: runs[0].edgeCount,
};
console.log('\n=== RESULT ===');
console.log(JSON.stringify(result, null, 2));
