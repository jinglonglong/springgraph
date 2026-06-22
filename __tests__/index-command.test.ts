/**
 * Regression coverage for issue #874: `springgraph index` produced 0 nodes / 0
 * edges while `springgraph init` worked, and appeared to wipe the graph.
 *
 * Root cause: `index` ran a full extraction against the already-populated DB
 * without clearing it first. Every file's content hash still matched, so the
 * orchestrator skipped re-inserting all of them, and the run reported its delta
 * (after - before = 0) as "0 nodes, 0 edges". The fix makes `index` a true full
 * rebuild — clear, then re-index — so it produces the same complete result as a
 * fresh `init`.
 *
 * Exercised end-to-end against the built binary so the CLI wiring (not just the
 * library) is covered.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Springgraph } from '../src';

const BIN = path.resolve(__dirname, '../dist/bin/springgraph.js');

function runSpringgraph(args: string[], cwd: string): string {
  return execFileSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, SPRINGGRAPH_NO_DAEMON: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function graphCounts(dir: string): { nodes: number; edges: number } {
  const cg = Springgraph.openSync(dir);
  try {
    const stats = cg.getStats();
    return { nodes: stats.nodeCount, edges: stats.edgeCount };
  } finally {
    cg.close();
  }
}

describe('springgraph index — full re-index keeps the graph populated (#874)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'springgraph-index-cmd-'));
    // A couple of files with a call edge so there is a non-trivial graph to
    // (fail to) reproduce.
    fs.writeFileSync(
      path.join(tempDir, 'a.ts'),
      `export function greet(name: string) { return hello(name); }\n` +
        `export function hello(n: string) { return 'hi ' + n; }\n`,
    );
    fs.writeFileSync(
      path.join(tempDir, 'b.ts'),
      `import { greet } from './a';\nexport function main() { return greet('world'); }\n`,
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('reproduces init\'s node/edge counts instead of emptying the index', () => {
    runSpringgraph(['init'], tempDir);
    const afterInit = graphCounts(tempDir);
    expect(afterInit.nodes).toBeGreaterThan(0);
    expect(afterInit.edges).toBeGreaterThan(0);

    const out = runSpringgraph(['index'], tempDir);
    const afterIndex = graphCounts(tempDir);

    // The graph is still fully populated — `index` rebuilt it, it did not wipe it.
    expect(afterIndex.nodes).toBe(afterInit.nodes);
    expect(afterIndex.edges).toBe(afterInit.edges);

    // ...and the CLI reported the real counts, never the misleading "0 nodes".
    expect(out).not.toMatch(/\b0 nodes, 0 edges\b/);
    expect(out).toMatch(new RegExp(`\\b${afterInit.nodes} nodes\\b`));
  });

  it('is idempotent: a second index does not grow the graph', () => {
    runSpringgraph(['init'], tempDir);
    runSpringgraph(['index'], tempDir);
    const first = graphCounts(tempDir);
    runSpringgraph(['index'], tempDir);
    const second = graphCounts(tempDir);

    // A clean rebuild each time — no duplicate (re-resolved) edges accumulating
    // across runs (the C# "+18 edges" symptom in the report).
    expect(second.nodes).toBe(first.nodes);
    expect(second.edges).toBe(first.edges);
  });

  it('--quiet path also rebuilds a populated graph', () => {
    runSpringgraph(['init'], tempDir);
    const afterInit = graphCounts(tempDir);

    runSpringgraph(['index', '--quiet'], tempDir);
    const afterIndex = graphCounts(tempDir);

    expect(afterIndex.nodes).toBe(afterInit.nodes);
    expect(afterIndex.edges).toBe(afterInit.edges);
  });
});
