/**
 * Tests for the architecture-specific web API endpoints and the additive
 * /api/overview response fields introduced in Phase 6.
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
import { profileRegistry, genericProfile } from '../src/architecture/profile-registry';
import { ArchitectureProfile, ArchitectureFacet, ArchitectureLayer } from '../src/architecture/types';

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

function layerForRole(role: string): ArchitectureLayer {
  const map: Record<string, ArchitectureLayer> = {
    controller: 'entry',
    service: 'business',
    mapper: 'data',
    repository: 'data',
    entity: 'model',
    config: 'infra',
  };
  return map[role] ?? 'unknown';
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

describe('architecture web api', () => {
  let tempDir: string;
  let publicDir: string;
  let cg: CodeGraph;
  let port: number;
  let close: () => Promise<void>;
  const originalProfiles = profileRegistry.getProfiles();
  const originalFacets = facetRegistry.getFacets();

  beforeAll(async () => {
    // Register a deterministic test profile/facet before indexing so the
    // architecture engine can classify the fixture symbols.
    profileRegistry.clear();
    facetRegistry.clear();

    const testProfile: ArchitectureProfile = {
      id: 'test-architecture',
      name: 'Test Architecture',
      description: 'Test profile for web architecture API.',
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

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-archweb-'));
    publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-archweb-public-'));
    fs.writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html><title>codegraph</title>');

    fs.mkdirSync(path.join(tempDir, 'ruoyi-system', 'src'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'ruoyi-admin', 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'ruoyi-system', 'src', 'OrderController.java'),
      [
        'public class OrderController {',
        '  private OrderService orderService;',
        '  public void listOrders() { orderService.findAllOrders(); }',
        '}',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(tempDir, 'ruoyi-system', 'src', 'OrderService.java'),
      [
        'public class OrderService {',
        '  private OrderMapper orderMapper;',
        '  public void findAllOrders() { orderMapper.selectAllOrders(); }',
        '}',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(tempDir, 'ruoyi-system', 'src', 'OrderMapper.java'),
      [
        'public interface OrderMapper {',
        '  void selectAllOrders();',
        '}',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(tempDir, 'ruoyi-admin', 'src', 'AdminController.java'),
      [
        'public class AdminController {',
        '  public void listAdmins() {}',
        '}',
      ].join('\n')
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

  it('GET /api/architecture/profiles returns the active test profile', async () => {
    const res = await get(port, '/api/architecture/profiles');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.activeProfile).toBe('Test Architecture');
    expect(typeof body.profileConfidence).toBe('number');
    expect(body.profileConfidence).toBeGreaterThan(0);
    expect(Array.isArray(body.matches)).toBe(true);
    expect(body.matches.length).toBeGreaterThan(0);
    const match = body.matches.find((m: { profileName: string }) => m.profileName === 'Test Architecture');
    expect(match).toBeDefined();
    expect(match.nodeCount).toBeGreaterThan(0);
    expect(Array.isArray(body.warnings)).toBe(true);
  });

  it('GET /api/architecture/overview returns architecture graph and breakdowns', async () => {
    const res = await get(port, '/api/architecture/overview?limit=20');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.mode).toBe('architecture');
    expect(body.activeProfile).toBe('Test Architecture');
    expect(typeof body.profileConfidence).toBe('number');
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(Array.isArray(body.edges)).toBe(true);
    expect(typeof body.roleBreakdown).toBe('object');
    expect(typeof body.layerBreakdown).toBe('object');
    expect(typeof body.moduleBreakdown).toBe('object');
    expect(typeof body.facets).toBe('object');

    const controller = body.nodes.find((n: { name?: string; role?: string }) => n.role === 'controller');
    expect(controller).toBeDefined();
    expect(controller.isEntrypoint).toBe(true);
  });

  it('GET /api/architecture/overview applies role filters server-side', async () => {
    const res = await get(port, '/api/architecture/overview?role=controller');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    for (const n of body.nodes) {
      expect(n.role).toBe('controller');
    }
    expect(body.nodes.length).toBeGreaterThan(0);
  });

  it('GET /api/search applies role/layer/module/decorator filters consistently', async () => {
    const roleBody = JSON.parse((await get(port, '/api/search?q=Order&role=controller&limit=20')).body);
    expect(roleBody.results.length).toBeGreaterThan(0);
    for (const result of roleBody.results) {
      expect(result.node.name).toContain('Controller');
    }

    const layerBody = JSON.parse((await get(port, '/api/search?q=Order&layer=entry&limit=20')).body);
    expect(layerBody.results.length).toBeGreaterThan(0);
    for (const result of layerBody.results) {
      expect(result.node.name).toContain('Controller');
    }

    const moduleBody = JSON.parse((await get(port, '/api/search?q=Order&module=ruoyi-system&limit=20')).body);
    expect(moduleBody.results.length).toBeGreaterThan(0);
    for (const result of moduleBody.results) {
      expect(result.node.filePath.startsWith('ruoyi-system/')).toBe(true);
    }

    const emptyDecoratorBody = JSON.parse((await get(port, '/api/search?q=Order&decorator=NoSuchDecorator&limit=20')).body);
    expect(emptyDecoratorBody.results).toEqual([]);
  });

  it('GET /api/architecture/trace returns a path with hop confidence', async () => {
    const fromNode = cg.searchNodes('listOrders', { limit: 1 })[0]?.node;
    const toNode = cg.searchNodes('selectAllOrders', { limit: 1 })[0]?.node;
    expect(fromNode).toBeDefined();
    expect(toNode).toBeDefined();

    const res = await get(
      port,
      `/api/architecture/trace?from=${encodeURIComponent(fromNode.id)}&to=${encodeURIComponent(toNode.id)}`
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.from).toBeDefined();
    expect(body.to).toBeDefined();
    expect(Array.isArray(body.paths)).toBe(true);
    expect(body.paths.length).toBeGreaterThan(0);
    const firstPath = body.paths[0];
    expect(Array.isArray(firstPath)).toBe(true);
    expect(firstPath.length).toBeGreaterThan(0);
    for (const hop of firstPath) {
      expect(typeof hop.confidence).toBe('number');
    }
    expect(typeof body.confidence).toBe('number');
    expect(Array.isArray(body.warnings)).toBe(true);
  });

  it('GET /api/architecture/impact returns architecture breakdown and recommendations', async () => {
    const overview = JSON.parse((await get(port, '/api/architecture/overview?limit=20')).body);
    const mapper = overview.nodes.find((n: { role?: string }) => n.role === 'mapper');
    expect(mapper).toBeDefined();

    const res = await get(
      port,
      `/api/architecture/impact?nodeId=${encodeURIComponent(mapper.id)}&depth=2`
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.node).toBeDefined();
    expect(body.depth).toBe(2);
    expect(body.impact).toBeDefined();
    expect(Array.isArray(body.impact.nodes)).toBe(true);
    expect(Array.isArray(body.impact.edges)).toBe(true);
    expect(typeof body.breakdown).toBe('object');
    expect(typeof body.breakdown.mapper).toBe('number');
    expect(['low', 'medium', 'high']).toContain(body.riskLevel);
    expect(Array.isArray(body.recommendedTests)).toBe(true);
    expect(Array.isArray(body.warnings)).toBe(true);
  });

  it('GET /api/overview includes additive architecture fields', async () => {
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
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(Array.isArray(body.edges)).toBe(true);
  });
});
