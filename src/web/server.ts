/**
 * CodeGraph Web UI Server
 *
 * Local-only HTTP server that exposes the CodeGraph API over a REST surface and
 * serves the bundled web UI (Cytoscape.js graph viewer) from src/web/public/.
 *
 * Design notes:
 * - Uses Node's built-in `http` module — no extra runtime dependencies.
 * - All routes are JSON except the static file handler, which streams files.
 * - Path resolution happens once at startup; the running CodeGraph instance is
 *   shared across requests (no re-open per call).
 * - Stays bound to localhost by default — the data on disk can include file
 *   paths, docstrings, and source snippets. `--host 0.0.0.0` is opt-in.
 */
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';
import CodeGraphDefault, { type CodeGraph } from '../index';
import { isInitialized } from '../directory';
import { NODE_KINDS, type Node, type Edge } from '../types';

export interface WebServerOptions {
  /** Port to listen on. */
  port: number;
  /** Hostname to bind. Default '127.0.0.1' (localhost only). */
  host?: string;
  /** Absolute path to the static web UI directory (dist/web/public/). */
  publicDir: string;
  /** Open the URL in the user's default browser once the server is up. */
  open?: boolean;
  /** Quiet mode — skip the "listening on" banner (used by tests). */
  silent?: boolean;
}

/**
 * Tiny helpers — kept inline so the web bundle has no runtime deps.
 */
function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function sendError(res: http.ServerResponse, status: number, message: string, code?: string): void {
  sendJson(res, status, { error: message, code });
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > 64 * 1024) throw new Error('Request body too large');
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>;
}

function decodePathSegments(reqUrl: string): { pathname: string; segments: string[] } {
  const parsed = url.parse(reqUrl);
  const pathname = decodeURIComponent(parsed.pathname || '/');
  return { pathname, segments: pathname.split('/').filter(Boolean) };
}

/**
 * Map a NodeKind to a Cytoscape-friendly color. Centralized so the frontend
 * doesn't need to maintain a parallel table.
 */
const KIND_COLORS: Record<string, string> = {
  file: '#6b7280',
  module: '#a78bfa',
  class: '#22d3ee',
  struct: '#22d3ee',
  interface: '#fbbf24',
  trait: '#fbbf24',
  protocol: '#fbbf24',
  function: '#34d399',
  method: '#34d399',
  property: '#f472b6',
  field: '#f472b6',
  variable: '#94a3b8',
  constant: '#fb923c',
  enum: '#c084fc',
  enum_member: '#c084fc',
  type_alias: '#60a5fa',
  namespace: '#a78bfa',
  parameter: '#94a3b8',
  import: '#9ca3af',
  export: '#9ca3af',
  route: '#f87171',
  component: '#facc15',
};

export function nodeColor(kind: string): string {
  return KIND_COLORS[kind] ?? '#cbd5e1';
}

/**
 * Map an EdgeKind to a Cytoscape-friendly color.
 */
const EDGE_COLORS: Record<string, string> = {
  contains: '#475569',
  calls: '#22c55e',
  imports: '#0ea5e9',
  exports: '#0ea5e9',
  extends: '#a855f7',
  implements: '#a855f7',
  references: '#64748b',
  type_of: '#64748b',
  returns: '#64748b',
  instantiates: '#f97316',
  overrides: '#a855f7',
  decorates: '#ec4899',
};

export function edgeColor(kind: string): string {
  return EDGE_COLORS[kind] ?? '#475569';
}

/**
 * Resolve a file under the project root. Returns the absolute path or throws.
 */
function resolveProjectFile(projectRoot: string, relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/');
  const abs = path.resolve(projectRoot, normalized);
  const rootReal = fs.realpathSync(projectRoot);
  let real: string;
  try {
    real = fs.realpathSync(abs);
  } catch {
    throw new Error(`File not found: ${normalized}`);
  }
  if (!real.startsWith(rootReal + path.sep) && real !== rootReal) {
    throw new Error('Path escapes project root');
  }
  return real;
}

function resolveProjectRootFromInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Path is required');
  const resolved = path.resolve(trimmed);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new Error(`Path not found: ${trimmed}`);
  }
  if (!stat.isDirectory()) throw new Error(`Path is not a directory: ${trimmed}`);

  const projectRoot = fs.existsSync(path.join(resolved, 'codegraph.db'))
    ? path.dirname(resolved)
    : resolved;

  if (!isInitialized(projectRoot)) {
    throw new Error(`CodeGraph index not found. Pass a project root or its .codegraph directory: ${trimmed}`);
  }
  return fs.realpathSync(projectRoot);
}

function listFilesystemRoots(): Array<{ name: string; path: string }> {
  if (process.platform === 'win32') {
    const roots: Array<{ name: string; path: string }> = [];
    for (let code = 65; code <= 90; code++) {
      const drive = `${String.fromCharCode(code)}:\\`;
      if (fs.existsSync(drive)) roots.push({ name: drive, path: drive });
    }
    return roots;
  }
  return [{ name: '/', path: '/' }];
}

function listDirectories(currentPath: string): {
  path: string;
  parent: string | null;
  isCodeGraphProject: boolean;
  isCodeGraphDir: boolean;
  entries: Array<{ name: string; path: string; isCodeGraphProject: boolean; isCodeGraphDir: boolean }>;
} {
  const resolved = fs.realpathSync(path.resolve(currentPath));
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) throw new Error(`Path is not a directory: ${currentPath}`);
  const entries = fs.readdirSync(resolved, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const entryPath = path.join(resolved, entry.name);
      const isCodeGraphDir = fs.existsSync(path.join(entryPath, 'codegraph.db'));
      return {
        name: entry.name,
        path: entryPath,
        isCodeGraphProject: isInitialized(entryPath),
        isCodeGraphDir,
      };
    })
    .sort((a, b) => {
      const aIndexed = a.isCodeGraphProject || a.isCodeGraphDir ? 0 : 1;
      const bIndexed = b.isCodeGraphProject || b.isCodeGraphDir ? 0 : 1;
      return aIndexed - bIndexed || a.name.localeCompare(b.name);
    });
  const parent = path.dirname(resolved);
  return {
    path: resolved,
    parent: parent === resolved ? null : parent,
    isCodeGraphProject: isInitialized(resolved),
    isCodeGraphDir: fs.existsSync(path.join(resolved, 'codegraph.db')),
    entries,
  };
}

/**
 * Read a slice of a file, returning `{ content, startLine, endLine, total }`.
 * 1-indexed line numbers (matches the CLI / MCP node output).
 */
function readFileSlice(
  absPath: string,
  offset?: number,
  limit?: number
): { content: string; startLine: number; endLine: number; total: number } {
  const raw = fs.readFileSync(absPath, 'utf-8');
  const lines = raw.split('\n');
  const total = lines.length;
  const startIdx = Math.max(0, (offset ?? 1) - 1);
  const endIdx = Math.min(total, startIdx + (limit ?? total - startIdx));
  const content = lines.slice(startIdx, endIdx).join('\n');
  return { content, startLine: startIdx + 1, endLine: endIdx, total };
}

/**
 * Build a small JSON-safe summary for a node (used by /api/search and the
 * node chips in the graph).
 */
export function summarizeNode(node: Node): Record<string, unknown> {
  return {
    id: node.id,
    name: node.name,
    kind: node.kind,
    filePath: node.filePath,
    qualifiedName: node.qualifiedName,
    startLine: node.startLine,
    endLine: node.endLine,
    signature: node.signature,
    language: node.language,
    color: nodeColor(node.kind),
  };
}

export function summarizeEdge(edge: Edge): Record<string, unknown> {
  return {
    id: `${edge.source}->${edge.target}:${edge.kind}:${edge.line ?? ''}:${edge.column ?? ''}`,
    source: edge.source,
    target: edge.target,
    kind: edge.kind,
    line: edge.line,
    column: edge.column,
    color: edgeColor(edge.kind),
  };
}

/**
 * Convert a Subgraph (Map<id, Node>, Edge[]) into the flat array shape that
 * Cytoscape's elements:{ nodes, edges } expects.
 */
export function subgraphToCytoscape(
  subgraph: { nodes: Map<string, Node>; edges: Edge[] }
): { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } {
  const nodes = Array.from(subgraph.nodes.values()).map((n) => summarizeNode(n));
  const edges = subgraph.edges.map((e) => summarizeEdge(e));
  return { nodes, edges };
}

/**
 * HTTP request handler. Pulls the CodeGraph instance from a closure created in
 * `startWebServer` so we don't serialize the project root on every call.
 */
export function createRequestHandler(
  cg: CodeGraph,
  projectRoot: string,
  publicDir: string
): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  const active = { cg, projectRoot };
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
  };

  const handler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (!req.url) {
      sendError(res, 400, 'Missing URL');
      return;
    }
    const { pathname, segments } = decodePathSegments(req.url);
    const cg = active.cg;
    const projectRoot = active.projectRoot;

    try {
      // ─── Static / index.html ──────────────────────────────────────────────
      if (pathname === '/' || pathname === '/index.html') {
        serveStatic(res, publicDir, 'index.html', mimeTypes);
        return;
      }

      // ─── /api/status ──────────────────────────────────────────────────────
      if (pathname === '/api/status' && req.method === 'GET') {
        const stats = cg.getStats();
        sendJson(res, 200, {
          projectRoot,
          initialized: true,
          lastUpdated: stats.lastUpdated,
          fileCount: stats.fileCount,
          nodeCount: stats.nodeCount,
          edgeCount: stats.edgeCount,
          nodesByKind: stats.nodesByKind,
          edgesByKind: stats.edgesByKind,
          filesByLanguage: stats.filesByLanguage,
          dbSizeBytes: stats.dbSizeBytes,
        });
        return;
      }

      // ─── /api/overview?limit=80 ───────────────────────────────────────────
      // Density-ordered symbol graph: pick high-connectivity nodes + their
      // one-hop neighbourhood so the default view shows a real connected graph.
      if (pathname === '/api/overview' && req.method === 'GET') {
        const parsed = url.parse(req.url, true);
        const limit = Math.min(Math.max(parseInt((parsed.query.limit as string) || '80', 10) || 80, 1), 200);
        const { nodes: selected, edges } = buildOverviewGraph(cg, limit);
        sendJson(res, 200, {
          root: null,
          depth: 0,
          direction: 'overview',
          nodeCount: selected.length,
          edgeCount: edges.length,
          nodes: selected.map(summarizeNode),
          edges: edges.map(summarizeEdge),
        });
        return;
      }

      // ─── /api/search?q=...&limit=...&kind=...&decorator=... ───────────────
      if (pathname === '/api/search' && req.method === 'GET') {
        const parsed = url.parse(req.url, true);
        const q = (parsed.query.q as string | undefined)?.trim();
        if (!q) {
          sendError(res, 400, 'Missing q parameter', 'missing_q');
          return;
        }
        const limit = Math.min(parseInt((parsed.query.limit as string) || '25', 10) || 25, 200);
        const kind = parsed.query.kind as string | undefined;
        // `decorator` is comma-separated (e.g. `?decorator=Service,Controller`)
        // so the UI can stack multiple chips in one round-trip if it ever
        // needs to. Today the UI sends one at a time, but a CSV keeps the
        // door open.
        const decoratorParam = parsed.query.decorator as string | undefined;
        const decorators = decoratorParam
          ? decoratorParam.split(',').map((s) => s.trim()).filter(Boolean)
          : undefined;
        const results = cg.searchNodes(q, {
          limit,
          kinds: kind ? [kind as Node['kind']] : undefined,
          decorators,
        });
        sendJson(res, 200, {
          query: q,
          count: results.length,
          results: results.map((r) => ({
            score: r.score,
            node: summarizeNode(r.node),
            highlights: r.highlights ?? [],
          })),
        });
        return;
      }

      // ─── /api/node/<id> ───────────────────────────────────────────────────
      if (segments[0] === 'api' && segments[1] === 'node' && segments[2] && req.method === 'GET') {
        const id = segments.slice(2).join('/');
        const node = cg.getNode(id);
        if (!node) {
          sendError(res, 404, `Node not found: ${id}`, 'node_not_found');
          return;
        }
        const context = cg.getContext(id);
        // Read source slice for the node — synchronous because the file is
        // small (a function/method). async getCode returns the same.
        let code: string | null = null;
        try {
          const real = resolveProjectFile(projectRoot, node.filePath);
          code = readFileSlice(real, node.startLine, node.endLine - node.startLine + 1).content;
        } catch {
          code = null;
        }
        sendJson(res, 200, {
          node: summarizeNode(node),
          code,
          callers: context.incomingRefs.map(({ node: n, edge }) => ({
            node: summarizeNode(n),
            edge: summarizeEdge(edge),
          })),
          callees: context.outgoingRefs.map(({ node: n, edge }) => ({
            node: summarizeNode(n),
            edge: summarizeEdge(edge),
          })),
          ancestors: context.ancestors.map(summarizeNode),
          children: context.children.map(summarizeNode),
        });
        return;
      }

      // ─── /api/context/<id>?depth=2&direction=both&edgeKinds=calls,imports ──
      if (segments[0] === 'api' && segments[1] === 'context' && segments[2] && req.method === 'GET') {
        const id = segments.slice(2).join('/');
        const node = cg.getNode(id);
        if (!node) {
          sendError(res, 404, `Node not found: ${id}`, 'node_not_found');
          return;
        }
        const parsed = url.parse(req.url, true);
        const depth = Math.min(Math.max(parseInt((parsed.query.depth as string) || '2', 10) || 2, 1), 5);
        const direction = (parsed.query.direction as 'outgoing' | 'incoming' | 'both' | undefined) || 'both';
        const edgeKindsParam = parsed.query.edgeKinds as string | undefined;
        const edgeKinds = edgeKindsParam
          ? (edgeKindsParam.split(',').map((s) => s.trim()) as Edge['kind'][])
          : undefined;
        const subgraph = cg.traverse(id, {
          maxDepth: depth,
          direction,
          edgeKinds,
          includeStart: true,
        });
        const elements = subgraphToCytoscape(subgraph);
        const MAX_CONTEXT_NODES = 1500;
        const MAX_CONTEXT_EDGES = 3000;
        const originalNodeCount = elements.nodes.length;
        const originalEdgeCount = elements.edges.length;
        const truncated = originalNodeCount > MAX_CONTEXT_NODES || originalEdgeCount > MAX_CONTEXT_EDGES;
        if (elements.nodes.length > MAX_CONTEXT_NODES) elements.nodes = elements.nodes.slice(0, MAX_CONTEXT_NODES);
        if (elements.edges.length > MAX_CONTEXT_EDGES) elements.edges = elements.edges.slice(0, MAX_CONTEXT_EDGES);
        const truncationNotice = truncated
          ? `Context truncated: showing ${elements.nodes.length}/${originalNodeCount} nodes and ${elements.edges.length}/${originalEdgeCount} edges`
          : undefined;
        sendJson(res, 200, {
          root: id,
          depth,
          direction,
          nodeCount: elements.nodes.length,
          edgeCount: elements.edges.length,
          truncated,
          truncationNotice,
          nodes: elements.nodes,
          edges: elements.edges,
        });
        return;
      }

      // ─── /api/file?path=...&offset=...&limit=... ───────────────────────────
      if (pathname === '/api/file' && req.method === 'GET') {
        const parsed = url.parse(req.url, true);
        const rel = (parsed.query.path as string | undefined)?.trim();
        if (!rel) {
          sendError(res, 400, 'Missing path parameter', 'missing_path');
          return;
        }
        const offset = parsed.query.offset ? parseInt(parsed.query.offset as string, 10) : undefined;
        const limit = parsed.query.limit ? parseInt(parsed.query.limit as string, 10) : undefined;
        try {
          const real = resolveProjectFile(projectRoot, rel);
          const slice = readFileSlice(real, offset, limit);
          sendJson(res, 200, {
            path: rel.replace(/\\/g, '/'),
            startLine: slice.startLine,
            endLine: slice.endLine,
            total: slice.total,
            content: slice.content,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          sendError(res, msg.includes('escapes') ? 403 : 404, msg, 'file_error');
        }
        return;
      }

      // ─── /api/kinds ───────────────────────────────────────────────────────
      if (pathname === '/api/kinds' && req.method === 'GET') {
        sendJson(res, 200, {
          nodeKinds: Object.keys(KIND_COLORS),
          edgeKinds: Object.keys(EDGE_COLORS),
          nodeKindColors: KIND_COLORS,
          edgeKindColors: EDGE_COLORS,
        });
        return;
      }

      // ─── /api/decorators?limit=60 ─────────────────────────────────────────
      // Aggregate distinct decorator strings + occurrence counts across every
      // node with decorators. Stored as JSON arrays in SQLite; the
      // `CodeGraph.getDecorators()` helper walks the column once and tallies
      // in-memory. Cap the result list to keep the UI responsive on huge repos.
      if (pathname === '/api/decorators' && req.method === 'GET') {
        const parsed = url.parse(req.url, true);
        const limit = Math.min(
          Math.max(parseInt((parsed.query.limit as string) || '60', 10) || 60, 1),
          500
        );
        const decorators = cg.getDecorators(limit);
        sendJson(res, 200, { count: decorators.length, decorators });
        return;
      }

      // ─── /api/health ──────────────────────────────────────────────────────
      if (pathname === '/api/health' && req.method === 'GET') {
        sendJson(res, 200, { ok: true });
        return;
      }

      // ─── /api/browse?path=... ─────────────────────────────────────────────
      // Local directory browser for choosing a project root or .codegraph dir.
      if (pathname === '/api/browse' && req.method === 'GET') {
        const parsed = url.parse(req.url, true);
        const requestedPath = (parsed.query.path as string | undefined)?.trim();
        if (requestedPath === '__roots__') {
          sendJson(res, 200, { roots: listFilesystemRoots() });
          return;
        }
        try {
          sendJson(res, 200, listDirectories(requestedPath || projectRoot));
        } catch (err) {
          sendError(res, 400, err instanceof Error ? err.message : String(err), 'browse_failed');
        }
        return;
      }

      // ─── /api/project ─────────────────────────────────────────────────────
      // Switch to another local CodeGraph index. Accepts either a project root
      // or that project's .codegraph directory.
      if (pathname === '/api/project' && req.method === 'POST') {
        let body: Record<string, unknown>;
        try {
          body = await readJsonBody(req);
        } catch (err) {
          sendError(res, 400, err instanceof Error ? err.message : String(err), 'invalid_json');
          return;
        }
        const requestedPath = typeof body.path === 'string' ? body.path : '';
        try {
          const nextRoot = resolveProjectRootFromInput(requestedPath);
          const next = await CodeGraphDefault.open(nextRoot);
          const previous = active.cg;
          active.cg = next;
          active.projectRoot = next.getProjectRoot();
          if (previous !== next) previous.close();
          const stats = next.getStats();
          sendJson(res, 200, {
            projectRoot: active.projectRoot,
            fileCount: stats.fileCount,
            nodeCount: stats.nodeCount,
            edgeCount: stats.edgeCount,
          });
        } catch (err) {
          sendError(res, 400, err instanceof Error ? err.message : String(err), 'project_switch_failed');
        }
        return;
      }

      // ─── Static file fallback (anything not /api/*) ───────────────────────
      if (segments[0] !== 'api') {
        const requested = segments.join('/');
        // Block path-traversal in the URL itself.
        if (requested.includes('..')) {
          sendError(res, 400, 'Invalid path');
          return;
        }
        const served = serveStatic(res, publicDir, requested, mimeTypes);
        if (!served) {
          sendError(res, 404, 'Not found');
        }
        return;
      }

      sendError(res, 404, `Unknown API route: ${pathname}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendError(res, 500, msg);
    }
  };
  (handler as typeof handler & { getActiveCodeGraph: () => CodeGraph }).getActiveCodeGraph = () => active.cg;
  return handler;
}

function buildOverviewGraph(cg: CodeGraph, limit: number): { nodes: Node[]; edges: Edge[] } {
  // Cap candidate collection per kind to avoid materializing millions of nodes.
  const candidateKinds = NODE_KINDS.filter((kind) => !['file', 'import', 'export', 'parameter'].includes(kind));
  const PER_KIND_CAP = 500;
  const candidates: Node[] = [];
  for (const kind of candidateKinds) {
    candidates.push(...cg.getNodesByKind(kind).slice(0, PER_KIND_CAP));
    if (candidates.length >= limit * 5) break; // Don't collect more than 5× what's needed.
  }

  // Score by node kind priority (cheap heuristic, no DB hit).
  const priority: Partial<Record<Node['kind'], number>> = {
    route: 10, component: 10, class: 8, interface: 8, struct: 8,
    trait: 8, protocol: 8, function: 6, method: 5, type_alias: 4, constant: 4,
  };
  const topCandidates = candidates
    .sort((a, b) => (priority[b.kind] ?? 0) - (priority[a.kind] ?? 0))
    .slice(0, limit);

  // Single batch query for ALL edges touching top candidates.
  const topIds = topCandidates.map((n) => n.id);
  const allEdges = cg.getEdgesForNodes(topIds);

  // Group edges by node for quick lookup.
  const edgesByNode = new Map<string, Edge[]>();
  for (const edge of allEdges) {
    if (!edgesByNode.has(edge.source)) edgesByNode.set(edge.source, []);
    if (!edgesByNode.has(edge.target)) edgesByNode.set(edge.target, []);
    edgesByNode.get(edge.source)!.push(edge);
    edgesByNode.get(edge.target)!.push(edge);
  }

  // Score by connectivity within the candidate set.
  const scored = topCandidates.map((node) => {
    const edges = edgesByNode.get(node.id) ?? [];
    const meaningful = edges.filter((e) => e.kind !== 'contains');
    return { node, score: meaningful.length * 10 + edges.length };
  });
  scored.sort((a, b) => b.score - a.score || a.node.filePath.localeCompare(b.node.filePath));

  // Pick top nodes + their immediate neighbors (still within edge batch).
  const selected = new Map<string, Node>();
  const edgeMap = new Map<string, Edge>();
  const addEdgeIfConnected = (edge: Edge): void => {
    if (!selected.has(edge.source) || !selected.has(edge.target)) return;
    const key = `${edge.source}->${edge.target}:${edge.kind}:${edge.line ?? ''}:${edge.column ?? ''}`;
    edgeMap.set(key, edge);
  };

  for (const { node } of scored) {
    if (selected.size >= limit) break;
    selected.set(node.id, node);
    const edges = edgesByNode.get(node.id) ?? [];
    // Prefer meaningful edges for expansion.
    edges.sort((a, b) => Number(a.kind === 'contains') - Number(b.kind === 'contains'));
    for (const edge of edges) {
      const otherId = edge.source === node.id ? edge.target : edge.source;
      if (otherId === node.id) continue;
      const other = cg.getNode(otherId);
      if (other && !selected.has(other.id) && selected.size < limit) {
        selected.set(other.id, other);
      }
      addEdgeIfConnected(edge);
    }
  }

  // Fallback for tiny/edge-less indexes.
  if (selected.size === 0) {
    for (const node of topCandidates) {
      selected.set(node.id, node);
      if (selected.size >= limit) break;
    }
  }

  return { nodes: Array.from(selected.values()), edges: Array.from(edgeMap.values()) };
}

/**
 * Stream a static file. Returns false if no candidate was found (no route
 * handled the request — caller decides what to do).
 */
function serveStatic(
  res: http.ServerResponse,
  publicDir: string,
  requested: string,
  mimeTypes: Record<string, string>
): boolean {
  const candidates = [
    path.join(publicDir, requested),
    // SPA fallback: any unknown path serves index.html so client-side routing
    // could be added later without 404s during dev.
  ];
  for (const candidate of candidates) {
    if (!candidate.startsWith(publicDir)) continue;
    if (!fs.existsSync(candidate)) continue;
    const stat = fs.statSync(candidate);
    if (!stat.isFile()) continue;
    const ext = path.extname(candidate).toLowerCase();
    const mime = mimeTypes[ext] || 'application/octet-stream';
    const stream = fs.createReadStream(candidate);
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
    });
    stream.pipe(res);
    return true;
  }
  return false;
}

/**
 * Start the HTTP server bound to the given CodeGraph instance. Returns a
 * promise that resolves once the listener is ready, and a `close()` handle for
 * graceful shutdown.
 */
export async function startWebServer(
  cg: CodeGraph,
  options: WebServerOptions
): Promise<{ server: http.Server; url: string; close: () => Promise<void> }> {
  const projectRoot = cg.getProjectRoot();
  if (!fs.existsSync(options.publicDir)) {
    throw new Error(
      `Web UI assets not found at ${options.publicDir}. ` +
        'Did the build copy them? Try `npm run build`.'
    );
  }

  const handler = createRequestHandler(cg, projectRoot, options.publicDir);
  const server = http.createServer(handler);

  const host = options.host ?? '127.0.0.1';
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : options.port;
  const serverUrl = `http://${host === '0.0.0.0' ? 'localhost' : host}:${actualPort}`;

  if (!options.silent) {
    const banner = [
      '',
      '  ┌──────────────────────────────────────────────────────────┐',
      `  │  CodeGraph Web UI  →  ${serverUrl.padEnd(35)}│`,
      '  │  Press Ctrl+C to stop                                   │',
      '  └──────────────────────────────────────────────────────────┘',
      '',
    ].join('\n');
    process.stdout.write(banner + '\n');
  }

  if (options.open) {
    openInBrowser(serverUrl).catch(() => {
      // Best-effort — never fail the server because the OS refused to launch.
    });
  }

  const close = (): Promise<void> =>
    new Promise((resolve) => {
      server.close(() => {
        const activeCg = (handler as typeof handler & { getActiveCodeGraph?: () => CodeGraph }).getActiveCodeGraph?.() ?? cg;
        try { activeCg.close(); } catch { /* already closed */ }
        resolve();
      });
    });

  return { server, url: serverUrl, close };
}

/**
 * Best-effort browser launch. Node 20+ ships `child_process.execFile`; we use
 * the OS-appropriate command. Failure here is non-fatal.
 */
async function openInBrowser(targetUrl: string): Promise<void> {
  const { execFile } = await import('child_process');
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args =
    process.platform === 'win32' ? ['/c', 'start', '""', targetUrl] : [targetUrl];
  await new Promise<void>((resolve) => {
    execFile(cmd, args, () => resolve());
    // Don't reject on error — the server is already up.
    setTimeout(resolve, 1500);
  });
}
