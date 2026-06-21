import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import CodeGraph from '../src/index';
import { facetRegistry } from '../src/architecture/facet-engine';
import { genericProfile, profileRegistry } from '../src/architecture/profile-registry';
import type {
  ArchitectureFacet,
  ArchitectureLayer,
  ArchitectureProfile,
} from '../src/architecture/types';
import { __emitWatchEventForTests } from '../src/sync/watcher';

type Role = 'controller' | 'service';

function waitFor(condition: () => boolean, timeoutMs = 3000, intervalMs = 25): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (condition()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timed out'));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

function roleForName(name: string): Role | null {
  if (name.endsWith('Controller')) return 'controller';
  if (name.endsWith('Service')) return 'service';
  return null;
}

function layerForRole(role: Role): ArchitectureLayer {
  return role === 'controller' ? 'entry' : 'business';
}

function moduleForPath(filePath: string | undefined): string {
  const normalized = (filePath || '').replace(/\\/g, '/');
  return normalized.split('/')[0] || '_root';
}

function registerToggleProfile(): { profile: ArchitectureProfile; facet: ArchitectureFacet } {
  const profile: ArchitectureProfile = {
    id: 'toggle-spring-profile',
    name: 'Toggle Spring Profile',
    description: 'Deterministic incremental-sync test profile.',
    facetIds: ['toggle-naming-facet'],
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
      const active = signals.length > 0;
      return {
        profileName: active ? 'toggle-spring-profile' : 'generic',
        confidence: active ? 0.95 : 0.05,
        nodeCount: signals.length,
        layerBreakdown: {},
        roleBreakdown: {},
        signals,
      };
    },
  };

  const facet: ArchitectureFacet = {
    id: 'toggle-naming-facet',
    name: 'Toggle Naming Facet',
    detect(context) {
      const configPath = path.join(context.projectRoot, 'application.yml');
      const enabled = fs.existsSync(configPath) && /profile\.enabled\s*:\s*true/i.test(fs.readFileSync(configPath, 'utf8'));
      if (!enabled) return [];

      const rows = context.db
        .getDb()
        .prepare("SELECT id, name, file_path FROM nodes WHERE kind IN ('class', 'interface')")
        .all() as Array<{ id: string; name: string; file_path: string }>;

      return rows.flatMap((row) => {
        const role = roleForName(row.name);
        if (!role) return [];
        return [{
          nodeId: row.id,
          facetName: 'toggle-naming-facet',
          profileName: 'toggle-spring-profile',
          confidence: 0.9,
          evidence: [`${row.name} matched ${role}`],
          scope: 'node' as const,
          filePath: row.file_path,
          module: moduleForPath(row.file_path),
          metadata: {
            role,
            layer: layerForRole(role),
            module: moduleForPath(row.file_path),
            isEntrypoint: role === 'controller',
          },
        }];
      });
    },
  };

  profileRegistry.clear();
  facetRegistry.clear();
  profileRegistry.register(genericProfile);
  profileRegistry.register(profile);
  facetRegistry.register(facet);
  return { profile, facet };
}

describe('architecture incremental sync', () => {
  let tempDir: string;
  let cg: CodeGraph;

  beforeEach(async () => {
    registerToggleProfile();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-arch-sync-'));
    fs.mkdirSync(path.join(tempDir, 'ruoyi-system', 'src'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'application.yml'), 'profile.enabled: true\n');
    fs.writeFileSync(
      path.join(tempDir, 'ruoyi-system', 'src', 'UserService.java'),
      'public class UserService { public void handle() {} }\n',
    );

    cg = CodeGraph.initSync(tempDir);
    await cg.indexAll();
  });

  afterEach(() => {
    try { cg?.unwatch(); } catch {}
    try { cg?.close(); } catch {}
    profileRegistry.clear();
    facetRegistry.clear();
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('recomputes changed-file facets on modify/add/delete and evicts stale entries', async () => {
    const initial = await cg.getArchitectureSnapshot();
    const service = initial.nodes.find((n) => n.name === 'UserService');
    expect(service).toBeDefined();
    expect(initial.profile.name).toBe('Toggle Spring Profile');
    expect(initial.facets.get(service!.id)?.role).toBe('service');

    const serviceFile = path.join(tempDir, 'ruoyi-system', 'src', 'UserService.java');
    fs.writeFileSync(serviceFile, 'public class UserController { public void handle() {} }\n');
    const modified = await cg.sync();
    expect(modified.filesModified).toBe(1);

    const afterModify = await cg.getArchitectureSnapshot();
    const controller = afterModify.nodes.find((n) => n.name === 'UserController');
    expect(controller).toBeDefined();
    expect(afterModify.facets.get(controller!.id)?.role).toBe('controller');
    expect(afterModify.facets.get(controller!.id)?.isEntrypoint).toBe(true);
    expect(afterModify.nodes.some((n) => n.name === 'UserService')).toBe(false);

    const addedFile = path.join(tempDir, 'ruoyi-system', 'src', 'AuditService.java');
    fs.writeFileSync(addedFile, 'public class AuditService { public void audit() {} }\n');
    const added = await cg.sync();
    expect(added.filesAdded).toBe(1);

    const afterAdd = await cg.getArchitectureSnapshot();
    const audit = afterAdd.nodes.find((n) => n.name === 'AuditService');
    expect(audit).toBeDefined();
    expect(afterAdd.facets.get(audit!.id)?.role).toBe('service');
    expect(afterAdd.facets.get(audit!.id)?.module).toBe('ruoyi-system');

    fs.unlinkSync(addedFile);
    const removed = await cg.sync();
    expect(removed.filesRemoved).toBe(1);

    const afterDelete = await cg.getArchitectureSnapshot();
    expect(afterDelete.nodes.some((n) => n.name === 'AuditService')).toBe(false);
    if (audit) expect(afterDelete.facets.has(audit.id)).toBe(false);
  });

  it('re-detects the project profile when a global config file changes', async () => {
    const before = await cg.getArchitectureSnapshot();
    expect(before.profile.name).toBe('Toggle Spring Profile');

    fs.writeFileSync(path.join(tempDir, 'application.yml'), 'profile.enabled: false\n');
    const result = await cg.sync();
    expect(result.filesModified).toBe(1);

    const after = await cg.getArchitectureSnapshot();
    expect(after.profile.name).toBe('Generic');
    expect(after.facets.size).toBe(0);
  });

  it('keeps the architecture snapshot fresh through watch-triggered auto-sync', async () => {
    expect(cg.watch({ debounceMs: 75, inertForTests: true })).toBe(true);
    await cg.waitUntilWatcherReady();

    fs.writeFileSync(
      path.join(tempDir, 'ruoyi-system', 'src', 'UserService.java'),
      'public class UserController { public void handle() {} }\n',
    );
    __emitWatchEventForTests(tempDir, 'ruoyi-system/src/UserService.java');

    await waitFor(() => cg.getPendingFiles().length === 0, 4000);
    const snapshot = await cg.getArchitectureSnapshot();
    const controller = snapshot.nodes.find((n) => n.name === 'UserController');
    expect(controller).toBeDefined();
    expect(snapshot.facets.get(controller!.id)?.role).toBe('controller');
  });
});
