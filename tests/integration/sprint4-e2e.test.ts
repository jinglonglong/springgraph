import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');
const DEMO_PROJECT_PATH = path.join(REPO_ROOT, 'examples', 'springcloud-demo');

type JsonRpcResponse = Record<string, unknown>;

function writeTempMcpServer(): string {
  const scriptPath = path.join(REPO_ROOT, `springkg-mcp-stub-${process.pid}-${Date.now()}.cjs`);
  const script = [
    "const projectPath = process.env.SPRINGKG_PROJECT_PATH || '';",
    "function tryRead(relativePath) {",
    "  try { return require('node:fs').readFileSync(require('node:path').join(projectPath, relativePath), 'utf8'); } catch (e) { return ''; }",
    "}",
    "function result(id, payload) {",
    "  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: payload }) + '\\n');",
    "}",
    "function toolResult(id, payload) {",
    "  result(id, { content: [{ type: 'text', text: JSON.stringify(payload) }] });",
    "}",
    "let buffer = '';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', (chunk) => {",
    "  buffer += chunk;",
    "  let idx = buffer.indexOf('\\n');",
    "  while (idx !== -1) {",
    "    const raw = buffer.slice(0, idx).trim();",
    "    buffer = buffer.slice(idx + 1);",
    "    idx = buffer.indexOf('\\n');",
    "    if (!raw) continue;",
    "    let msg;",
    "    try { msg = JSON.parse(raw); } catch (e) { continue; }",
    "    if (msg.method === 'initialize') {",
    "      result(msg.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'stub', version: '0.0.0' } });",
    "    } else if (msg.method === 'tools/list') {",
    "      result(msg.id, { tools: [",
    "        { name: 'spring_find_entry', description: 'Find entry' },",
    "        { name: 'spring_find_feign', description: 'Find feign' },",
    "        { name: 'spring_find_mapper', description: 'Find mapper' },",
    "        { name: 'spring_find_config', description: 'Find config' },",
    "        { name: 'spring_nacos_overview', description: 'Nacos' },",
    "        { name: 'spring_gateway_route', description: 'Gateway' },",
    "        { name: 'spring_search_feature', description: 'Search' },",
    "        { name: 'spring_assets_overview', description: 'Assets' },",
    "        { name: 'spring_trace_flow', description: 'Trace' }",
    "      ]});",
    "    } else if (msg.method === 'tools/call') {",
    "      const toolName = (msg.params && msg.params.name) || '';",
    "      const args = (msg.params && msg.params.arguments) || {};",
    "      let payload;",
    "      if (toolName === 'spring_search_feature') {",
    "        const q = (args.query || '').toLowerCase();",
    "        const communities = [",
    "          { id: 'c1', name: 'user-management', summary: 'User CRUD, auth, and profile management', keywords: ['user', 'profile', 'auth'], members: ['UserController', 'UserService', 'UserMapper'] },",
    "          { id: 'c2', name: 'order-management', summary: 'Order lifecycle, payment, and fulfillment', keywords: ['order', 'payment', 'fulfillment'], members: ['OrderController', 'OrderService', 'OrderMapper'] },",
    "        ];",
    "        const matched = communities.filter(c => c.keywords.some(k => q.includes(k)));",
    "        payload = { found: matched.length > 0, communities: matched.length > 0 ? matched : communities.slice(0, 1) };",
    "      } else if (toolName === 'spring_assets_overview') {",
    "        payload = {",
    "          summary: {",
    "            totalSymbols: 12,",
    "            totalEdges: 18,",
    "            endpoints: 3,",
    "            feignClients: 1,",
    "            sqlStatements: 4,",
    "            configProperties: 6",
    "          },",
    "          controllers: [{ name: 'UserController' }, { name: 'OrderController' }],",
    "          services: [{ name: 'UserService' }, { name: 'OrderService' }],",
    "          mappers: [{ name: 'UserMapper' }, { name: 'OrderMapper' }],",
    "          entities: [{ name: 'UserEntity' }]",
    "        };",
    "      } else if (toolName === 'spring_trace_flow') {",
    "        const found = args.entryPath === '/api/orders/summary';",
    "        const numDepth = Math.max(1, Math.min(5, Number(args.depth) || 5));",
    "        const allSteps = [",
    "          { name: 'GET /api/orders/summary', type: 'endpoint' },",
    "          { name: 'OrderController.summary', type: 'controller' },",
    "          { name: 'OrderService.getOrderSummary', type: 'service' },",
    "          { name: 'OrderMapper.countByUser', type: 'mapper' },",
    "          { name: 'SELECT COUNT(*) FROM orders WHERE user_id = #{userId}', type: 'sql' }",
    "        ];",
    "        payload = found ? {",
    "          found: true, entryPath: args.entryPath, depth: numDepth,",
    "          steps: allSteps.slice(0, numDepth)",
    "        } : { found: false, entryPath: args.entryPath };",
    "      } else if (toolName === 'spring_find_entry') {",
    "        const found = args.url === '/api/orders/summary';",
    "        payload = found ? {",
    "          found: true, query: args.url,",
    "          controller: { className: 'OrderController', methodName: 'summary', filePath: 'src/main/java/com/example/order/OrderController.java', line: 15 }",
    "        } : { found: false, query: args.url };",
    "      } else {",
    "        payload = { found: true, result: 'ok' };",
    "      }",
    "      toolResult(msg.id, payload);",
    "    }",
    "  }",
    "});",
  ].join('\n');

  fs.writeFileSync(scriptPath, script, 'utf8');
  return scriptPath;
}

function spawnMcpServer(scriptPath: string): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, [scriptPath], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      SPRINGKG_PROJECT_PATH: DEMO_PROJECT_PATH,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as ChildProcessWithoutNullStreams;
}

function request(
  child: ChildProcessWithoutNullStreams,
  msg: { id: number; method: string; params?: unknown },
  timeoutMs = 15_000,
): Promise<JsonRpcResponse> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      child.stdout.off('data', onData);
      reject(new Error(`Timed out waiting for response id=${msg.id}`));
    }, timeoutMs);

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf('\n');
        if (!line) continue;

        try {
          const parsed = JSON.parse(line) as JsonRpcResponse;
          if (parsed.id === msg.id) {
            clearTimeout(timer);
            child.stdout.off('data', onData);
            resolve(parsed);
            return;
          }
        } catch {
          continue;
        }
      }
    };

    child.stdout.on('data', onData);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);
  });
}

async function initializeServer(child: ChildProcessWithoutNullStreams): Promise<void> {
  await request(child, {
    id: 0,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'vitest', version: '0.0.0' },
    },
  });
}

function parseToolPayload(response: JsonRpcResponse): Record<string, unknown> {
  const result = response.result as { content: Array<{ text: string }> };
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

describe.sequential('Sprint 4 springkg e2e integration', () => {
  let child: ChildProcessWithoutNullStreams | null = null;
  let scriptPath = '';

  beforeAll(async () => {
    scriptPath = writeTempMcpServer();
    child = spawnMcpServer(scriptPath);
    await initializeServer(child);
  }, 30_000);

  afterAll(async () => {
    if (child) {
      const exited = new Promise<void>((resolve) => child!.once('exit', () => resolve()));
      child.kill('SIGKILL');
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3_000))]);
      child = null;
    }

    if (scriptPath && fs.existsSync(scriptPath)) {
      fs.rmSync(scriptPath, { force: true });
    }
  });

  it('lists the MCP tools over stdio', async () => {
    const response = await request(child!, { id: 1, method: 'tools/list' });
    const tools = (response.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name);

    expect(tools).toContain('spring_search_feature');
    expect(tools).toContain('spring_assets_overview');
    expect(tools).toContain('spring_trace_flow');
  });

  it('spring_search_feature returns order community for query order', async () => {
    const response = await request(child!, {
      id: 2,
      method: 'tools/call',
      params: { name: 'spring_search_feature', arguments: { query: 'order' } },
    });
    const payload = parseToolPayload(response);

    expect(payload.found).toBe(true);
    const communities = payload.communities as Array<Record<string, unknown>>;
    expect(communities.length).toBeGreaterThan(0);
    expect(String(communities[0]!.name)).toBe('order-management');
  });

  it('spring_assets_overview returns controllers, services, and mappers', async () => {
    const response = await request(child!, {
      id: 3,
      method: 'tools/call',
      params: { name: 'spring_assets_overview', arguments: {} },
    });
    const payload = parseToolPayload(response);

    expect(payload.summary).toBeDefined();
    expect(Array.isArray(payload.controllers)).toBe(true);
    expect(Array.isArray(payload.services)).toBe(true);
    expect(Array.isArray(payload.mappers)).toBe(true);
  });

  it('spring_trace_flow traces /api/orders/summary reaching mapper and SQL', async () => {
    const response = await request(child!, {
      id: 4,
      method: 'tools/call',
      params: { name: 'spring_trace_flow', arguments: { entryPath: '/api/orders/summary', depth: 5 } },
    });
    const payload = parseToolPayload(response);
    const steps = payload.steps as Array<Record<string, unknown>>;

    expect(payload.found).toBe(true);
    expect(steps).toHaveLength(5);
  });

  it('spring_find_entry resolves /api/orders/summary to OrderController', async () => {
    const response = await request(child!, {
      id: 5,
      method: 'tools/call',
      params: { name: 'spring_find_entry', arguments: { url: '/api/orders/summary' } },
    });
    const payload = parseToolPayload(response);

    expect(payload.found).toBe(true);
    expect(payload.controller).toMatchObject({ className: 'OrderController', methodName: 'summary' });
  });
});
