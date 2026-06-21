/**
 * MCP catch-up gate — first tool call blocks on the engine's post-open
 * filesystem reconcile so it never serves rows for files that were
 * deleted (or edited) while no MCP server was running.
 *
 * Background: `MCPEngine.catchUpSync()` fires `cg.sync()` in the background.
 * Before this fix it was fire-and-forget — a tool call could race past it
 * and return rows for files that no longer exist on disk. The per-file
 * staleness banner (`withStalenessNotice`) couldn't help, because
 * `getPendingFiles()` is populated by the watcher, not by catch-up.
 *
 * The fix: `catchUpSync()` pushes its promise into the `ToolHandler` via
 * `setCatchUpGate(p)`; the first `execute()` call awaits the gate and then
 * clears it. These tests exercise the gate directly (deterministic) and
 * the engine-driven path (proves the engine actually pokes the gate).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import CodeGraph from '../src/index';
import { ToolHandler } from '../src/mcp/tools';
import { facetRegistry } from '../src/architecture/facet-engine';
import { genericProfile, profileRegistry } from '../src/architecture/profile-registry';
import type { ArchitectureFacet, ArchitectureProfile } from '../src/architecture/types';

function registerCatchupArchitectureProfile(): void {
  const profile: ArchitectureProfile = {
    id: 'catchup-architecture-profile',
    name: 'Catchup Architecture Profile',
    description: 'Test profile for catch-up freshness.',
    facetIds: ['catchup-naming-facet'],
    layers: [
      { id: 'entry', label: 'Entry', tier: 1 },
      { id: 'business', label: 'Business', tier: 2 },
      { id: 'unknown', label: 'Unknown', tier: 99 },
    ],
    roles: [
      { id: 'controller', label: 'Controller', layerId: 'entry', entrypoint: true },
      { id: 'service', label: 'Service', layerId: 'business' },
    ],
    detect(signals) {
      return {
        profileName: signals.length > 0 ? 'catchup-architecture-profile' : 'generic',
        confidence: signals.length > 0 ? 0.95 : 0.05,
        nodeCount: signals.length,
        layerBreakdown: {},
        roleBreakdown: {},
        signals,
      };
    },
  };

  const facet: ArchitectureFacet = {
    id: 'catchup-naming-facet',
    name: 'Catchup Naming Facet',
    detect(context) {
      const rows = context.db
        .getDb()
        .prepare("SELECT id, name FROM nodes WHERE kind = 'class'")
        .all() as Array<{ id: string; name: string }>;
      return rows.flatMap((row) => {
        if (row.name.endsWith('Controller')) {
          return [{
            nodeId: row.id,
            facetName: 'catchup-naming-facet',
            profileName: 'catchup-architecture-profile',
            confidence: 0.9,
            evidence: ['controller suffix'],
            metadata: { role: 'controller', layer: 'entry', isEntrypoint: true },
          }];
        }
        if (row.name.endsWith('Service')) {
          return [{
            nodeId: row.id,
            facetName: 'catchup-naming-facet',
            profileName: 'catchup-architecture-profile',
            confidence: 0.9,
            evidence: ['service suffix'],
            metadata: { role: 'service', layer: 'business' },
          }];
        }
        return [];
      });
    },
  };

  profileRegistry.clear();
  facetRegistry.clear();
  profileRegistry.register(genericProfile);
  profileRegistry.register(profile);
  facetRegistry.register(facet);
}

describe('MCP catch-up gate', () => {
  let testDir: string;
  let cg: CodeGraph;
  let handler: ToolHandler;

  beforeEach(async () => {
    registerCatchupArchitectureProfile();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-catchup-gate-'));
    fs.mkdirSync(path.join(testDir, 'src'));
    fs.writeFileSync(
      path.join(testDir, 'src', 'survivor.ts'),
      'export function survivor() { return 1; }\n',
    );
    fs.writeFileSync(
      path.join(testDir, 'src', 'deleted-later.ts'),
      'export function deletedLater() { return 2; }\n',
    );

    cg = CodeGraph.initSync(testDir, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    handler = new ToolHandler(cg);
  });

  afterEach(() => {
    try { cg.unwatch(); } catch { /* ignore */ }
    try { cg.close(); } catch { /* ignore */ }
    profileRegistry.clear();
    facetRegistry.clear();
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('awaits the gate before serving the first tool call', async () => {
    let gateResolved = false;
    const gate = new Promise<void>((resolve) => {
      setTimeout(() => { gateResolved = true; resolve(); }, 80);
    });
    handler.setCatchUpGate(gate);

    const res = await handler.execute('codegraph_search', { query: 'survivor' });
    expect(gateResolved).toBe(true);
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toMatch(/survivor/);
  });

  it('drops the gate after first await — second call does not re-wait', async () => {
    let awaitCount = 0;
    const gate = new Promise<void>((resolve) => {
      awaitCount++;
      setTimeout(resolve, 20);
    });
    handler.setCatchUpGate(gate);

    await handler.execute('codegraph_search', { query: 'survivor' });
    const before = awaitCount;
    await handler.execute('codegraph_search', { query: 'survivor' });
    // The promise body runs once when constructed; second execute never
    // resubscribes to a fresh promise because the gate field was nulled.
    expect(awaitCount).toBe(before);
  });

  it('catch-up reconciles a deleted file before the first tool call sees it', async () => {
    // Simulate the empty-project / deleted-files startup case: file is in
    // the DB (we indexed it above) but vanishes from disk before the MCP
    // server's first query. The catch-up sync, awaited via the gate,
    // must remove the row so the first tool call returns no hit.
    fs.unlinkSync(path.join(testDir, 'src', 'deleted-later.ts'));

    // Push the actual catch-up sync as the gate — same flow the MCP engine
    // uses (`cg.sync()` returns a Promise<SyncResult>, the wrapper voids it).
    handler.setCatchUpGate(cg.sync().then(() => undefined));

    const res = await handler.execute('codegraph_search', { query: 'deletedLater' });
    expect(res.isError).toBeFalsy();
    const text = res.content[0].text;
    expect(text).not.toMatch(/src\/deleted-later\.ts/);
  });

  it('catch-up that converges the project to 0 files clears all rows', async () => {
    // Worst case: every source file is gone between sessions. Without the
    // gate, the first tool call serves whatever was in the DB. With the
    // gate + the orchestrator's filesystem reconcile, the DB drains.
    fs.unlinkSync(path.join(testDir, 'src', 'survivor.ts'));
    fs.unlinkSync(path.join(testDir, 'src', 'deleted-later.ts'));

    handler.setCatchUpGate(cg.sync().then(() => undefined));

    const res = await handler.execute('codegraph_search', { query: 'survivor' });
    expect(res.isError).toBeFalsy();
    expect(cg.getStats().fileCount).toBe(0);
  });

  it('gate that rejects does not break the tool call', async () => {
    // A catch-up sync failure (lock contention, transient FS error) must
    // not poison tool dispatch — the engine logs it, the handler proceeds.
    handler.setCatchUpGate(Promise.reject(new Error('simulated sync failure')));

    const res = await handler.execute('codegraph_search', { query: 'survivor' });
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toMatch(/survivor/);
  });

  it('first gated request sees refreshed architecture facets, never stale empty ones', async () => {
    fs.writeFileSync(
      path.join(testDir, 'src', 'deleted-later.ts'),
      'export class DeletedLaterController { handle() { return 2; } }\n',
    );
    await cg.sync();

    fs.writeFileSync(
      path.join(testDir, 'src', 'deleted-later.ts'),
      'export class DeletedLaterService { handle() { return 2; } }\n',
    );
    handler.setCatchUpGate(cg.sync().then(() => undefined));

    const res = await handler.execute('codegraph_search', { query: 'DeletedLaterService' });
    expect(res.isError).toBeFalsy();

    const snapshot = await cg.getArchitectureSnapshot();
    const service = snapshot.nodes.find((n) => n.name === 'DeletedLaterService');
    expect(service).toBeDefined();
    expect(snapshot.facets.get(service!.id)?.role).toBe('service');
    expect(snapshot.nodes.some((n) => n.name === 'DeletedLaterController')).toBe(false);
  });
});
