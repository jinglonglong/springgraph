import * as readline from 'readline';
import * as path from 'path';
import * as fs from 'fs';
import { createRequire } from 'module';
import { SpringkgSeeder } from '@colbymchenry/springkg-core';
import type { SpringKg } from '@colbymchenry/springkg-core';
import { notIndexedResult } from './lib/format.js';
import { SPRINGKG_SERVER_INSTRUCTIONS } from './server-instructions.js';
import { handleMethodImpact } from './tools/method-impact.js';
import { handleFieldImpact } from './tools/field-impact.js';
import { handleModuleSummary } from './tools/module-summary.js';
import { handleFindChangeSurface } from './tools/find-change-surface.js';
import { handleRuntimeDependency } from './tools/runtime-dependency.js';
import { handleEnvDiff } from './tools/env-diff.js';

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
    name: 'spring_find_feign',
    description: 'Find Feign clients and their target services. Returns Feign client interfaces and their methods.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional search query to filter by client name or target service',
        },
        clientName: {
          type: 'string',
          description: 'Optional exact client name or target service',
        },
        name: {
          type: 'string',
          description: 'Optional alias for clientName or target service',
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
    name: 'spring_find_mapper',
    description: 'Find MyBatis mappers by namespace or method name. Returns matching mappers and their SQL methods.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional search query matching mapper namespace or method name',
        },
        namespace: {
          type: 'string',
          description: 'Optional exact mapper namespace to match',
        },
        methodName: {
          type: 'string',
          description: 'Optional exact method name to match',
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
    name: 'spring_find_config',
    description: 'Find Spring runtime configuration properties. Sensitive values are masked.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional search query matching config keys',
        },
        key: {
          type: 'string',
          description: 'Optional exact property key to find',
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
    name: 'spring_nacos_overview',
    description: 'Get an overview of Nacos discovery and config properties.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'spring_gateway_route',
    description: 'List configured Spring gateway routes.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum results (default: 50)',
          default: 50,
        },
      },
    },
  },
  {
    name: 'spring_search_feature',
    description: 'Search feature communities by name or description.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query matching community name or summary',
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default: 20)',
          default: 20,
        },
      },
      required: ['query'],
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
  {
    name: 'spring_field_impact',
    description: 'Analyze the impact of a field or property. Returns mapper usage, read/write sites, and schema-level references.',
    inputSchema: {
      type: 'object',
      properties: {
        fieldName: {
          type: 'string',
          description: 'Field or property name to analyze',
        },
        className: {
          type: 'string',
          description: 'Optional declaring class filter',
        },
      },
      required: ['fieldName'],
    },
  },
  {
    name: 'spring_module_summary',
    description: 'Summarize a module or package path. Returns controllers, services, mappers, configs, dependencies, statistics, and recent symbols.',
    inputSchema: {
      type: 'object',
      properties: {
        modulePath: {
          type: 'string',
          description: 'Package name, module path, or file path prefix to summarize',
        },
      },
      required: ['modulePath'],
    },
  },
  {
    name: 'spring_find_change_surface',
    description: 'Find the change surface for one or more modified files. Returns affected symbols, related endpoints, and candidate tests.',
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          description: 'Changed file paths to analyze',
          items: { type: 'string' },
        },
        depth: {
          type: 'number',
          description: 'Impact traversal depth (default: 2)',
          default: 2,
        },
      },
      required: ['files'],
    },
  },
  {
    name: 'spring_runtime_dependency',
    description: 'List runtime dependencies for a service or method. Returns database, cache, MQ, HTTP/Feign, and config dependencies.',
    inputSchema: {
      type: 'object',
      properties: {
        serviceName: {
          type: 'string',
          description: 'Service, method, or qualified symbol name to analyze',
        },
      },
      required: ['serviceName'],
    },
  },
  {
    name: 'spring_env_diff',
    description: 'Compare two runtime environments using indexed config properties. Sensitive values stay masked.',
    inputSchema: {
      type: 'object',
      properties: {
        env1: {
          type: 'string',
          description: 'First environment name (for example: dev)',
        },
        env2: {
          type: 'string',
          description: 'Second environment name (for example: prod)',
        },
      },
      required: ['env1', 'env2'],
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
      process.stderr.write(`[springkg-mcp] Database not found: ${dbPath}\n`);
      process.stderr.write('[springkg-mcp] Please run "springkg init" and "springkg index" first.\n');
    } else {
      try {
        const { DatabaseSync } = require('node:sqlite');
        this.db = new DatabaseSync(dbPath);
        this.seedDatabase().catch((err) => {
          process.stderr.write(`[springkg-mcp] Startup seeding error: ${err}\n`);
        });
      } catch (err) {
        process.stderr.write(`[springkg-mcp] Failed to open database: ${err}\n`);
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

    process.stderr.write(`[springkg-mcp] Server started for project: ${this.projectPath}\n`);
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
        name: 'springkg-mcp',
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
        case 'spring_find_feign':
          result = await this.springFindFeign(toolArgs);
          break;
        case 'spring_find_mapper':
          result = await this.springFindMapper(toolArgs);
          break;
        case 'spring_find_config':
          result = await this.springFindConfig(toolArgs);
          break;
        case 'spring_nacos_overview':
          result = await this.springNacosOverview(toolArgs);
          break;
        case 'spring_gateway_route':
          result = await this.springGatewayRoute(toolArgs);
          break;
        case 'spring_search_feature':
          result = await this.springSearchFeature(toolArgs);
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
        case 'spring_field_impact':
          result = this.db ? await handleFieldImpact(this.getSpringKgAdapter(), toolArgs) : notIndexedResult();
          break;
        case 'spring_module_summary':
          result = this.db ? await handleModuleSummary(this.getSpringKgAdapter(), toolArgs) : notIndexedResult();
          break;
        case 'spring_find_change_surface':
          result = this.db ? await handleFindChangeSurface(this.getSpringKgAdapter(), toolArgs) : notIndexedResult();
          break;
        case 'spring_runtime_dependency':
          result = this.db ? await handleRuntimeDependency(this.getSpringKgAdapter(), toolArgs) : notIndexedResult();
          break;
        case 'spring_env_diff':
          result = this.db ? await handleEnvDiff(this.getSpringKgAdapter(), toolArgs) : notIndexedResult();
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
      const cgModule = await import('@colbymchenry/springgraph');
      const Springgraph = (cgModule as any).Springgraph || (cgModule as any).default?.Springgraph || (cgModule as any).default;
      this.springgraph = Springgraph.isInitialized(this.projectPath)
        ? await Springgraph.open(this.projectPath)
        : await Springgraph.init(this.projectPath);

      const seeder = new SpringkgSeeder();
      const result = await seeder.seed(this.db, this.springgraph);
      process.stderr.write(
        `[springkg-mcp] Seeded springkg.db (symbols=${result.symbols}, endpoints=${result.endpoints}, feign=${result.feignClients}, sql=${result.sqlStatements}, config=${result.configProperties})\n`,
      );
    } catch (err) {
      process.stderr.write(`[springkg-mcp] Startup seeding failed: ${err instanceof Error ? err.message : String(err)}\n`);
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

  private async springFindFeign(args: Record<string, unknown>): Promise<unknown> {
    const query = typeof args.query === 'string' ? args.query : '';
    const clientName = typeof args.clientName === 'string'
      ? args.clientName
      : typeof args.name === 'string'
        ? args.name
        : '';
    const limit = typeof args.limit === 'number' ? args.limit : 20;

    if (!this.db) {
      return this.textResponse({ found: false, targetService: clientName || query, client: null, methods: [] });
    }

    try {
      let sql = 'SELECT * FROM spring_feign_clients';
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (clientName) {
        conditions.push('(client_name = ? OR target_service = ?)');
        params.push(clientName, clientName);
      }

      if (query) {
        conditions.push('(client_name LIKE ? OR target_service LIKE ?)');
        params.push(`%${query}%`, `%${query}%`);
      }

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }

      sql += ' ORDER BY client_name LIMIT ?';
      params.push(limit);

      const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
      const first = rows[0];

      let client: Record<string, unknown> | null = null;
      let methods: Array<Record<string, unknown>> = [];

      if (first?.id) {
        const clientSymbol = this.db.prepare(`
          SELECT id, name, qualified_name
          FROM spring_symbols
          WHERE kind = 'feign_client' AND (name = ? OR name = ?)
          ORDER BY name
          LIMIT 1
        `).get(first.client_name, `${first.client_name}Client`) as Record<string, unknown> | undefined;

        client = {
          interfaceName: clientSymbol?.name ?? first.client_name,
          targetService: first.target_service,
        };

        if (clientSymbol?.id) {
          const methodRows = this.db.prepare(`
            SELECT s.name, s.qualified_name, s.metadata
            FROM spring_edges e
            JOIN spring_symbols s ON s.id = e.target_id
            WHERE e.source_id = ? AND e.kind = 'contains' AND s.kind = 'feign_method'
            ORDER BY s.name
          `).all(clientSymbol.id) as Array<Record<string, unknown>>;

          methods = methodRows.map((row) => {
            const metadata = this.parseMetadata(row.metadata);
            return {
              methodName: row.name,
              httpMethod: metadata.httpMethod ?? 'GET',
              path: metadata.path ?? null,
            };
          });
        }
      }

      return this.textResponse({
        found: rows.length > 0,
        targetService: first?.target_service ?? clientName ?? query,
        client,
        methods,
      });
    } catch {
      return this.textResponse({ found: false, targetService: clientName || query, client: null, methods: [] });
    }
  }

  private async springFindMapper(args: Record<string, unknown>): Promise<unknown> {
    const query = typeof args.query === 'string' ? args.query : '';
    const namespace = typeof args.namespace === 'string' ? args.namespace : '';
    const methodName = typeof args.methodName === 'string' ? args.methodName : '';
    const limit = typeof args.limit === 'number' ? args.limit : 20;

    if (!this.db) {
      return this.textResponse({ found: false, results: [], mappers: [] });
    }

    try {
      if (this.tableExists('spring_mapper_methods')) {
        let sql = `
          SELECT namespace, method_name, statement_type, sql
          FROM spring_mapper_methods
          WHERE 1 = 1
        `;
        const conditions: string[] = [];
        const params: unknown[] = [];

        if (namespace) {
          conditions.push('namespace = ?');
          params.push(namespace);
        }

        if (methodName) {
          conditions.push('method_name = ?');
          params.push(methodName);
        }

        if (query) {
          conditions.push('(method_name LIKE ? OR namespace LIKE ?)');
          params.push(`%${query}%`, `%${query}%`);
        }

        if (conditions.length > 0) {
          sql += ' AND ' + conditions.join(' AND ');
        }

        sql += ' ORDER BY namespace, method_name LIMIT ?';
        params.push(limit);

        const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
        const results = rows.map((row) => ({
          methodName: row.method_name ?? null,
          statementType: row.statement_type ?? null,
          sql: row.sql ?? null,
          namespace: row.namespace ?? null,
        }));

        return this.textResponse({ found: results.length > 0, results });
      }

      let sql = `
        SELECT
          m.id AS mapper_id,
          m.name AS mapper_name,
          m.qualified_name AS mapper_namespace,
          m.file_path AS mapper_file_path,
          method.id AS method_id,
          method.name AS method_name,
          method.file_path AS method_file_path,
          method.metadata AS method_metadata,
          sqls.sql_text AS sql_text,
          sqls.source_file_path AS sql_file_path
        FROM spring_symbols m
        LEFT JOIN spring_edges contains_edge
          ON contains_edge.source_id = m.id AND contains_edge.kind = 'contains'
        LEFT JOIN spring_symbols method
          ON method.id = contains_edge.target_id AND method.kind = 'mapper_method'
        LEFT JOIN spring_sql_statements sqls
          ON sqls.mapper_id = method.id
        WHERE m.kind = 'mapper'
      `;

      const conditions: string[] = [];
      const params: unknown[] = [];

      if (namespace) {
        conditions.push('m.qualified_name = ?');
        params.push(namespace);
      }

      if (methodName) {
        conditions.push('method.name = ?');
        params.push(methodName);
      }

      if (query) {
        conditions.push('(m.qualified_name LIKE ? OR m.name LIKE ? OR method.name LIKE ?)');
        params.push(`%${query}%`, `%${query}%`, `%${query}%`);
      }

      if (conditions.length > 0) {
        sql += ' AND ' + conditions.join(' AND ');
      }

      sql += ' ORDER BY m.qualified_name, method.name LIMIT ?';
      params.push(limit);

      const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
      const byMapper = new Map<string, Record<string, unknown>>();
      const results: Array<Record<string, unknown>> = [];

      for (const row of rows) {
        const mapperId = String(row.mapper_id ?? '');
        if (!mapperId) continue;

        if (!byMapper.has(mapperId)) {
          byMapper.set(mapperId, {
            namespace: row.mapper_namespace ?? row.mapper_name ?? mapperId,
            filePath: row.mapper_file_path ?? null,
            methods: [],
          });
        }

        if (!row.method_id) {
          continue;
        }

        const metadata = this.parseMetadata(row.method_metadata);
        const annotationSql = metadata.sqlText;
        const statementType = metadata.statementType ?? null;
        const methodSqlText = typeof row.sql_text === 'string' && row.sql_text.trim()
          ? row.sql_text
          : typeof annotationSql === 'string'
            ? annotationSql
            : null;
        const sqlSource = typeof row.sql_text === 'string' && row.sql_text.trim()
          ? 'xml'
          : typeof annotationSql === 'string'
            ? 'annotation'
            : 'unknown';

        results.push({
          methodName: row.method_name ?? null,
          statementType,
          sql: methodSqlText,
          namespace: row.mapper_namespace ?? row.mapper_name ?? mapperId,
        });

        (byMapper.get(mapperId)!.methods as Array<Record<string, unknown>>).push({
          name: row.method_name,
          statementType,
          sqlSource,
          sqlText: methodSqlText,
          filePath: row.sql_file_path ?? row.method_file_path ?? null,
        });
      }

      const mappers = Array.from(byMapper.values());
      return this.textResponse({ found: results.length > 0, results, mappers });
    } catch {
      return this.textResponse({ found: false, results: [], mappers: [] });
    }
  }

  private async springFindConfig(args: Record<string, unknown>): Promise<unknown> {
    const query = typeof args.query === 'string' ? args.query : '';
    const key = typeof args.key === 'string' ? args.key : '';
    const limit = typeof args.limit === 'number' ? args.limit : 20;

    if (!this.db) {
      return this.textResponse({ found: false, properties: [] });
    }

    try {
      const tableName = this.tableExists('spring_config_properties')
        ? 'spring_config_properties'
        : 'runtime_config_properties';
      let sql = `
        SELECT key, value_hash, is_sensitive, source_file_path, source_line, bean_id
        FROM ${tableName}
        WHERE 1 = 1
      `;
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (key) {
        conditions.push('key = ?');
        params.push(key);
      }

      if (query) {
        conditions.push('key LIKE ?');
        params.push(`%${query}%`);
      }

      if (conditions.length > 0) {
        sql += ' AND ' + conditions.join(' AND ');
      }

      sql += ' ORDER BY key LIMIT ?';
      params.push(limit);

      const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
      const properties = rows.map((row) => {
        const propertyKey = String(row.key ?? '');
        const sensitive = Boolean(row.is_sensitive) || this.isSensitiveConfigKey(propertyKey);
        return {
          key: propertyKey,
          value: sensitive ? this.maskSensitiveValue(row.value_hash) : row.value_hash,
          sensitive,
          filePath: row.source_file_path ?? null,
          line: row.source_line ?? null,
          beanId: row.bean_id ?? null,
        };
      });

      const definition = properties[0]
        ? {
            key: properties[0].key,
            value: properties[0].value,
            sensitive: properties[0].sensitive,
            filePath: properties[0].filePath,
            line: properties[0].line,
          }
        : {};

      return this.textResponse({
        found: properties.length > 0,
        properties,
        key: key || query,
        definition,
      });
    } catch {
      return this.textResponse({ found: false, properties: [] });
    }
  }

  private async springNacosOverview(_args: Record<string, unknown>): Promise<unknown> {
    if (!this.db) {
      return this.textResponse({
        found: false,
        discoveryServer: null,
        configServer: null,
      });
    }

    try {
      const tableName = this.tableExists('spring_config_properties')
        ? 'spring_config_properties'
        : 'runtime_config_properties';
      const rows = this.db.prepare(`
        SELECT key, value_hash, is_sensitive
        FROM ${tableName}
        WHERE key LIKE '%nacos%'
        ORDER BY key
      `).all() as Array<Record<string, unknown>>;

      const findValue = (matcher: RegExp): string | null => {
        const row = rows.find((item) => matcher.test(String(item.key ?? '')));
        if (!row) return null;
        const propertyKey = String(row.key ?? '');
        const sensitive = Boolean(row.is_sensitive) || this.isSensitiveConfigKey(propertyKey);
        return sensitive ? this.maskSensitiveValue(row.value_hash) : String(row.value_hash ?? '');
      };

      return this.textResponse({
        found: rows.length > 0,
        discoveryServer: findValue(/nacos\.discovery\.server-addr/i),
        configServer: findValue(/nacos\.config\.server-addr/i),
      });
    } catch {
      return this.textResponse({
        found: false,
        discoveryServer: null,
        configServer: null,
      });
    }
  }

  private async springGatewayRoute(args: Record<string, unknown>): Promise<unknown> {
    const limit = typeof args.limit === 'number' ? args.limit : 50;

    if (!this.db) {
      return this.textResponse({ found: false, routes: [] });
    }

    try {
      if (this.tableExists('spring_gateway_routes')) {
        const rows = this.db.prepare(`
          SELECT route_id, uri, predicates, filters, order_val
          FROM spring_gateway_routes
          ORDER BY route_id
          LIMIT ?
        `).all(limit) as Array<Record<string, unknown>>;

        const routes = rows.map((row) => ({
          routeId: row.route_id ?? null,
          uri: row.uri ?? null,
          predicates: row.predicates ?? null,
          filters: row.filters ?? null,
          orderVal: row.order_val ?? null,
        }));

        return this.textResponse({ found: routes.length > 0, routes });
      }

      const rows = this.db.prepare(`
        SELECT id, name, qualified_name, metadata, file_path
        FROM spring_symbols
        WHERE kind = 'gateway_route'
        ORDER BY name
        LIMIT ?
      `).all(limit) as Array<Record<string, unknown>>;

      const routes = rows.map((row) => {
        const metadata = this.parseMetadata(row.metadata);
        return {
          routeId: row.name ?? row.qualified_name ?? row.id,
          uri: metadata.uri ?? null,
          predicates: Array.isArray(metadata.predicates) ? metadata.predicates : [],
          filters: Array.isArray(metadata.filters) ? metadata.filters : [],
          orderVal: metadata.order ?? null,
          id: row.id,
          filePath: row.file_path ?? null,
        };
      });

      return this.textResponse({ found: routes.length > 0, routes });
    } catch {
      return this.textResponse({ found: false, routes: [] });
    }
  }

  private async springSearchFeature(args: Record<string, unknown>): Promise<unknown> {
    const query = typeof args.query === 'string' ? args.query : '';
    const limit = typeof args.limit === 'number' ? args.limit : 20;

    if (!this.db) {
      return this.textResponse({ found: false, communities: [] });
    }

    try {
      const communitiesTable = this.tableExists('spring_feature_communities')
        ? 'spring_feature_communities'
        : 'feature_communities';
      const membersTable = this.tableExists('spring_feature_community_members')
        ? 'spring_feature_community_members'
        : 'feature_community_members';

      const communities = this.db.prepare(`
        SELECT id, label, summary, member_count
        FROM ${communitiesTable}
        WHERE label LIKE ? OR summary LIKE ?
        ORDER BY label
        LIMIT ?
      `).all(`%${query}%`, `%${query}%`, limit) as Array<Record<string, unknown>>;

      const results = communities.map((community) => {
        const members = this.db!.prepare(`
          SELECT s.name, s.qualified_name
          FROM ${membersTable} fcm
          LEFT JOIN spring_symbols s ON s.id = fcm.spring_node_id
          WHERE fcm.community_id = ?
          ORDER BY s.name
        `).all(community.id) as Array<Record<string, unknown>>;

        return {
          name: community.label,
          description: community.summary,
          members: members
            .map((member) => member.name ?? member.qualified_name)
            .filter((member): member is string => typeof member === 'string' && member.length > 0),
        };
      });

      return this.textResponse({ found: results.length > 0, communities: results });
    } catch {
      return this.textResponse({ found: false, communities: [] });
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
