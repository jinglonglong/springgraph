import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
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
const MCP_SERVER_BIN = path.join(REPO_ROOT, 'packages', 'springkg-mcp', 'dist', 'bin', 'springkg-mcp.js');

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

function spawnMcpServer(): ChildProcessWithoutNullStreams {
  if (!fs.existsSync(MCP_SERVER_BIN)) {
    throw new Error(`MCP server not built: ${MCP_SERVER_BIN}`);
  }

  return spawn(process.execPath, [MCP_SERVER_BIN], {
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

describe.sequential('Sprint 2 springkg e2e integration', () => {
  let child: ChildProcessWithoutNullStreams | null = null;
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

    child = spawnMcpServer();
    await initializeServer(child);
  }, 120_000);

  afterAll(async () => {
    if (child) {
      const exited = new Promise<void>((resolve) => child!.once('exit', () => resolve()));
      child.kill('SIGKILL');
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3_000))]);
      child = null;
    }

    fs.rmSync(CODEGRAPH_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    if (hadExistingCodegraphDir) {
      fs.renameSync(codegraphBackupPath, CODEGRAPH_DIR);
    }
  });

  it('lists the 5 Sprint 2 MCP tools over stdio', async () => {
    const response = await request(child!, { id: 1, method: 'tools/list' });
    const tools = (response.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name);

    expect(tools).toEqual([
      'spring_find_entry',
      'spring_find_feign',
      'spring_find_mapper',
      'spring_assets_overview',
      'spring_trace_flow',
    ]);
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
    expect(selectByIdMethod!.sqlText).toContain('SELECT');
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
      expect.stringContaining('select'),
    ]);
  });
});
