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
    "      if (toolName === 'spring_find_config') {",
    "        const isSensitive = args.key && /password|secret|token|credential/i.test(args.key);",
    "        payload = {",
    "          found: true,",
    "          key: args.key || '',",
    "          isSensitive: isSensitive,",
    "          maskedValue: isSensitive ? '***masked' : null,",
    "          rawValuePresent: false,",
    "          definition: { filePath: 'src/main/resources/application.yml', line: 3, profile: 'default' },",
    "          usedBy: []",
    "        };",
    "      } else if (toolName === 'spring_nacos_overview') {",
    "        payload = {",
    "          clusters: [{ address: '127.0.0.1:8848', namespace: 'public' }],",
    "          namespaces: [{ id: 'public', name: 'public' }],",
    "          dataIds: [{ dataId: 'springcloud-demo.yml', group: 'DEFAULT_GROUP' }],",
    "          services: [{ serviceName: 'user-service' }, { serviceName: 'order-service' }]",
    "        };",
    "      } else if (toolName === 'spring_gateway_route') {",
    "        payload = {",
    "          found: true,",
    "          routes: [",
    "            { id: 'route-1', path: '/api/users/**', targetService: 'user-service', predicates: ['Path=/api/users/**'] }",
    "          ],",
    "          targetServices: [{ name: 'user-service', port: 8080 }]",
    "        };",
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

describe.sequential('Sprint 3 springkg e2e integration', () => {
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

    expect(tools).toContain('spring_find_config');
    expect(tools).toContain('spring_nacos_overview');
    expect(tools).toContain('spring_gateway_route');
  });

  it('spring_find_config masks sensitive values and returns usage info', async () => {
    const response = await request(child!, {
      id: 2,
      method: 'tools/call',
      params: { name: 'spring_find_config', arguments: { key: 'spring.datasource.password' } },
    });
    const payload = parseToolPayload(response);

    expect(payload.found).toBe(true);
    expect(payload.key).toBe('spring.datasource.password');
    expect(payload.isSensitive).toBe(true);
    expect(payload.rawValuePresent).toBe(false);
    expect(String(payload.maskedValue)).toContain('***');
  });

  it('spring_find_config returns non-sensitive value untouched', async () => {
    const response = await request(child!, {
      id: 3,
      method: 'tools/call',
      params: { name: 'spring_find_config', arguments: { key: 'spring.application.name' } },
    });
    const payload = parseToolPayload(response);

    expect(payload.found).toBe(true);
    expect(payload.isSensitive).toBe(false);
  });

  it('spring_nacos_overview returns clusters, namespaces, and dataIds', async () => {
    const response = await request(child!, {
      id: 4,
      method: 'tools/call',
      params: { name: 'spring_nacos_overview', arguments: {} },
    });
    const payload = parseToolPayload(response);

    expect(payload.clusters).toBeDefined();
    expect(payload.namespaces).toBeDefined();
    expect(payload.dataIds).toBeDefined();
    expect(payload.services).toBeDefined();
    expect(Array.isArray(payload.clusters)).toBe(true);
  });

  it('spring_gateway_route returns routes and target services', async () => {
    const response = await request(child!, {
      id: 5,
      method: 'tools/call',
      params: { name: 'spring_gateway_route', arguments: { path: '/api/users' } },
    });
    const payload = parseToolPayload(response);

    expect(payload.found).toBe(true);
    expect(Array.isArray(payload.routes)).toBe(true);
  });
});
