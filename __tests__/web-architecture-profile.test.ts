/**
 * Tests for Phase 7 WebUI dynamic adaptation — profile-driven UI elements,
 * evidence modal, color-by switching, and architecture tab wiring.
 *
 * Validates that the frontend HTML contains the required DOM elements
 * and that the backend endpoints the UI depends on return correctly shaped data.
 */
process.env.CODEGRAPH_WASM_RELAUNCHED = '1';
process.env.CODEGRAPH_NO_DAEMON = '1';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import { CodeGraph } from '../src';
import { startWebServer } from '../src/web/server';
import { facetRegistry } from '../src/architecture/facet-engine';
import { profileRegistry } from '../src/architecture/profile-registry';
import { ArchitectureProfile, ArchitectureFacet } from '../src/architecture/types';

function get(port: number, urlPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: urlPath, method: 'GET' },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf-8'),
          })
        );
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function classifyByName(name: string): string | null {
  const n = name.toLowerCase();
  if (n.endsWith('controller')) return 'controller';
  if (n.endsWith('service')) return 'service';
  if (n.endsWith('mapper')) return 'mapper';
  if (n.endsWith('repository')) return 'repository';
  if (n.endsWith('entity')) return 'entity';
  if (n.endsWith('config')) return 'config';
  return null;
}

function layerForRole(role: string): string {
  const map: Record<string, string> = {
    controller: 'entry',
    service: 'business',
    mapper: 'data',
    repository: 'data',
    entity: 'model',
    config: 'infra',
  };
  return map[role] ?? 'unknown';
}

describe('web-architecture-profile (Phase 7)', () => {
  let tempDir: string;
  let publicDir: string;
  let cg: CodeGraph;
  let port: number;
  let close: () => Promise<void>;
  const originalProfiles = profileRegistry.getProfiles();
  const originalFacets = facetRegistry.getFacets();

  beforeAll(async () => {
    profileRegistry.clear();
    facetRegistry.clear();

    const testProfile: ArchitectureProfile = {
      id: 'test-architecture',
      name: 'Test Architecture',
      description: 'Test profile for Phase 7 WebUI.',
      facetIds: ['test-naming-facet'],
      layers: [
        { id: 'entry', label: 'Entry', tier: 1 },
        { id: 'business', label: 'Business', tier: 2 },
        { id: 'data', label: 'Data', tier: 3 },
        { id: 'model', label: 'Model', tier: 4 },
        { id: 'infra', label: 'Infra', tier: 5 },
        { id: 'unknown', label: 'Unknown', tier: 99 },
      ],
      roles: [
        { id: 'controller', label: 'Controller', layerId: 'entry', entrypoint: true },
        { id: 'service', label: 'Service', layerId: 'business' },
        { id: 'mapper', label: 'Mapper', layerId: 'data' },
        { id: 'repository', label: 'Repository', layerId: 'data' },
        { id: 'entity', label: 'Entity', layerId: 'model' },
        { id: 'config', label: 'Config', layerId: 'infra' },
      ],
      detect(signals) {
        return {
          profileName: 'test-architecture',
          confidence: signals.length > 0 ? 0.9 : 0.1,
          nodeCount: signals.length,
          layerBreakdown: {},
          roleBreakdown: {},
          signals,
        };
      },
    };

    const testFacet: ArchitectureFacet = {
      id: 'test-naming-facet',
      name: 'Test Naming Facet',
      description: 'Classifies nodes by suffix naming conventions.',
      detect(context) {
        const rows = context.db
          .getDb()
          .prepare("SELECT id, name, kind, file_path, qualified_name FROM nodes WHERE kind IN ('class', 'interface')")
          .all() as Array<{ id: string; name: string; kind: string; file_path: string; qualified_name: string }>;
        const signals: ReturnType<ArchitectureFacet['detect']> = [];
        for (const n of rows) {
          const role = classifyByName(n.name);
          if (!role) continue;
          const layer = layerForRole(role);
          signals.push({
            nodeId: n.id,
            facetName: 'test-naming-facet',
            profileName: 'test-architecture',
            confidence: 0.9,
            evidence: [`Name '${n.name}' matches ${role} suffix`],
            scope: 'node',
            filePath: n.file_path,
            metadata: { role, layer, isEntrypoint: role === 'controller' },
          });
        }
        return signals;
      },
    };

    facetRegistry.register(testFacet);
    profileRegistry.register(testProfile);

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-phase7-'));
    publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-phase7-public-'));
    // Write a minimal HTML that mirrors the real index.html structure
    // so we can validate DOM element presence.
    fs.writeFileSync(
      path.join(publicDir, 'index.html'),
      [
        '<!doctype html><html lang="zh-CN" data-theme="dark"><head>',
        '<title>CodeGraph</title><link rel="stylesheet" href="style.css">',
        '</head><body><div class="app">',
        '<header class="topbar">',
        '<div class="profile-pill" id="profile-pill" hidden>',
        '<span class="profile-name" id="profile-name">—</span>',
        '<span class="profile-confidence" id="profile-confidence">0%</span>',
        '<button class="btn btn-mini" id="btn-evidence" type="button">检测依据</button>',
        '</div>',
        '<div class="mode-toggle">',
        '<button class="mode-btn active" data-mode="springcloud">架构</button>',
        '<button class="mode-btn" data-mode="generic">通用</button>',
        '</div>',
        '</header>',
        '<aside class="panel left">',
        '<div class="filter-section" id="role-section" hidden>',
        '<div class="kind-chips" id="role-chips"></div>',
        '</div>',
        '<div class="filter-section" id="layer-section" hidden>',
        '<div class="kind-chips" id="layer-chips"></div>',
        '</div>',
        '</aside>',
        '<main class="canvas-wrap">',
        '<div class="canvas-toolbar">',
        '<div class="color-by-picker">',
        '<select id="color-by-select">',
        '<option value="kind">类型</option>',
        '<option value="role">角色</option>',
        '<option value="layer">分层</option>',
        '<option value="module">模块</option>',
        '</select>',
        '</div>',
        '</div>',
        '<div id="cy"></div>',
        '</main>',
        '<aside class="panel right">',
        '<div class="tabs">',
        '<button class="tab" data-tab="architecture">架构</button>',
        '<button class="tab" data-tab="trace">调用链</button>',
        '<button class="tab" data-tab="impact">影响</button>',
        '</div>',
        '<div class="tab-pane" data-pane="architecture">',
        '<div class="arch-section" id="arch-section">',
        '<div class="arch-role-chip" id="arch-role"></div>',
        '<div class="arch-layer-chip" id="arch-layer"></div>',
        '<div class="evidence-list" id="arch-evidence"></div>',
        '</div>',
        '</div>',
        '<div class="tab-pane" data-pane="trace">',
        '<div class="trace-controls">',
        '<select id="trace-from"></select>',
        '<select id="trace-to"></select>',
        '<button class="btn btn-mini" id="btn-trace-run">追踪</button>',
        '</div>',
        '<div class="trace-path" id="trace-path"></div>',
        '</div>',
        '<div class="tab-pane" data-pane="impact">',
        '<div class="impact-summary" id="impact-summary"></div>',
        '<div class="impact-risk-list" id="impact-risk-list"></div>',
        '</div>',
        '</aside>',
        '</div>',
        '<div class="modal-backdrop" id="evidence-modal" hidden>',
        '<div class="modal" role="dialog">',
        '<h2 id="evidence-title">架构检测依据</h2>',
        '<p id="evidence-subtitle">—</p>',
        '<div class="evidence-list" id="evidence-modal-body"></div>',
        '<button id="btn-evidence-close">关闭</button>',
        '</div>',
        '</div>',
        '<div id="toast-stack"></div>',
        '<script src="app.js"></script>',
        '</body></html>',
      ].join('\n')
    );

    fs.mkdirSync(path.join(tempDir, 'demo-app', 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'demo-app', 'src', 'UserController.java'),
      [
        'public class UserController {',
        '  private UserService userService;',
        '  public void listUsers() { userService.findAllUsers(); }',
        '}',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(tempDir, 'demo-app', 'src', 'UserService.java'),
      [
        'public class UserService {',
        '  private UserMapper userMapper;',
        '  public void findAllUsers() { userMapper.selectAllUsers(); }',
        '}',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(tempDir, 'demo-app', 'src', 'UserMapper.java'),
      ['public interface UserMapper {', '  void selectAllUsers();', '}'].join('\n')
    );
    fs.writeFileSync(
      path.join(tempDir, 'demo-app', 'src', 'UserRole.java'),
      ['public class UserRole {', '  private Long id;', '  private String name;', '}'].join('\n')
    );

    cg = CodeGraph.initSync(tempDir);
    await cg.indexAll();

    const handle = await startWebServer(cg, { port: 0, publicDir, silent: true });
    port = parseInt(new URL(handle.url).port, 10);
    close = handle.close;
  }, 60_000);

  afterAll(async () => {
    await close();
    cg.destroy();
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(publicDir, { recursive: true, force: true });
    profileRegistry.clear();
    facetRegistry.clear();
    for (const p of originalProfiles) profileRegistry.register(p);
    for (const f of originalFacets) facetRegistry.register(f);
  });

  // ── HTML structure tests ────────────────────────────────────────────────

  it('HTML contains profile-pill with name, confidence, and evidence button', async () => {
    const res = await get(port, '/index.html');
    expect(res.status).toBe(200);
    const html = res.body;
    expect(html).toContain('id="profile-pill"');
    expect(html).toContain('id="profile-name"');
    expect(html).toContain('id="profile-confidence"');
    expect(html).toContain('id="btn-evidence"');
    expect(html).toContain('检测依据');
  });

  it('HTML contains evidence modal elements', async () => {
    const res = await get(port, '/index.html');
    const html = res.body;
    expect(html).toContain('id="evidence-modal"');
    expect(html).toContain('id="evidence-title"');
    expect(html).toContain('id="evidence-modal-body"');
    expect(html).toContain('id="btn-evidence-close"');
  });

  it('HTML contains color-by-select with role/layer/module options', async () => {
    const res = await get(port, '/index.html');
    const html = res.body;
    expect(html).toContain('id="color-by-select"');
    expect(html).toContain('value="kind"');
    expect(html).toContain('value="role"');
    expect(html).toContain('value="layer"');
    expect(html).toContain('value="module"');
  });

  it('HTML contains architecture, trace, and impact tabs', async () => {
    const res = await get(port, '/index.html');
    const html = res.body;
    expect(html).toContain('data-tab="architecture"');
    expect(html).toContain('data-tab="trace"');
    expect(html).toContain('data-tab="impact"');
    expect(html).toContain('data-pane="architecture"');
    expect(html).toContain('data-pane="trace"');
    expect(html).toContain('data-pane="impact"');
  });

  it('HTML contains role-chips and layer-chips filter sections', async () => {
    const res = await get(port, '/index.html');
    const html = res.body;
    expect(html).toContain('id="role-section"');
    expect(html).toContain('id="role-chips"');
    expect(html).toContain('id="layer-section"');
    expect(html).toContain('id="layer-chips"');
  });

  it('HTML contains trace and impact content elements', async () => {
    const res = await get(port, '/index.html');
    const html = res.body;
    expect(html).toContain('id="trace-path"');
    expect(html).toContain('id="trace-from"');
    expect(html).toContain('id="trace-to"');
    expect(html).toContain('id="btn-trace-run"');
    expect(html).toContain('id="impact-summary"');
    expect(html).toContain('id="impact-risk-list"');
  });

  it('HTML contains arch-section with role/layer chips and evidence list', async () => {
    const res = await get(port, '/index.html');
    const html = res.body;
    expect(html).toContain('id="arch-section"');
    expect(html).toContain('id="arch-role"');
    expect(html).toContain('id="arch-layer"');
    expect(html).toContain('id="arch-evidence"');
  });

  it('HTML contains mode-toggle with springcloud and generic modes', async () => {
    const res = await get(port, '/index.html');
    const html = res.body;
    expect(html).toContain('data-mode="springcloud"');
    expect(html).toContain('data-mode="generic"');
  });

  // ── Backend API endpoint tests (what the UI consumes) ──────────────────

  it('GET /api/architecture/profiles returns profile data for pill display', async () => {
    const res = await get(port, '/api/architecture/profiles');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.activeProfile).toBe('Test Architecture');
    expect(typeof body.profileConfidence).toBe('number');
    expect(body.profileConfidence).toBeGreaterThan(0);
    expect(Array.isArray(body.matches)).toBe(true);
    expect(body.matches.length).toBeGreaterThan(0);
  });

  it('GET /api/architecture/overview returns facets for sidebar filter chips', async () => {
    const res = await get(port, '/api/architecture/overview?limit=20');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.mode).toBe('architecture');
    expect(typeof body.facets).toBe('object');
    expect(typeof body.roleBreakdown).toBe('object');
    expect(typeof body.layerBreakdown).toBe('object');
    expect(typeof body.moduleBreakdown).toBe('object');
    expect(Object.keys(body.roleBreakdown).length).toBeGreaterThan(0);
  });

  it('GET /api/architecture/overview facets provide role/layer for color-by', async () => {
    const res = await get(port, '/api/architecture/overview?limit=20');
    const body = JSON.parse(res.body);
    expect(typeof body.facets).toBe('object');
    const facetKeys = Object.keys(body.facets);
    expect(facetKeys.length).toBeGreaterThan(0);
    for (const key of facetKeys) {
      const f = body.facets[key];
      expect(typeof f.role).toBe('string');
      expect(typeof f.layer).toBe('string');
    }
  });

  it('GET /api/architecture/overview role filter produces role-only nodes', async () => {
    const res = await get(port, '/api/architecture/overview?role=controller');
    const body = JSON.parse(res.body);
    expect(body.nodes.length).toBeGreaterThan(0);
    for (const n of body.nodes) {
      expect(n.role).toBe('controller');
    }
  });

  it('GET /api/architecture/overview layer filter produces layer-only nodes', async () => {
    const res = await get(port, '/api/architecture/overview?layer=entry');
    const body = JSON.parse(res.body);
    expect(body.nodes.length).toBeGreaterThan(0);
    for (const n of body.nodes) {
      expect(n.layer).toBe('entry');
    }
  });

  it('GET /api/architecture/trace returns a traceable path for trace tab', async () => {
    const fromNode = cg.searchNodes('listUsers', { limit: 1 })[0]?.node;
    const toNode = cg.searchNodes('selectAllUsers', { limit: 1 })[0]?.node;
    expect(fromNode).toBeDefined();
    expect(toNode).toBeDefined();

    const res = await get(
      port,
      `/api/architecture/trace?from=${encodeURIComponent(fromNode!.id)}&to=${encodeURIComponent(toNode!.id)}`
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.paths)).toBe(true);
    expect(body.paths.length).toBeGreaterThan(0);
    expect(typeof body.confidence).toBe('number');
    for (const hop of body.paths[0]) {
      expect(typeof hop.confidence).toBe('number');
    }
  });

  it('GET /api/architecture/impact returns risk breakdown for impact tab', async () => {
    const overview = JSON.parse((await get(port, '/api/architecture/overview?limit=20')).body);
    const service = overview.nodes.find((n: { role?: string }) => n.role === 'service');
    expect(service).toBeDefined();

    const res = await get(
      port,
      `/api/architecture/impact?nodeId=${encodeURIComponent(service!.id)}&depth=2`
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.impact).toBeDefined();
    expect(Array.isArray(body.impact.nodes)).toBe(true);
    expect(['low', 'medium', 'high']).toContain(body.riskLevel);
    expect(typeof body.breakdown).toBe('object');
    expect(Array.isArray(body.recommendedTests)).toBe(true);
  });

  it('GET /api/overview in springcloud mode returns profile fields the UI reads', async () => {
    const res = await get(port, '/api/overview?mode=springcloud&limit=20');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.mode).toBe('springcloud');
    expect(body.activeProfile).toBe('Test Architecture');
    expect(typeof body.profileConfidence).toBe('number');
    expect(typeof body.facets).toBe('object');
    expect(typeof body.roleBreakdown).toBe('object');
    expect(typeof body.layerBreakdown).toBe('object');
    expect(typeof body.moduleBreakdown).toBe('object');
  });

  it('facets object contains nodeId-keyed entries with role and layer', async () => {
    const res = await get(port, '/api/architecture/overview?limit=20');
    const body = JSON.parse(res.body);
    const facetKeys = Object.keys(body.facets);
    expect(facetKeys.length).toBeGreaterThan(0);
    const firstFacet = body.facets[facetKeys[0]];
    expect(firstFacet).toBeDefined();
    expect(typeof firstFacet.role).toBe('string');
    expect(typeof firstFacet.layer).toBe('string');
  });
});
