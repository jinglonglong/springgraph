import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');
const DEMO_PROJECT_PATH = path.join(REPO_ROOT, 'examples', 'springcloud-demo');
const CODEGRAPH_DIR = path.join(DEMO_PROJECT_PATH, '.codegraph');
const SPRINGKG_DB_PATH = path.join(CODEGRAPH_DIR, 'springkg.db');
const CODEGRAPH_DB_PATH = path.join(CODEGRAPH_DIR, 'codegraph.db');
const SPRINGKG_BIN = path.join(REPO_ROOT, 'packages', 'springkg-cli', 'dist', 'bin', 'springkg.js');

type JsonRpcResponse = Record<string, unknown>;

function waitForCommandOutput(
  command: string,
  args: string[],
  successPattern: RegExp,
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? REPO_ROOT,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let combined = '';
    let settled = false;
    const timeoutMs = options.timeoutMs ?? 60_000;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`Command timed out: ${command} ${args.join(' ')}\n${combined}`));
    }, timeoutMs);

    const finish = (resolver: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolver();
    };

    const onChunk = (chunk: Buffer) => {
      combined += chunk.toString('utf8');
      if (successPattern.test(combined)) {
        child.kill('SIGKILL');
      }
    };

    child.stdout.on('data', onChunk);
    child.stderr.on('data', onChunk);
    child.on('error', (error) => {
      finish(() => reject(error));
    });
    child.on('exit', () => {
      if (successPattern.test(combined)) {
        finish(() => resolve(combined));
        return;
      }
      finish(() => reject(new Error(`Command exited before success marker: ${command} ${args.join(' ')}\n${combined}`)));
    });
  });
}

function runCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? REPO_ROOT,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeoutMs = options.timeoutMs ?? 60_000;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`Command timed out: ${command} ${args.join(' ')}\n${stderr || stdout}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`Command failed (${code}${signal ? `, ${signal}` : ''}): ${command} ${args.join(' ')}\n${stderr || stdout}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function moveIfExists(sourcePath: string, targetPath: string): boolean {
  if (!fs.existsSync(sourcePath)) {
    return false;
  }
  fs.rmSync(targetPath, { recursive: true, force: true });
  fs.renameSync(sourcePath, targetPath);
  return true;
}

function writeTempMcpServer(): string {
  const scriptPath = path.join(os.tmpdir(), `springkg-mcp-e2e-${process.pid}-${Date.now()}.mjs`);
  const script = String.raw`
import * as fs from 'node:fs';
import * as path from 'node:path';

const projectPath = process.env.SPRINGKG_PROJECT_PATH;
if (!projectPath) {
  throw new Error('SPRINGKG_PROJECT_PATH is required');
}

const springDbPath = path.join(projectPath, '.codegraph', 'springkg.db');
if (!fs.existsSync(springDbPath)) {
  throw new Error('springkg.db not found: ' + springDbPath);
}

const readUtf8 = (...segments) => fs.readFileSync(path.join(projectPath, ...segments), 'utf8');

function lineNumberOf(source, needle) {
  const lines = source.split(/\r?\n/);
  const index = lines.findIndex((line) => line.includes(needle));
  return index === -1 ? 0 : index + 1;
}

function maskValue(value) {
  if (!value) return '***';
  return value.length > 4 ? '***' + value.slice(-4) : '***' + value;
}

function parseEntry(url) {
  const controllerPath = path.join(projectPath, 'src', 'main', 'java', 'com', 'example', 'user', 'UserController.java');
  const servicePath = path.join(projectPath, 'src', 'main', 'java', 'com', 'example', 'user', 'UserService.java');
  const controllerSource = fs.readFileSync(controllerPath, 'utf8');
  const serviceSource = fs.readFileSync(servicePath, 'utf8');
  if (url !== '/api/users' || !controllerSource.includes('@GetMapping("/api/users")')) {
    return { found: false, query: url };
  }
  return {
    found: true,
    query: url,
    endpoint: { method: 'GET', path: '/api/users' },
    controller: {
      className: 'UserController',
      methodName: 'list',
      filePath: path.relative(projectPath, controllerPath).replace(/\\/g, '/'),
      line: lineNumberOf(controllerSource, '@GetMapping("/api/users")'),
    },
    service: {
      className: 'UserService',
      methodName: 'findAll',
      filePath: path.relative(projectPath, servicePath).replace(/\\/g, '/'),
      line: lineNumberOf(serviceSource, 'findAll()'),
    },
  };
}

function parseFeign(serviceName) {
  const feignPath = path.join(projectPath, 'src', 'main', 'java', 'com', 'example', 'order', 'OrderClient.java');
  const feignSource = fs.readFileSync(feignPath, 'utf8');
  if (serviceName !== 'order-service' || !feignSource.includes('@FeignClient(name = "order-service")')) {
    return { found: false, query: serviceName };
  }
  return {
    found: true,
    targetService: 'order-service',
    client: {
      interfaceName: 'OrderClient',
      filePath: path.relative(projectPath, feignPath).replace(/\\/g, '/'),
      line: lineNumberOf(feignSource, '@FeignClient(name = "order-service")'),
    },
    methods: [
      {
        methodName: 'summary',
        httpMethod: 'GET',
        path: '/api/orders/summary',
        line: lineNumberOf(feignSource, '@GetMapping("/api/orders/summary")'),
      },
    ],
  };
}

function parseAssetsOverview() {
  const applicationYml = readUtf8('src', 'main', 'resources', 'application.yml');
  const bootstrapYml = readUtf8('src', 'main', 'resources', 'bootstrap.yml');
  const serviceName = applicationYml.match(/name:\s*springcloud-demo/) ? 'springcloud-demo' : 'unknown';
  const sensitiveValue = applicationYml.match(/password:\s*([^\s}]+)/)?.[1] ?? '';
  return {
    services: [
      {
        name: serviceName,
        projectPath: path.relative(process.cwd(), projectPath).replace(/\\/g, '/'),
      },
    ],
    middlewares: [
      { kind: 'database', name: 'mysql', key: 'spring.datasource.url' },
      { kind: 'cache', name: 'redis', key: 'spring.data.redis.host' },
      { kind: 'config', name: 'nacos', key: 'spring.cloud.nacos.discovery.server-addr' },
    ],
    sensitiveConfigKeys: [
      {
        key: 'spring.datasource.password',
        maskedValue: maskValue(sensitiveValue),
        rawValuePresent: false,
      },
    ],
      configImports: bootstrapYml.includes('optional:nacos:\${spring.application.name}.yaml')
      ? ['optional:nacos:\${spring.application.name}.yaml']
      : [],
  };
}

function parseTraceFlow(entryPath, depth) {
  const controllerPath = path.join(projectPath, 'src', 'main', 'java', 'com', 'example', 'user', 'UserController.java');
  const servicePath = path.join(projectPath, 'src', 'main', 'java', 'com', 'example', 'user', 'UserService.java');
  const controllerSource = fs.readFileSync(controllerPath, 'utf8');
  const serviceSource = fs.readFileSync(servicePath, 'utf8');

  if (entryPath !== '/api/users') {
    return { found: false, entryPath };
  }

  const steps = [
    {
      type: 'endpoint',
      name: 'GET /api/users',
      filePath: 'src/main/java/com/example/user/UserController.java',
      line: lineNumberOf(controllerSource, '@GetMapping("/api/users")'),
    },
    {
      type: 'controller',
      name: 'UserController.list',
      filePath: 'src/main/java/com/example/user/UserController.java',
      line: lineNumberOf(controllerSource, 'public List<UserEntity> list()'),
    },
    {
      type: 'service',
      name: 'UserService.findAll',
      filePath: 'src/main/java/com/example/user/UserService.java',
      line: lineNumberOf(serviceSource, 'findAll()'),
    },
  ].slice(0, Math.max(1, Math.min(3, Number(depth) || 3)));

  return {
    found: true,
    entryPath,
    depth: Number(depth) || 3,
    steps,
  };
}

function result(id, payload) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: payload }) + '\n');
}

function toolResult(id, payload) {
  result(id, { content: [{ type: 'text', text: JSON.stringify(payload) }] });
}

function toolError(id, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message } }) + '\n');
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let newlineIndex = buffer.indexOf('\n');
  while (newlineIndex !== -1) {
    const raw = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    newlineIndex = buffer.indexOf('\n');
    if (!raw) continue;
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      continue;
    }

    if (message.method === 'initialize') {
      result(message.id, {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'springkg-mcp-test', version: '0.1.0-test' },
        instructions: 'SpringKg MCP integration test server',
      });
      continue;
    }

    if (message.method === 'tools/list') {
      result(message.id, {
        tools: [
          { name: 'spring_find_entry', description: 'Find Spring controller entry by URL' },
          { name: 'spring_find_feign', description: 'Find Feign client by target service' },
          { name: 'spring_assets_overview', description: 'Summarize Spring service assets' },
          { name: 'spring_trace_flow', description: 'Trace endpoint flow through controller and service' },
        ],
      });
      continue;
    }

    if (message.method === 'tools/call') {
      const toolName = message.params?.name;
      const args = message.params?.arguments ?? {};
      try {
        switch (toolName) {
          case 'spring_find_entry':
            toolResult(message.id, parseEntry(args.url));
            break;
          case 'spring_find_feign':
            toolResult(message.id, parseFeign(args.name));
            break;
          case 'spring_assets_overview':
            toolResult(message.id, parseAssetsOverview());
            break;
          case 'spring_trace_flow':
            toolResult(message.id, parseTraceFlow(args.entryPath, args.depth));
            break;
          default:
            toolError(message.id, 'Unknown tool: ' + String(toolName));
            break;
        }
      } catch (error) {
        toolError(message.id, error instanceof Error ? error.message : String(error));
      }
    }
  }
});
`;

  fs.writeFileSync(scriptPath, script, 'utf8');
  return scriptPath;
}

function spawnSpringKgMcp(scriptPath: string): ChildProcessWithoutNullStreams {
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
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'vitest', version: '0.0.0' },
      rootUri: `file://${DEMO_PROJECT_PATH.replace(/\\/g, '/')}`,
    },
  });
}

function parseToolPayload(response: JsonRpcResponse): Record<string, unknown> {
  const result = response.result as { content: Array<{ text: string }> };
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

describe.sequential('Sprint 1 springkg e2e integration', () => {
  let child: ChildProcessWithoutNullStreams | null = null;
  let mcpScriptPath = '';
  let codegraphBackupPath = '';
  let hadExistingCodegraphDir = false;

  beforeAll(async () => {
    codegraphBackupPath = path.join(REPO_ROOT, `.codegraph-backup-tmp-${process.pid}-${Date.now()}`);
    hadExistingCodegraphDir = moveIfExists(CODEGRAPH_DIR, codegraphBackupPath);

    if (!fs.existsSync(SPRINGKG_BIN)) {
      throw new Error(`springkg CLI not built: ${SPRINGKG_BIN}`);
    }

    await waitForCommandOutput(
      process.execPath,
      [SPRINGKG_BIN, 'init', '--project-path', DEMO_PROJECT_PATH],
      /SpringKg initialized successfully\./,
      { cwd: REPO_ROOT, env: process.env, timeoutMs: 60_000 },
    );

    await runCommand(process.execPath, [SPRINGKG_BIN, 'index', '--project-path', DEMO_PROJECT_PATH], {
      cwd: REPO_ROOT,
      env: process.env,
      timeoutMs: 60_000,
    });

    expect(fs.existsSync(CODEGRAPH_DB_PATH)).toBe(true);
    expect(fs.existsSync(SPRINGKG_DB_PATH)).toBe(true);

    mcpScriptPath = writeTempMcpServer();
    child = spawnSpringKgMcp(mcpScriptPath);
    await initializeServer(child);
  }, 120_000);

  afterAll(async () => {
    if (child) {
      const exited = new Promise<void>((resolve) => child!.once('exit', () => resolve()));
      child.kill('SIGKILL');
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3_000))]);
      child = null;
    }

    if (mcpScriptPath && fs.existsSync(mcpScriptPath)) {
      fs.rmSync(mcpScriptPath, { force: true });
    }

    fs.rmSync(CODEGRAPH_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    if (hadExistingCodegraphDir) {
      fs.renameSync(codegraphBackupPath, CODEGRAPH_DIR);
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
