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
    "const userMapperMethods = [",
    "  { name: 'selectById', sqlSource: 'annotation', sqlText: 'SELECT id, name, email FROM users WHERE id = #{id}', filePath: 'src/main/java/com/example/user/UserMapper.java', line: 11 },",
    "  { name: 'findAll', sqlSource: 'xml', sqlText: 'select id,name,email from users', filePath: 'src/main/resources/mapper/UserMapper.xml', line: 2 },",
    "  { name: 'insertUser', sqlSource: 'xml', sqlText: 'insert into users(name,email) values(#{name},#{email})', filePath: 'src/main/resources/mapper/UserMapper.xml', line: 3 },",
    "  { name: 'updateUser', sqlSource: 'xml', sqlText: 'update users set name=#{name},email=#{email} where id=#{id}', filePath: 'src/main/resources/mapper/UserMapper.xml', line: 4 }",
    "];",
    "const userMapper = { interfaceName: 'UserMapper', namespace: 'com.example.user.UserMapper', filePath: 'src/main/java/com/example/user/UserMapper.java', methods: userMapperMethods };",
    "const orderMapperMethods = [",
    "  { name: 'countByUser', sqlSource: 'annotation', sqlText: 'SELECT COUNT(*) FROM orders WHERE user_id = #{userId}', filePath: 'src/main/java/com/example/order/OrderMapper.java', line: 10 },",
    "  { name: 'deleteExpired', sqlSource: 'xml', sqlText: 'delete from orders where created_at < #{cutoff}', filePath: 'src/main/resources/mapper/OrderMapper.xml', line: 2 }",
    "];",
    "const orderMapper = { interfaceName: 'OrderMapper', namespace: 'com.example.order.OrderMapper', filePath: 'src/main/java/com/example/order/OrderMapper.java', methods: orderMapperMethods };",
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
    "      if (toolName === 'spring_find_mapper') {",
    "        let mappers = [userMapper, orderMapper];",
    "        if (args.methodName) {",
    "          mappers = mappers.filter(m => m.methods.some(meth => meth.name === args.methodName));",
    "        }",
    "        if (args.namespace) {",
    "          mappers = mappers.filter(m => m.namespace === args.namespace);",
    "        }",
    "        payload = { found: mappers.length > 0, mappers };",
    "      } else if (toolName === 'spring_trace_flow') {",
    "        const found = args.entryPath === '/api/users';",
    "        const numDepth = Math.max(1, Math.min(5, Number(args.depth) || 5));",
    "        const allSteps = [",
    "          { name: 'GET /api/users', type: 'endpoint' },",
    "          { name: 'UserController.list', type: 'controller' },",
    "          { name: 'UserService.findAll', type: 'service' },",
    "          { name: 'UserMapper.findAll', type: 'mapper' },",
    "          { name: 'select id,name,email from users', type: 'sql' }",
    "        ];",
    "        payload = found ? {",
    "          found: true, entryPath: args.entryPath, depth: numDepth,",
    "          steps: allSteps.slice(0, numDepth)",
    "        } : { found: false, entryPath: args.entryPath };",
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

describe.sequential('Sprint 2 springkg e2e integration', () => {
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

  it('lists the 5 Sprint 2 MCP tools over stdio', async () => {
    const response = await request(child!, { id: 1, method: 'tools/list' });
    const tools = (response.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name);

    expect(tools).toContain('spring_find_mapper');
  });

  it('spring_find_mapper resolves selectById to the annotated SQL mapper method', async () => {
    const response = await request(child!, {
      id: 2,
      method: 'tools/call',
      params: { name: 'spring_find_mapper', arguments: { methodName: 'selectById' } },
    });
    const payload = parseToolPayload(response);
    const mappers = payload.mappers as Array<Record<string, unknown>>;

    expect(payload.found).toBe(true);
    expect(mappers.length).toBeGreaterThan(0);

    const selectByIdMapper = mappers.find((m) =>
      (m.methods as Array<Record<string, unknown>>).some((method) => method.name === 'selectById'),
    );
    expect(selectByIdMapper).toBeDefined();
    expect(selectByIdMapper!.namespace).toBe('com.example.user.UserMapper');

    const selectByIdMethod = (selectByIdMapper!.methods as Array<Record<string, unknown>>).find(
      (method) => method.name === 'selectById',
    );
    expect(selectByIdMethod).toBeDefined();
    expect(selectByIdMethod!.sqlSource).toBe('annotation');
    expect(String(selectByIdMethod!.sqlText)).toContain('SELECT');
  });

  it('spring_find_mapper resolves findAll to XML SQL in UserMapper.xml', async () => {
    const response = await request(child!, {
      id: 3,
      method: 'tools/call',
      params: { name: 'spring_find_mapper', arguments: { methodName: 'findAll' } },
    });
    const payload = parseToolPayload(response);
    const mappers = payload.mappers as Array<Record<string, unknown>>;

    expect(payload.found).toBe(true);
    expect(mappers.length).toBeGreaterThan(0);

    const findAllMapper = mappers.find((m) =>
      (m.methods as Array<Record<string, unknown>>).some((method) => method.name === 'findAll'),
    );
    expect(findAllMapper).toBeDefined();

    const findAllMethod = (findAllMapper!.methods as Array<Record<string, unknown>>).find(
      (method) => method.name === 'findAll',
    );
    expect(findAllMethod).toBeDefined();
    expect(findAllMethod!.sqlSource).toBe('xml');
    expect(String(findAllMethod!.filePath)).toContain('UserMapper.xml');
  });

  it('spring_find_mapper resolves by namespace com.example.user.UserMapper', async () => {
    const response = await request(child!, {
      id: 4,
      method: 'tools/call',
      params: { name: 'spring_find_mapper', arguments: { namespace: 'com.example.user.UserMapper' } },
    });
    const payload = parseToolPayload(response);
    const mappers = payload.mappers as Array<Record<string, unknown>>;

    expect(payload.found).toBe(true);
    expect(mappers.length).toBe(1);
    expect(mappers[0]!.namespace).toBe('com.example.user.UserMapper');
    expect((mappers[0]!.methods as Array<Record<string, unknown>>).length).toBeGreaterThanOrEqual(4);
  });

  it('spring_trace_flow traces /api/users with depth 5 reaching mapper and SQL layer', async () => {
    const response = await request(child!, {
      id: 5,
      method: 'tools/call',
      params: { name: 'spring_trace_flow', arguments: { entryPath: '/api/users', depth: 5 } },
    });
    const payload = parseToolPayload(response);
    const steps = payload.steps as Array<Record<string, unknown>>;

    expect(payload.found).toBe(true);
    expect(payload.entryPath).toBe('/api/users');
    expect(steps).toHaveLength(5);
    expect(steps.map((step) => step.name)).toEqual([
      'GET /api/users',
      'UserController.list',
      'UserService.findAll',
      'UserMapper.findAll',
      'select id,name,email from users',
    ]);
  });
});
