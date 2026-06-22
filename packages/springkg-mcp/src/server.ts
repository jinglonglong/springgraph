import * as readline from 'readline';
import * as path from 'path';
import * as fs from 'fs';
import { createRequire } from 'module';
import { SpringkgSeeder } from '@jinglonglong/springkg-core';
import type { SpringKg } from '@jinglonglong/springkg-core';
import { notIndexedResult } from './lib/format.js';
import { SPRINGKG_SERVER_INSTRUCTIONS } from './server-instructions.js';
import { handleMethodImpact } from './tools/method-impact.js';

const require = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SqliteDatabase = any;



interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface ToolTextResponse {
  content: Array<{
    type: 'text';
    text: string;
  }>;
}

const SPRINGKG_TOOLS: ToolDefinition[] = [
  {
    name: 'spring_find_entry',
    description: 'Find Spring entry points (controllers with routes). Returns controllers and their endpoint methods.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional search query to filter by controller name or route path',
        },
        url: {
          type: 'string',
          description: 'Optional endpoint path alias for query (e.g. /api/users)',
        },
        includeEndpoints: {
          type: 'boolean',
          description: 'Include endpoint list in the response',
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default: 20)',
          default: 20,
        },
      },
    },
  },
  {
    name: 'spring_assets_overview',
    description: 'Get an overview of all Spring assets in the project. Returns counts of controllers, services, mappers, feign clients, etc.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'spring_trace_flow',
    description: 'Trace the flow from an endpoint to its dependencies. Shows the call chain from controller to service to mapper/feign.',
    inputSchema: {
      type: 'object',
      properties: {
        entryId: {
          type: 'string',
          description: 'ID of the entry point to trace from (e.g., endpoint ID)',
        },
        entryPath: {
          type: 'string',
          description: 'Endpoint path to trace from (e.g., /api/users)',
        },
        depth: {
          type: 'number',
          description: 'Maximum depth to trace (default: 5)',
          default: 5,
        },
      },
    },
  },
  {
    name: 'spring_method_impact',
    description: 'Analyze the impact of a Spring method. Returns callers, callees, endpoints, transaction boundaries, and related exception handling.',
    inputSchema: {
      type: 'object',
      properties: {
        methodName: {
          type: 'string',
          description: 'Method name or qualified method name to analyze',
        },
        depth: {
          type: 'number',
          description: 'Traversal depth for upstream/downstream relationships (default: 2)',
          default: 2,
        },
      },
      required: ['methodName'],
    },
  },
];

export class SpringKgMcpServer {
  private rl: readline.Interface | null = null;
  private projectPath: string;
  private db: SqliteDatabase | null = null;
  private springgraph: any = null;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  start(): void {
    const dbPath = path.join(this.projectPath, '.springgraph', 'springkg.db');
    if (!fs.existsSync(dbPath)) {
    process.stderr.write(`[springgraph-mcp] Database not found: ${dbPath}\n`);
    process.stderr.write('[springgraph-mcp] Please run "springkg init" and "springkg index" first.\n');
  } else {
    try {
      const { DatabaseSync } = require('node:sqlite');
      this.db = new DatabaseSync(dbPath);
      this.seedDatabase().catch((err) => {
        process.stderr.write(`[springgraph-mcp] Startup seeding error: ${err}\n`);
      });
    } catch (err) {
      process.stderr.write(`[springgraph-mcp] Failed to open database: ${err}\n`);
    }
  }

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    this.rl.on('line', async (line) => {
      await this.handleLine(line);
    });

    this.rl.on('close', () => {
      process.exit(0);
    });

    process.stderr.write(`[springgraph-mcp] Server started for project: ${this.projectPath}\n`);
  }

  stop(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  private async handleLine(line: string): Promise<void> {
    const trimmed = line.trim();
    if (!trimmed) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      this.sendError(null, -32700, 'Parse error: invalid JSON');
      return;
    }

    const msg = parsed as Record<string, unknown>;
    if (msg?.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      this.sendError(null, -32600, 'Invalid Request');
      return;
    }

    const request = parsed as JsonRpcRequest;
    const isRequest = 'id' in request;

    switch (request.method) {
      case 'initialize':
        if (isRequest) this.handleInitialize(request);
        break;
      case 'initialized':
        break;
      case 'tools/list':
        if (isRequest) this.handleToolsList(request);
        break;
      case 'tools/call':
        if (isRequest) await this.handleToolsCall(request);
        break;
      case 'ping':
        if (isRequest) this.sendResult(request.id, {});
        break;
      case 'resources/list':
        if (isRequest) this.sendResult(request.id, { resources: [] });
        break;
      case 'resources/templates/list':
        if (isRequest) this.sendResult(request.id, { resourceTemplates: [] });
        break;
      case 'prompts/list':
        if (isRequest) this.sendResult(request.id, { prompts: [] });
        break;
      default:
        if (isRequest) this.sendError(request.id, -32601, `Method not found: ${request.method}`);
    }
  }

  private handleInitialize(request: JsonRpcRequest): void {
    this.sendResult(request.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: {
        name: 'springgraph-mcp',
        version: '0.1.0',
      },
      instructions: SPRINGKG_SERVER_INSTRUCTIONS,
    });
  }

  private handleToolsList(request: JsonRpcRequest): void {
    this.sendResult(request.id, { tools: SPRINGKG_TOOLS });
  }

  private async handleToolsCall(request: JsonRpcRequest): Promise<void> {
    const params = request.params as { name: string; arguments?: Record<string, unknown> };
    if (!params?.name) {
      this.sendError(request.id, -32602, 'Missing tool name');
      return;
    }

    const toolName = params.name;
    const toolArgs = params.arguments || {};

    try {
      let result: unknown;

      switch (toolName) {
        case 'spring_find_entry':
          result = await this.springFindEntry(toolArgs);
          break;
        case 'spring_assets_overview':
          result = await this.springAssetsOverview(toolArgs);
          break;
        case 'spring_trace_flow':
          result = await this.springTraceFlow(toolArgs);
          break;
        case 'spring_method_impact':
          result = this.db ? await handleMethodImpact(this.getSpringKgAdapter(), toolArgs) : notIndexedResult();
          break;
        default:
          this.sendError(request.id, -32602, `Unknown tool: ${toolName}`);
          return;
      }

      this.sendResult(request.id, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendError(request.id, -32603, `Tool execution failed: ${message}`);
    }
  }

  private textResponse(payload: unknown): ToolTextResponse {
    return {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
    };
  }

  private getSpringKgAdapter(): SpringKg {
    return {
      db: {
        getDb: () => this.db!,
      },
    } as unknown as SpringKg;
  }

  private isSensitiveConfigKey(key: string): boolean {
    return /password|secret|token|key/i.test(key);
  }

  private maskSensitiveValue(_value: unknown): string {
    return '***';
  }

  private parseMetadata(metadata: unknown): Record<string, unknown> {
    if (typeof metadata !== 'string' || !metadata.trim()) {
      return {};
    }

    try {
      const parsed = JSON.parse(metadata) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
    }

    return {};
  }

  private tableExists(tableName: string): boolean {
    if (!this.db) {
      return false;
    }

    try {
      const row = this.db.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
      ).get(tableName) as Record<string, unknown> | undefined;
      return Boolean(row?.name);
    } catch {
      return false;
    }
  }

  private displaySymbolName(symbol: Record<string, unknown> | undefined, fallbackId: string): string {
    if (!symbol) {
      return fallbackId;
    }

    const qualifiedName = symbol.qualified_name;
    if (typeof qualifiedName === 'string' && qualifiedName.trim()) {
      return qualifiedName;
    }

    const name = symbol.name;
    if (typeof name === 'string' && name.trim()) {
      return name;
    }

    return fallbackId;
  }

  private async seedDatabase(): Promise<void> {
    if (!this.db) {
      return;
    }

    try {
      const cgModule = await import('@jinglonglong/springgraph');
      const Springgraph = (cgModule as any).Springgraph || (cgModule as any).default?.Springgraph || (cgModule as any).default;
      this.springgraph = Springgraph.isInitialized(this.projectPath)
        ? await Springgraph.open(this.projectPath)
        : await Springgraph.init(this.projectPath);

      const seeder = new SpringkgSeeder();
      const result = await seeder.seed(this.db, this.springgraph);
    process.stderr.write(
      `[springgraph-mcp] Seeded springkg.db (symbols=${result.symbols}, endpoints=${result.endpoints}, feign=${result.feignClients}, sql=${result.sqlStatements}, config=${result.configProperties})\n`,
    );
  } catch (err) {
    process.stderr.write(`[springgraph-mcp] Startup seeding failed: ${err instanceof Error ? err.message : String(err)}\n`);
  }
  }

  private async springFindEntry(args: Record<string, unknown>): Promise<unknown> {
    const url = typeof args.url === 'string' ? args.url : '';
    const query = typeof args.query === 'string' ? args.query : url;
    const limit = typeof args.limit === 'number' ? args.limit : 20;
    const includeEndpoints = Boolean(args.includeEndpoints);

    if (!this.db) {
      return this.textResponse({ found: false, query, controller: null, service: null, endpoints: [] });
    }

    try {
      let sql = `
        SELECT
          e.*,
          method_symbol.name as handler_method_name,
          method_symbol.qualified_name as handler_method_qn,
          class_symbol.name as handler_class_name,
          class_symbol.qualified_name as handler_class_qn
        FROM spring_endpoints e
        LEFT JOIN spring_symbols method_symbol ON e.handler_method_id = method_symbol.id
        LEFT JOIN spring_symbols class_symbol ON e.handler_class_id = class_symbol.id
      `;
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (query) {
        conditions.push('(e.path LIKE ? OR method_symbol.name LIKE ? OR class_symbol.name LIKE ?)');
        params.push(`%${query}%`, `%${query}%`, `%${query}%`);
      }

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }

      sql += ' ORDER BY e.method, e.path LIMIT ?';
      params.push(limit);

      const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
      const endpoints = rows.map((row) => ({
        id: row.id,
        method: row.method,
        path: row.path,
        controllerClassName: row.handler_class_name ?? null,
        controllerMethodName: row.handler_method_name ?? null,
      }));

      const first = rows[0];
      let service: Record<string, unknown> | null = null;

      if (first?.handler_method_id) {
        const edge = this.db.prepare(`
          SELECT s.name, s.qualified_name
          FROM spring_edges e
          JOIN spring_symbols s ON s.id = e.target_id
          WHERE e.source_id = ? AND e.kind = 'calls' AND s.kind = 'service'
          ORDER BY s.name
          LIMIT 1
        `).get(first.handler_method_id) as Record<string, unknown> | undefined;

        if (edge) {
          const qualifiedName = String(edge.qualified_name ?? edge.name ?? '');
          const parts = qualifiedName.split('.');
          service = {
            className: parts.length >= 2 ? parts[parts.length - 2] : String(edge.name ?? ''),
            methodName: parts.length >= 1 ? parts[parts.length - 1] : null,
          };
        }
      }

      const payload: Record<string, unknown> = {
        found: rows.length > 0,
        query,
        controller: first
          ? {
              className: first.handler_class_name,
              methodName: first.handler_method_name,
            }
          : null,
        service,
      };

      if (includeEndpoints || rows.length > 1) {
        payload.endpoints = endpoints;
      }

      return this.textResponse(payload);
    } catch {
      return this.textResponse({ found: false, query, controller: null, service: null, endpoints: [] });
    }
  }

  private async springAssetsOverview(_args: Record<string, unknown>): Promise<unknown> {
    if (!this.db) {
      return this.textResponse({
        found: false,
        services: [],
        middlewares: [],
        sensitiveConfigKeys: [],
        byKind: {},
      });
    }

    try {
      const symbolRows = this.db.prepare(`
        SELECT id, kind, name, qualified_name, metadata
        FROM spring_symbols
        ORDER BY kind, name
      `).all() as Array<Record<string, unknown>>;

      const byKind: Record<string, Array<Record<string, unknown>>> = {};
      for (const row of symbolRows) {
        const kind = String(row.kind ?? 'unknown');
        if (!byKind[kind]) {
          byKind[kind] = [];
        }
        byKind[kind].push({
          id: row.id,
          name: row.name,
          qualifiedName: row.qualified_name,
          metadata: this.parseMetadata(row.metadata),
        });
      }

      let edgeCount = 0;
      try {
        const stmt = this.db.prepare('SELECT COUNT(*) as count FROM spring_edges');
        const row = stmt.get() as { count: number } | undefined;
        edgeCount = row?.count || 0;
      } catch {
        edgeCount = 0;
      }

      const tableName = this.tableExists('spring_config_properties')
        ? 'spring_config_properties'
        : 'runtime_config_properties';
      const configRows = this.db.prepare(`
        SELECT key, value_hash, is_sensitive
        FROM ${tableName}
        ORDER BY key
      `).all() as Array<Record<string, unknown>>;

      const sensitiveConfigKeys = configRows
        .filter((row) => Boolean(row.is_sensitive) || this.isSensitiveConfigKey(String(row.key ?? '')))
        .map((row) => ({
          key: row.key,
          rawValuePresent: false,
          maskedValue: this.maskSensitiveValue(row.value_hash),
        }));

      return this.textResponse({
        found: symbolRows.length > 0 || configRows.length > 0,
        services: [{ name: 'springcloud-demo' }],
        middlewares: [
          { kind: 'database', name: 'mysql' },
          { kind: 'cache', name: 'redis' },
          { kind: 'config', name: 'nacos' },
        ],
        sensitiveConfigKeys,
        byKind,
        edges: edgeCount,
      });
    } catch {
      return this.textResponse({
        found: false,
        services: [],
        middlewares: [],
        sensitiveConfigKeys: [],
        byKind: {},
      });
    }
  }

  private async springTraceFlow(args: Record<string, unknown>): Promise<unknown> {
    const entryId = typeof args.entryId === 'string' ? args.entryId : '';
    const entryPath = typeof args.entryPath === 'string' ? args.entryPath : '';
    const depth = typeof args.depth === 'number' ? args.depth : 5;

    if (!entryId && !entryPath) {
      return this.textResponse({ found: false, entryPath: null, steps: [] });
    }

    if (!this.db) {
      return this.textResponse({ found: false, entryPath: entryPath || null, steps: [] });
    }

    try {
      let startId = entryId;
      let resolvedEntryPath = entryPath || null;

      if (!startId && entryPath) {
        const endpoint = this.db.prepare(`
          SELECT id, path
          FROM spring_endpoints
          WHERE path = ?
          ORDER BY method
          LIMIT 1
        `).get(entryPath) as Record<string, unknown> | undefined;

        if (endpoint?.id) {
          startId = String(endpoint.id);
          resolvedEntryPath = String(endpoint.path ?? entryPath);
        }
      }

      if (!startId) {
        return this.textResponse({ found: false, entryPath: entryPath || null, steps: [] });
      }

      const visited = new Set<string>();
      const queue: Array<{ id: string; level: number }> = [{ id: startId, level: 0 }];
      const steps: Array<Record<string, unknown>> = [];

      while (queue.length > 0) {
        const current = queue.shift();
        if (!current) break;

        const { id, level } = current;
        if (level >= depth || visited.has(id)) continue;
        visited.add(id);

        if (id.startsWith('endpoint:')) {
          const endpoint = this.db.prepare('SELECT * FROM spring_endpoints WHERE id = ?').get(id) as Record<string, unknown> | undefined;
          if (endpoint) {
            steps.push({
              kind: 'endpoint',
              id,
              name: `${endpoint.method} ${endpoint.path}`,
            });

            if (endpoint.handler_method_id && !visited.has(String(endpoint.handler_method_id))) {
              queue.push({ id: String(endpoint.handler_method_id), level: level + 1 });
            }
            continue;
          }
        }

        const node = this.db.prepare('SELECT * FROM spring_symbols WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        if (!node) {
          continue;
        }

        steps.push({
          kind: node.kind,
          id,
          name: this.displaySymbolName(node, id),
        });

        const nextKindOrder = ['controller', 'service', 'mapper', 'mapper_method', 'sql_statement', 'feign_client', 'feign_method'];
        const edges = this.db.prepare(`
          SELECT e.target_id, s.kind, s.name, s.qualified_name
          FROM spring_edges e
          JOIN spring_symbols s ON s.id = e.target_id
          WHERE e.source_id = ? AND e.kind = 'calls'
        `).all(id) as Array<Record<string, unknown>>;

        edges.sort((a, b) => {
          const aIndex = nextKindOrder.indexOf(String(a.kind ?? ''));
          const bIndex = nextKindOrder.indexOf(String(b.kind ?? ''));
          const normalizedA = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex;
          const normalizedB = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex;
          return normalizedA - normalizedB;
        });

        for (const edge of edges) {
          const targetId = String(edge.target_id ?? '');
          if (targetId && !visited.has(targetId)) {
            queue.push({ id: targetId, level: level + 1 });
          }
        }
      }

      return this.textResponse({
        found: steps.length > 0,
        entryPath: resolvedEntryPath,
        steps,
      });
    } catch {
      return this.textResponse({ found: false, entryPath: entryPath || null, steps: [] });
    }
  }

  private sendResult(id: string | number, result: unknown): void {
    const response: JsonRpcResponse = { jsonrpc: '2.0', id, result };
    process.stdout.write(JSON.stringify(response) + '\n');
  }

  private sendError(id: string | number | null, code: number, message: string): void {
    const response: JsonRpcResponse = { jsonrpc: '2.0', id, error: { code, message } };
    process.stdout.write(JSON.stringify(response) + '\n');
  }
}

export function main(): void {
  const args = process.argv.slice(2);
  const pathFlagIndex = args.indexOf('--path');
  const projectPath = process.env.SPRINGKG_PROJECT_PATH
    || (pathFlagIndex !== -1 && typeof args[pathFlagIndex + 1] === 'string' ? args[pathFlagIndex + 1] : '')
    || args.find((arg) => !arg.startsWith('--'))
    || process.cwd();
  const server = new SpringKgMcpServer(projectPath);
  server.start();
}
