#!/usr/bin/env node
/**
 * Multi-run benchmark: run init N times on each binary, report median
 * wall-clock + the per-run breakdown.
 *
 * Usage: node bench-multi.mjs <master-bin> <current-bin> <fixture-dir> <runs>
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const [, , masterBin, currentBin, fixtureDir, runsArg] = process.argv;
if (!masterBin || !currentBin || !fixtureDir || !runsArg) {
  console.error('usage: node bench-multi.mjs <master-bin> <current-bin> <fixture-dir> <runs>');
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

function runOnce(binary) {
  cleanSpringgraph();
  const start = Date.now();
  const proc = spawnSync('node', [binary, 'init', fixtureDir, '-f'], {
    encoding: 'utf-8',
    stdio: ['ignore', 'ignore', 'ignore'],
    timeout: 600_000,
  });
  const wallMs = Date.now() - start;
  if (proc.status !== 0) throw new Error(`init failed: status=${proc.status} stderr=${proc.stderr}`);

  // Read DB counts.
  const { DatabaseSync } = require('node:sqlite');
  const dbPath = path.join(fixtureDir, '.springgraph', 'springgraph.db');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const nodeCount = db.prepare('SELECT COUNT(*) as n FROM nodes').get().n;
  const edgeCount = db.prepare('SELECT COUNT(*) as n FROM edges').get().n;
  const fileCount = db.prepare('SELECT COUNT(*) as n FROM files').get().n;
  const refCount = db.prepare('SELECT COUNT(*) as n FROM unresolved_refs').get().n;
  db.close();
  return { wallMs, filesIndexed: fileCount, nodes: nodeCount, edges: edgeCount, refs: refCount };
}

function benchmark(label, binary) {
  const runs = [];
  for (let i = 0; i < N; i++) {
    const r = runOnce(binary);
    runs.push(r);
    console.error(`${label} run ${i + 1}/${N}: ${r.wallMs}ms (files=${r.filesIndexed}, nodes=${r.nodes}, edges=${r.edges}, refs=${r.refs})`);
  }
  return {
    label,
    binary,
    runs,
    medianMs: median(runs.map((r) => r.wallMs)),
    minMs: Math.min(...runs.map((r) => r.wallMs)),
    maxMs: Math.max(...runs.map((r) => r.wallMs)),
    filesIndexed: runs[0].filesIndexed,
    nodes: runs[0].nodes,
    edges: runs[0].edges,
    refs: runs[0].refs,
  };
}

const master = benchmark('master', masterBin);
const current = benchmark('current', currentBin);

const speedup = master.medianMs / current.medianMs;
const deltaPct = ((current.medianMs - master.medianMs) / master.medianMs) * 100;

const report = {
  fixture: fixtureDir,
  runsPerBinary: N,
  master,
  current,
  medianSpeedupX: Number(speedup.toFixed(3)),
  medianDeltaPct: Number(deltaPct.toFixed(1)),
  outputConsistent:
    master.filesIndexed === current.filesIndexed &&
    master.nodes === current.nodes &&
    master.edges === current.edges &&
    master.refs === current.refs,
};

console.log('\n=== REPORT ===');
console.log(JSON.stringify(report, null, 2));

if (!report.outputConsistent) {
  console.error('\n!! OUTPUT MISMATCH !!');
  process.exit(1);
}
