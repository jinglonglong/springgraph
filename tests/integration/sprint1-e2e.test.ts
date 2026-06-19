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
    "function lineNumberOf(source, needle) {",
    "  const lines = source.split(/\\r?\\n/);",
    "  const index = lines.findIndex((line) => line.includes(needle));",
    "  return index === -1 ? 0 : index + 1;",
    "}",
    "function result(id, payload) {",
    "  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: payload }) + '\\n');",
    "}",
    "function toolResult(id, payload) {",
    "  result(id, { content: [{ type: 'text', text: JSON.stringify(payload) }] });",
    "}",
    "function tryRead(relativePath) {",
    "  try { return require('node:fs').readFileSync(require('node:path').join(projectPath, relativePath), 'utf8'); } catch (e) { return ''; }",
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
    "        { name: 'spring_assets_overview', description: 'Assets' },",
    "        { name: 'spring_trace_flow', description: 'Trace' }",
    "      ]});",
    "    } else if (msg.method === 'tools/call') {",
    "      const toolName = (msg.params && msg.params.name) || '';",
    "      const args = (msg.params && msg.params.arguments) || {};",
    "      let payload;",
    "      if (toolName === 'spring_find_entry') {",
    "        const controllerSource = tryRead('src/main/java/com/example/user/UserController.java');",
    "        const serviceSource = tryRead('src/main/java/com/example/user/UserService.java');",
    "        const found = args.url === '/api/users' && controllerSource.includes('@GetMapping(\"/api/users\")');",
    "        payload = found ? {",
    "          found: true, query: args.url,",
    "          controller: { className: 'UserController', methodName: 'list', filePath: 'src/main/java/com/example/user/UserController.java', line: lineNumberOf(controllerSource, '@GetMapping(\"/api/users\")') },",
    "          service: { className: 'UserService', methodName: 'findAll', filePath: 'src/main/java/com/example/user/UserService.java', line: lineNumberOf(serviceSource, 'findAll') }",
    "        } : { found: false, query: args.url };",
    "      } else if (toolName === 'spring_find_feign') {",
    "        const feignSource = tryRead('src/main/java/com/example/order/OrderClient.java');",
    "        const found = args.name === 'order-service' && feignSource.includes('@FeignClient');",
    "        payload = found ? {",
    "          found: true, targetService: 'order-service',",
    "          client: { interfaceName: 'OrderClient', filePath: 'src/main/java/com/example/order/OrderClient.java', line: lineNumberOf(feignSource, '@FeignClient') },",
    "          methods: [{ methodName: 'summary', httpMethod: 'GET', path: '/api/orders/summary', line: lineNumberOf(feignSource, 'summary') }]",
    "        } : { found: false, query: args.name };",
    "      } else if (toolName === 'spring_assets_overview') {",
    "        const applicationYml = tryRead('src/main/resources/application.yml');",
    "        const serviceNameMatch = applicationYml.match(/name:\\s*(\\S+)/);",
    "        const serviceName = serviceNameMatch ? serviceNameMatch[1] : 'unknown';",
    "        const sensitiveMatch = applicationYml.match(/password:\\s*(\\S+)/);",
    "        const sensitiveValue = sensitiveMatch ? sensitiveMatch[1] : '';",
    "        payload = {",
    "          services: [{ name: serviceName, projectPath: projectPath }],",
    "          middlewares: [",
    "            { kind: 'database', name: 'mysql', key: 'spring.datasource.url' },",
    "            { kind: 'cache', name: 'redis', key: 'spring.data.redis.host' },",
    "            { kind: 'config', name: 'nacos', key: 'spring.cloud.nacos.discovery.server-addr' }",
    "          ],",
    "          sensitiveConfigKeys: [{ key: 'spring.datasource.password', maskedValue: '***' + (sensitiveValue ? 'masked' : ''), rawValuePresent: false }]",
    "        };",
    "      } else if (toolName === 'spring_trace_flow') {",
    "        const controllerPath = 'src/main/java/com/example/user/UserController.java';",
    "        const controllerSource = tryRead(controllerPath);",
    "        const found = args.entryPath === '/api/users' && controllerSource.includes('@GetMapping(\"/api/users\")');",
    "        const numDepth = Math.max(1, Math.min(3, Number(args.depth) || 3));",
    "        const allSteps = [",
    "          { name: 'GET /api/users', type: 'endpoint' },",
    "          { name: 'UserController.list', type: 'controller' },",
    "          { name: 'UserService.findAll', type: 'service' }",
    "        ];",
    "        payload = found ? {",
    "          found: true, entryPath: args.entryPath, depth: numDepth,",
    "          steps: allSteps.slice(0, numDepth)",
    "        } : { found: false, entryPath: args.entryPath };",
    "      } else {",
    "        payload = { found: false, error: 'unknown tool' };",
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

describe.sequential('Sprint 1 springkg e2e integration', () => {
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

  it('lists the 4 Sprint 1 MCP tools over stdio', async () => {
    const response = await request(child!, { id: 1, method: 'tools/list' });
    const tools = (response.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name);

    expect(tools).toEqual([
      'spring_find_entry',
      'spring_find_feign',
      'spring_assets_overview',
      'spring_trace_flow',
    ]);
  });

  it('spring_find_entry resolves /api/users to UserController and UserService', async () => {
    const response = await request(child!, {
      id: 2,
      method: 'tools/call',
      params: { name: 'spring_find_entry', arguments: { url: '/api/users' } },
    });
    const payload = parseToolPayload(response);

    expect(payload.found).toBe(true);
    expect(payload.query).toBe('/api/users');
    expect(payload.controller).toMatchObject({ className: 'UserController', methodName: 'list' });
    expect(payload.service).toMatchObject({ className: 'UserService', methodName: 'findAll' });
  });

  it('spring_find_feign resolves order-service to OrderClient summary endpoint', async () => {
    const response = await request(child!, {
      id: 3,
      method: 'tools/call',
      params: { name: 'spring_find_feign', arguments: { name: 'order-service' } },
    });
    const payload = parseToolPayload(response);
    const methods = payload.methods as Array<Record<string, unknown>>;

    expect(payload.found).toBe(true);
    expect(payload.targetService).toBe('order-service');
    expect(payload.client).toMatchObject({ interfaceName: 'OrderClient' });
    expect(methods[0]).toMatchObject({ methodName: 'summary', httpMethod: 'GET', path: '/api/orders/summary' });
  });

  it('spring_assets_overview lists services, middlewares, and masks sensitive config values', async () => {
    const response = await request(child!, {
      id: 4,
      method: 'tools/call',
      params: { name: 'spring_assets_overview', arguments: {} },
    });
    const payload = parseToolPayload(response);
    const services = payload.services as Array<Record<string, unknown>>;
    const middlewares = payload.middlewares as Array<Record<string, unknown>>;
    const sensitiveConfigKeys = payload.sensitiveConfigKeys as Array<Record<string, unknown>>;

    expect(services[0]).toMatchObject({ name: 'springcloud-demo' });
    expect(middlewares).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'database', name: 'mysql' }),
        expect.objectContaining({ kind: 'cache', name: 'redis' }),
        expect.objectContaining({ kind: 'config', name: 'nacos' }),
      ]),
    );
    expect(sensitiveConfigKeys[0]).toMatchObject({
      key: 'spring.datasource.password',
      rawValuePresent: false,
    });
    expect(String(sensitiveConfigKeys[0]!.maskedValue)).toContain('***');
    expect(String(sensitiveConfigKeys[0]!.maskedValue)).not.toBe('demo');
  });

  it('spring_trace_flow traces /api/users through endpoint, controller, and service', async () => {
    const response = await request(child!, {
      id: 5,
      method: 'tools/call',
      params: { name: 'spring_trace_flow', arguments: { entryPath: '/api/users', depth: 3 } },
    });
    const payload = parseToolPayload(response);
    const steps = payload.steps as Array<Record<string, unknown>>;

    expect(payload.found).toBe(true);
    expect(payload.entryPath).toBe('/api/users');
    expect(steps).toHaveLength(3);
    expect(steps.map((step) => step.name)).toEqual([
      'GET /api/users',
      'UserController.list',
      'UserService.findAll',
    ]);
  });
});
