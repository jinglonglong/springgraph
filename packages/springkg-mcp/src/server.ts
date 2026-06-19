/**
 * SpringKG MCP Server
 *
 * A standalone MCP server that exposes SpringKG tools via JSON-RPC over stdio.
 * This server wraps CodeGraph + SpringDatabase and provides 4 tools:
 * - spring_find_entry: Find entry points (controllers with routes)
 * - spring_find_feign: Find Feign clients
 * - spring_assets_overview: Overview of all Spring assets
 * - spring_trace_flow: Trace flow between components
 */

import * as readline from 'readline';
import * as path from 'path';
import * as fs from 'fs';
import { createRequire } from 'module';

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

// Tool definitions
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// SpringKG tools
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
        depth: {
          type: 'number',
          description: 'Maximum depth to trace (default: 5)',
          default: 5,
        },
      },
      required: ['entryId'],
    },
  },
];

/**
 * SpringKG MCP Server
 */
export class SpringKgMcpServer {
  private rl: readline.Interface | null = null;
  private projectPath: string;
  private db: SqliteDatabase | null = null;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  /**
   * Start the MCP server
   */
  start(): void {
    // Open the springkg database
    const dbPath = path.join(this.projectPath, '.codegraph', 'springkg.db');
    if (!fs.existsSync(dbPath)) {
      process.stderr.write(`[springkg-mcp] Database not found: ${dbPath}\n`);
      process.stderr.write('[springkg-mcp] Please run "springkg init" and "springkg index" first.\n');
      // Continue anyway - tools will return empty results
    } else {
      try {
        const { DatabaseSync } = require('node:sqlite');
        this.db = new DatabaseSync(dbPath);
      } catch (err) {
        process.stderr.write(`[springkg-mcp] Failed to open database: ${err}\n`);
      }
    }

    // Set up readline for stdin
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

  /**
   * Stop the MCP server
   */
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

  /**
   * Handle a line of input
   */
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
        // Notification - no response needed
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
        if (isRequest) {
          this.sendError(request.id, -32601, `Method not found: ${request.method}`);
        }
    }
  }

  /**
   * Handle initialize request
   */
  private handleInitialize(request: JsonRpcRequest): void {
    this.sendResult(request.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: {
        name: 'springkg-mcp',
        version: '0.1.0',
      },
      instructions: 'SpringKG MCP server for Spring Cloud code analysis. Use the spring_* tools to query Spring components.',
    });
  }

  /**
   * Handle tools/list request
   */
  private handleToolsList(request: JsonRpcRequest): void {
    this.sendResult(request.id, { tools: SPRINGKG_TOOLS });
  }

  /**
   * Handle tools/call request
   */
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
        case 'spring_assets_overview':
          result = await this.springAssetsOverview(toolArgs);
          break;
        case 'spring_trace_flow':
          result = await this.springTraceFlow(toolArgs);
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

  /**
   * spring_find_entry: Find entry points (controllers with routes)
   */
  private async springFindEntry(args: Record<string, unknown>): Promise<unknown> {
    const query = (args.query as string) || '';
    const limit = (args.limit as number) || 20;

    if (!this.db) {
      return {
        content: [{ type: 'text', text: 'Database not initialized. Please run "springkg init" and "springkg index" first.' }],
      };
    }

    try {
      // Query endpoints from spring_endpoints table
      let sql = `
        SELECT e.*, s.name as handler_name, s.qualified_name as handler_qualified_name
        FROM spring_endpoints e
        LEFT JOIN spring_symbols s ON e.handler_class_id = s.id
      `;
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (query) {
        conditions.push('(e.path LIKE ? OR s.name LIKE ?)');
        params.push(`%${query}%`, `%${query}%`);
      }

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }

      sql += ' ORDER BY e.method, e.path LIMIT ?';
      params.push(limit);

      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params) as Array<Record<string, unknown>>;

      const text = rows.length > 0
        ? rows.map((r) => `${r.method} ${r.path} -> ${r.handler_name || 'unknown'}`).join('\n')
        : 'No entry points found.';

      return {
        content: [{ type: 'text', text }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `Error querying entry points: ${message}` }],
      };
    }
  }

  /**
   * spring_find_feign: Find Feign clients
   */
  private async springFindFeign(args: Record<string, unknown>): Promise<unknown> {
    const query = (args.query as string) || '';
    const limit = (args.limit as number) || 20;

    if (!this.db) {
      return {
        content: [{ type: 'text', text: 'Database not initialized. Please run "springkg init" and "springkg index" first.' }],
      };
    }

    try {
      // Query feign clients from spring_feign_clients table
      let sql = 'SELECT * FROM spring_feign_clients';
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (query) {
        conditions.push('(client_name LIKE ? OR target_service LIKE ?)');
        params.push(`%${query}%`, `%${query}%`);
      }

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }

      sql += ' ORDER BY client_name LIMIT ?';
      params.push(limit);

      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params) as Array<Record<string, unknown>>;

      const text = rows.length > 0
        ? rows.map((r) => `${r.client_name} -> ${r.target_service} (${r.method_count} methods)`).join('\n')
        : 'No Feign clients found.';

      return {
        content: [{ type: 'text', text }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `Error querying Feign clients: ${message}` }],
      };
    }
  }

  /**
   * spring_assets_overview: Overview of all Spring assets
   */
  private async springAssetsOverview(_args: Record<string, unknown>): Promise<unknown> {
    if (!this.db) {
      return {
        content: [{ type: 'text', text: 'Database not initialized. Please run "springkg init" and "springkg index" first.' }],
      };
    }

    try {
      const counts: Record<string, number> = {};

      // Count by kind
      const kinds = [
        'controller', 'service', 'repository', 'component',
        'feign_client', 'feign_method', 'endpoint', 'remote_service',
        'mapper', 'mapper_method', 'sql_statement', 'entity', 'table', 'column',
        'config_property', 'middleware', 'nacos_cluster', 'nacos_config', 'gateway_route',
        'feature_community', 'feature_community_member',
      ];

      for (const kind of kinds) {
        try {
          const stmt = this.db.prepare('SELECT COUNT(*) as count FROM spring_symbols WHERE kind = ?');
          const row = stmt.get(kind) as { count: number } | undefined;
          counts[kind] = row?.count || 0;
        } catch {
          // Table might not exist
          counts[kind] = 0;
        }
      }

      // Count edges
      try {
        const stmt = this.db.prepare('SELECT COUNT(*) as count FROM spring_edges');
        const row = stmt.get() as { count: number } | undefined;
        counts['edges'] = row?.count || 0;
      } catch {
        counts['edges'] = 0;
      }

      const text = Object.entries(counts)
        .filter(([_, count]) => count > 0)
        .map(([kind, count]) => `${kind}: ${count}`)
        .join('\n');

      return {
        content: [{ type: 'text', text: text || 'No Spring assets found.' }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `Error getting assets overview: ${message}` }],
      };
    }
  }

  /**
   * spring_trace_flow: Trace flow from an entry point
   */
  private async springTraceFlow(args: Record<string, unknown>): Promise<unknown> {
    const entryId = args.entryId as string;
    const depth = (args.depth as number) || 5;

    if (!entryId) {
      return {
        content: [{ type: 'text', text: 'entryId is required.' }],
      };
    }

    if (!this.db) {
      return {
        content: [{ type: 'text', text: 'Database not initialized. Please run "springkg init" and "springkg index" first.' }],
      };
    }

    try {
      // BFS to trace the flow
      const visited = new Set<string>();
      const queue: Array<{ id: string; level: number; path: string[] }> = [{ id: entryId, level: 0, path: [entryId] }];
      const flows: string[] = [];

      while (queue.length > 0) {
        const { id, level, path } = queue.shift()!;

        if (level >= depth || visited.has(id)) continue;
        visited.add(id);

        // Get node info
        const nodeStmt = this.db.prepare('SELECT * FROM spring_symbols WHERE id = ?');
        const node = nodeStmt.get(id) as Record<string, unknown> | undefined;

        if (node) {
          flows.push(`${'  '.repeat(level)}${node.kind}: ${node.name || node.qualified_name || id}`);
        }

        // Get outgoing edges
        const edgeStmt = this.db.prepare(
          'SELECT * FROM spring_edges WHERE source_id = ?'
        );
        const edges = edgeStmt.all(id) as Array<Record<string, unknown>>;

        for (const edge of edges) {
          if (!visited.has(edge.target_id as string)) {
            queue.push({
              id: edge.target_id as string,
              level: level + 1,
              path: [...path, edge.target_id as string],
            });
          }
        }
      }

      const text = flows.length > 0
        ? flows.join('\n')
        : `No flow found starting from ${entryId}.`;

      return {
        content: [{ type: 'text', text }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `Error tracing flow: ${message}` }],
      };
    }
  }

  /**
   * Send a JSON-RPC response
   */
  private sendResult(id: string | number, result: unknown): void {
    const response: JsonRpcResponse = { jsonrpc: '2.0', id, result };
    process.stdout.write(JSON.stringify(response) + '\n');
  }

  /**
   * Send a JSON-RPC error
   */
  private sendError(id: string | number | null, code: number, message: string): void {
    const response: JsonRpcResponse = { jsonrpc: '2.0', id, error: { code, message } };
    process.stdout.write(JSON.stringify(response) + '\n');
  }
}

/**
 * Main entry point
 */
export function main(): void {
  const projectPath = process.argv[2] || process.cwd();
  const server = new SpringKgMcpServer(projectPath);
  server.start();
}
