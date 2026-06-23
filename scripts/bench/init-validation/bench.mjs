#!/usr/bin/env node
/**
 * init-performance validation harness.
 *
 * Runs `springgraph init` on a fixture project, measures wall-clock
 * time, and queries the resulting database for node/edge/file counts.
 * Compares the result to a baseline JSON (if --baseline is given) and
 * asserts: node/edge/file counts match exactly, time is within
 * `tolerancePct` of the baseline.
 *
 * Usage:
 *   node bench.mjs <binary> <fixture-dir> [--baseline <json>] [--tolerance-pct 20]
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const [, , binary, fixtureDir, ...rest] = process.argv;
if (!binary || !fixtureDir) {
  console.error('usage: node bench.mjs <binary> <fixture-dir> [--baseline <json>] [--tolerance-pct 20]');
  process.exit(1);
}

let baselinePath = null;
let tolerancePct = 20;
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '--baseline') baselinePath = rest[++i];
  else if (rest[i] === '--tolerance-pct') tolerancePct = Number(rest[++i]);
}

const springgraphDir = path.join(fixtureDir, '.springgraph');
if (fs.existsSync(springgraphDir)) {
  fs.rmSync(springgraphDir, { recursive: true, force: true });
}

const start = Date.now();
// `springgraph init` on master has no `-y` / `--quiet`; the run always
// prints the shimmer progress. The quiet flag was added on the
// feature branch to `index` only, not `init`. We just suppress
// stdio here so the bench output is the JSON result only.
const proc = spawnSync('node', [binary, 'init', fixtureDir, '-f'], {
  encoding: 'utf-8',
  stdio: ['ignore', 'ignore', 'ignore'],
  timeout: 600_000,
});
const wallMs = Date.now() - start;

if (proc.status !== 0) {
  console.error(`init failed: status=${proc.status}`);
  console.error('stdout:', proc.stdout);
  console.error('stderr:', proc.stderr);
  process.exit(1);
}

// Query the DB for counts. Use the same node:sqlite binding the rest
// of the project uses.
let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (err) {
  console.error('node:sqlite unavailable:', err.message);
  process.exit(1);
}

const dbPath = path.join(springgraphDir, 'springgraph.db');
const db = new DatabaseSync(dbPath, { readOnly: true });
const nodeCount = db.prepare('SELECT COUNT(*) as n FROM nodes').get().n;
const edgeCount = db.prepare('SELECT COUNT(*) as n FROM edges').get().n;
const fileCount = db.prepare('SELECT COUNT(*) as n FROM files').get().n;
const refCount = db.prepare('SELECT COUNT(*) as n FROM unresolved_refs').get().n;
db.close();

const result = {
  binary: path.basename(path.dirname(path.dirname(binary))),
  wallMs,
  filesIndexed: fileCount,
  nodesCreated: nodeCount,
  edgesCreated: edgeCount,
  unresolvedRefs: refCount,
};

console.log(JSON.stringify(result, null, 2));

// Optional: write the result to a file via the 4th positional arg.
const outFile = process.argv[5];
if (outFile) {
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
}

if (baselinePath && fs.existsSync(baselinePath)) {
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
  const checks = [
    ['filesIndexed', result.filesIndexed, baseline.filesIndexed],
    ['nodesCreated', result.nodesCreated, baseline.nodesCreated],
    ['edgesCreated', result.edgesCreated, baseline.edgesCreated],
    ['unresolvedRefs', result.unresolvedRefs, baseline.unresolvedRefs],
  ];
  let failed = false;
  for (const [name, got, want] of checks) {
    if (got !== want) {
      console.error(`  MISMATCH ${name}: got ${got}, want ${want}`);
      failed = true;
    } else {
      console.error(`  OK ${name}: ${got} === ${want}`);
    }
  }
  // Time tolerance: baseline * (1 + tolerancePct/100)
  const timeLimit = baseline.wallMs * (1 + tolerancePct / 100);
  const timeFloor = baseline.wallMs * (1 - tolerancePct / 100);
  if (result.wallMs > timeLimit) {
    console.error(`  REGRESSION: ${result.wallMs}ms > ${Math.round(timeLimit)}ms (+${tolerancePct}% of baseline ${baseline.wallMs}ms)`);
    failed = true;
  } else if (result.wallMs < timeFloor) {
    console.error(`  IMPROVEMENT: ${result.wallMs}ms < ${Math.round(timeFloor)}ms (-${tolerancePct}% of baseline ${baseline.wallMs}ms)`);
  } else {
    console.error(`  OK time: ${result.wallMs}ms within ±${tolerancePct}% of baseline ${baseline.wallMs}ms`);
  }
  if (failed) {
    process.exit(1);
  }
}
