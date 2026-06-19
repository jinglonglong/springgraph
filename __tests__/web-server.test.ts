/**
 * Smoke test for the CodeGraph web UI server.
 *
 * Boots the HTTP server against a small temp project, curls every public
 * endpoint, and verifies the shape of the responses the frontend will
 * consume. Also pins the path-traversal guard — the file endpoint accepts
 * arbitrary paths, so we make sure an attempted escape returns 403.
 *
 * Run via: npx vitest run __tests__/web-server.test.ts
 *
 * NOTE: starts the server programmatically (no `dist/` build required). The
 * publicDir in this test is created on-the-fly under a temp dir with a stub
 * index.html — the goal is to exercise the HTTP layer, not the bundled UI.
 */

// Same env vars the CLI tests use: prevents the binary from relaunching under
// V8's --liftoff-only flag (no-op for unit tests but slow) and keeps the
// background MCP daemon from spawning during the run.
process.env.CODEGRAPH_WASM_RELAUNCHED = '1';
process.env.CODEGRAPH_NO_DAEMON = '1';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import { CodeGraph } from '../src';
import { startWebServer } from '../src/web/server';

function get(port: number, urlPath: string): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: urlPath, method: 'GET' },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf-8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function postJson(port: number, urlPath: string, body: unknown): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: urlPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf-8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

describe('web server', () => {
  let tempDir: string;
  let otherDir: string;
  let publicDir: string;
  let cg: CodeGraph;
  let port: number;
  let close: () => Promise<void>;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-web-'));
    otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-web-other-'));
    publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-web-public-'));

    // Stub UI: just enough so the static file route has something to serve.
    fs.writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html><title>codegraph</title>');

    // Tiny project the server can serve: a function called from another.
    // `calc.ts` also carries a decorated class so the decorator-chip tests
    // can assert that /api/decorators surfaces it and ?decorator= filters
    // search hits to symbols with that decorator.
    fs.mkdirSync(path.join(tempDir, 'src'));
    fs.writeFileSync(
      path.join(tempDir, 'src/calc.ts'),
      [
        'export function add(a: number, b: number): number { return a + b; }\n',
        '@Service',
        'export class CalcService {',
        '  @Route("/sum")',
        '  sum() { return add(1, 2); }',
        '}\n',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(tempDir, 'src/use.ts'),
      "import { add } from './calc';\nexport function total(){ return add(1, 2); }\n",
    );

    cg = CodeGraph.initSync(tempDir);
    await cg.indexAll();

    fs.mkdirSync(path.join(otherDir, 'src'));
    fs.writeFileSync(
      path.join(otherDir, 'src/subtract.ts'),
      'export function subtract(a: number, b: number): number { return a - b; }\n',
    );
    const other = CodeGraph.initSync(otherDir);
    await other.indexAll();
    other.close();

    const handle = await startWebServer(cg, {
      port: 0, // OS picks a free port
      publicDir,
      silent: true,
    });
    port = parseInt(new URL(handle.url).port, 10);
    close = handle.close;
  }, 60_000);

  afterAll(async () => {
    await close();
    cg.destroy();
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(otherDir, { recursive: true, force: true });
    fs.rmSync(publicDir, { recursive: true, force: true });
  });

  it('GET / serves index.html', async () => {
    const res = await get(port, '/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('codegraph');
  });

  it('GET /api/health returns ok', async () => {
    const res = await get(port, '/api/health');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it('GET /api/status returns graph stats', async () => {
    const res = await get(port, '/api/status');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.initialized).toBe(true);
    expect(body.projectRoot).toBe(tempDir);
    expect(body.fileCount).toBeGreaterThanOrEqual(2);
    expect(body.nodeCount).toBeGreaterThan(0);
    expect(body.edgeCount).toBeGreaterThan(0);
    expect(body.nodesByKind).toBeTypeOf('object');
    expect(body.edgesByKind).toBeTypeOf('object');
    expect(body.filesByLanguage).toBeTypeOf('object');
  });

  it('GET /api/overview returns a startup graph with real indexed nodes', async () => {
    const res = await get(port, '/api/overview?limit=10');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.direction).toBe('overview');
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(Array.isArray(body.edges)).toBe(true);
    expect(body.nodes.length).toBeGreaterThan(0);
    expect(body.nodes.length).toBeLessThanOrEqual(10);
    expect(body.nodes[0]).toHaveProperty('id');
    expect(body.nodes[0]).toHaveProperty('kind');
    expect(body.nodes[0]).toHaveProperty('color');
  });

  it('GET /api/browse lists local directories and flags .codegraph indexes', async () => {
    const res = await get(port, '/api/browse?path=' + encodeURIComponent(tempDir));
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.path).toBe(tempDir);
    expect(Array.isArray(body.entries)).toBe(true);
    const codegraph = body.entries.find((e: { name: string }) => e.name === '.codegraph');
    expect(codegraph).toMatchObject({ isCodeGraphDir: true });
  });

  it('GET /api/search?q=add returns the add function', async () => {
    const res = await get(port, '/api/search?q=add&limit=10');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.query).toBe('add');
    expect(body.count).toBeGreaterThan(0);
    const names = body.results.map((r: { node: { name: string } }) => r.node.name);
    expect(names).toContain('add');
  });

  it('POST /api/project switches to another .codegraph directory and back', async () => {
    const switchToOther = await postJson(port, '/api/project', {
      path: path.join(otherDir, '.codegraph'),
    });
    expect(switchToOther.status).toBe(200);
    expect(JSON.parse(switchToOther.body)).toMatchObject({ projectRoot: otherDir });

    const subtract = JSON.parse((await get(port, '/api/search?q=subtract&limit=10')).body);
    expect(subtract.results.map((r: { node: { name: string } }) => r.node.name)).toContain('subtract');

    const addMissing = JSON.parse((await get(port, '/api/search?q=add&limit=10')).body);
    expect(addMissing.results.map((r: { node: { name: string } }) => r.node.name)).not.toContain('add');

    const switchBack = await postJson(port, '/api/project', { path: tempDir });
    expect(switchBack.status).toBe(200);
    expect(JSON.parse(switchBack.body)).toMatchObject({ projectRoot: tempDir });

    const add = JSON.parse((await get(port, '/api/search?q=add&limit=10')).body);
    expect(add.results.map((r: { node: { name: string } }) => r.node.name)).toContain('add');
  });

  it('GET /api/search with no q returns 400', async () => {
    const res = await get(port, '/api/search');
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ code: 'missing_q' });
  });

  it('GET /api/node/<id> returns node + code + callers + callees', async () => {
    // First, search to find the add() function's id.
    const search = JSON.parse((await get(port, '/api/search?q=add&limit=1')).body);
    const id = search.results[0].node.id;

    const res = await get(port, '/api/node/' + encodeURIComponent(id));
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.node.id).toBe(id);
    expect(body.node.name).toBe('add');
    expect(body.code).toContain('return a + b');
    expect(Array.isArray(body.callers)).toBe(true);
    expect(Array.isArray(body.callees)).toBe(true);
    // use.total() should call add → add has at least one caller.
    expect(body.callers.length).toBeGreaterThan(0);
  });

  it('GET /api/node/missing returns 404', async () => {
    const res = await get(port, '/api/node/__definitely_missing__');
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body)).toMatchObject({ code: 'node_not_found' });
  });

  it('GET /api/context/<id>?depth=1 returns a cytoscape-shaped subgraph', async () => {
    const search = JSON.parse((await get(port, '/api/search?q=add&limit=1')).body);
    const id = search.results[0].node.id;

    const res = await get(port, '/api/context/' + encodeURIComponent(id) + '?depth=1&direction=both');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.root).toBe(id);
    expect(body.depth).toBe(1);
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(Array.isArray(body.edges)).toBe(true);
    // Each node carries the cytoscape shape: { data: { id, label, ... } } OR
    // a flat shape — we chose flat in summarizeNode, so check flat keys.
    if (body.nodes.length > 0) {
      expect(body.nodes[0]).toHaveProperty('id');
      expect(body.nodes[0]).toHaveProperty('kind');
      expect(body.nodes[0]).toHaveProperty('color');
    }
    if (body.edges.length > 0) {
      expect(body.edges[0]).toHaveProperty('source');
      expect(body.edges[0]).toHaveProperty('target');
      expect(body.edges[0]).toHaveProperty('kind');
    }
    // add() is called from total() — there must be at least one call edge
    // when depth=1 in both directions.
    const hasCall = body.edges.some((e: { kind: string }) => e.kind === 'calls');
    expect(hasCall).toBe(true);
  });

  it('GET /api/file?path=src/calc.ts returns the file content with line numbers', async () => {
    const res = await get(port, '/api/file?path=src%2Fcalc.ts');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.path).toBe('src/calc.ts');
    expect(body.startLine).toBe(1);
    expect(body.content).toContain('return a + b');
  });

  it('GET /api/file refuses to read outside the project', async () => {
    // Create a sibling directory next to the project with a sentinel file
    // we can attempt to read — exercises the escape-detection branch (403)
    // rather than the "file not found" branch (404).
    const sibling = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-web-sibling-'));
    const sentinel = path.join(sibling, 'secret.txt');
    fs.writeFileSync(sentinel, 'should-not-leak');
    try {
      const res = await get(
        port,
        '/api/file?path=' + encodeURIComponent('../' + path.basename(sibling) + '/secret.txt'),
      );
      expect(res.status).toBe(403);
    } finally {
      fs.rmSync(sibling, { recursive: true, force: true });
    }
  });

  it('GET /api/kinds returns the kind-color tables', async () => {
    const res = await get(port, '/api/kinds');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.nodeKinds).toContain('function');
    expect(body.edgeKinds).toContain('calls');
    expect(body.nodeKindColors.function).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('GET /api/decorators returns the aggregated decorator list', async () => {
    const res = await get(port, '/api/decorators?limit=60');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(typeof body.count).toBe('number');
    expect(Array.isArray(body.decorators)).toBe(true);
    // The fixture carries @Service (on CalcService) and @Route (on sum).
    const names = body.decorators.map((d: { name: string }) => d.name);
    expect(names).toContain('Service');
    expect(names).toContain('Route');
    // Each entry must carry a positive count.
    for (const d of body.decorators) {
      expect(typeof d.name).toBe('string');
      expect(d.name.length).toBeGreaterThan(0);
      expect(typeof d.count).toBe('number');
      expect(d.count).toBeGreaterThan(0);
    }
  });

  it('GET /api/search?decorator=Service narrows to nodes carrying that decorator', async () => {
    // With ?decorator=Service the only node whose name contains "CalcService"
    // AND that carries @Service is `CalcService` itself.
    const svc = JSON.parse(
      (await get(port, '/api/search?q=CalcService&decorator=Service&limit=10')).body,
    );
    expect(svc.results.length).toBeGreaterThan(0);

    // Asking for a decorator no node carries returns zero results.
    const none = JSON.parse(
      (await get(port, '/api/search?q=CalcService&decorator=NoSuchDecorator&limit=10')).body,
    );
    expect(none.results.length).toBe(0);

    // Asking for `@Route` (on the `sum` method) with query="sum" should also
    // match — the method is decorated, and the FTS query finds it.
    const routed = JSON.parse(
      (await get(port, '/api/search?q=sum&decorator=Route&limit=10')).body,
    );
    expect(routed.results.length).toBeGreaterThan(0);
  });

  it('GET /api/unknown returns 404 with helpful shape', async () => {
    const res = await get(port, '/api/totally-unknown');
    expect(res.status).toBe(404);
  });
});
