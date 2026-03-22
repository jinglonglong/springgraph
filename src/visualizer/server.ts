/**
 * CodeGraph Visualizer Server
 *
 * Lightweight HTTP server that serves the graph visualization UI
 * and exposes REST API endpoints for querying the CodeGraph database.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';
import { execFile } from 'child_process';
import type CodeGraph from '../index';
import type { Node, Edge, NodeKind } from '../types';

export interface VisualizerOptions {
  /** Port to listen on (0 = auto-assign) */
  port?: number;
  /** Whether to open browser automatically */
  openBrowser?: boolean;
  /** Host to bind to */
  host?: string;
}

/**
 * Serialize a Subgraph (which uses Map) to plain JSON
 */
function serializeSubgraph(subgraph: { nodes: Map<string, Node>; edges: Edge[]; roots: string[] }) {
  return {
    nodes: Array.from(subgraph.nodes.values()),
    edges: subgraph.edges,
    roots: subgraph.roots,
  };
}

export class VisualizerServer {
  private cg: CodeGraph;
  private server: http.Server | null = null;
  private projectRoot: string;
  private symbolIndexCache: string | null = null;
  private claudeAvailable: boolean | null = null;

  constructor(cg: CodeGraph) {
    this.cg = cg;
    this.projectRoot = cg.getProjectRoot();
  }

  /**
   * Build a compact symbol index string for Claude prompts
   */
  private buildSymbolIndex(): string {
    if (this.symbolIndexCache) return this.symbolIndexCache;

    const validKinds: NodeKind[] = ['function', 'method', 'class', 'interface', 'component', 'route', 'enum', 'type_alias'];
    const byFile = new Map<string, string[]>();

    for (const kind of validKinds) {
      for (const node of this.cg.getNodesByKind(kind)) {
        const symbols = byFile.get(node.filePath) || [];
        symbols.push(`${node.kind}:${node.name}`);
        byFile.set(node.filePath, symbols);
      }
    }

    const lines: string[] = [];
    for (const [file, symbols] of byFile) {
      lines.push(`${file}: ${symbols.join(', ')}`);
    }

    this.symbolIndexCache = lines.join('\n');
    return this.symbolIndexCache;
  }

  /**
   * Ask Claude CLI to interpret a natural language question into relevant symbol names
   */
  private async askClaude(question: string): Promise<string[] | null> {
    // Check if claude is available (cache result)
    if (this.claudeAvailable === false) return null;

    const symbolIndex = this.buildSymbolIndex();

    const prompt = `You are analyzing a codebase to help a developer visually trace a code flow. Given the question and symbol index below, identify the entry point and the key symbols in the flow.

IMPORTANT: Return ONLY a JSON object with this exact format. No explanation, no markdown, no code fences.
{"entry": "symbolName", "flow": ["symbol1", "symbol2", "symbol3", ...]}

- "entry" is THE single starting point the user would trigger (e.g., a page component, route handler, button click handler)
- "flow" is the symbols in rough execution order, starting from the entry point (max 8-10 symbols)
- Include the entry point in the flow array too

Example: {"entry": "LoginPage", "flow": ["LoginPage", "handleSubmit", "authenticateUser", "createSession", "redirect"]}

Question: "${question}"

Symbol index (format: file: kind:name, ...):
${symbolIndex}`;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(null);
      }, 30000);

      execFile('claude', ['-p', prompt, '--output-format', 'text'], {
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      }, (err, stdout) => {
        clearTimeout(timeout);

        if (err) {
          this.claudeAvailable = false;
          resolve(null);
          return;
        }

        this.claudeAvailable = true;

        // Parse Claude's response — try object format first, then array fallback
        try {
          const text = stdout.trim();
          // Try to extract JSON object {"entry": ..., "flow": [...]}
          const objMatch = text.match(/\{[\s\S]*\}/);
          if (objMatch) {
            const parsed = JSON.parse(objMatch[0]) as { entry?: string; flow?: string[] };
            if (parsed.flow && Array.isArray(parsed.flow) && parsed.flow.length > 0) {
              // Return flow with entry first
              const names = parsed.flow.map(String);
              if (parsed.entry && !names.includes(parsed.entry)) {
                names.unshift(String(parsed.entry));
              }
              resolve(names);
              return;
            }
          }
          // Fallback: try JSON array
          const arrMatch = text.match(/\[[\s\S]*\]/);
          if (arrMatch) {
            const names = JSON.parse(arrMatch[0]) as string[];
            if (Array.isArray(names) && names.length > 0) {
              resolve(names.map(String));
              return;
            }
          }
        } catch {
          // Parse failed
        }

        resolve(null);
      });
    });
  }

  /**
   * Start the visualizer server
   */
  async start(options: VisualizerOptions = {}): Promise<{ port: number; url: string }> {
    const host = options.host || '127.0.0.1';
    const port = options.port || 0;

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((err) => {
        console.error('[Visualizer] Request error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      });
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(port, host, () => {
        const addr = this.server!.address();
        if (!addr || typeof addr === 'string') {
          reject(new Error('Failed to get server address'));
          return;
        }
        const serverUrl = `http://${host}:${addr.port}`;
        resolve({ port: addr.port, url: serverUrl });
      });

      this.server!.on('error', reject);
    });
  }

  /**
   * Stop the server
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const parsedUrl = url.parse(req.url || '/', true);
    const pathname = parsedUrl.pathname || '/';

    // CORS headers for local development
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // API routes
    if (pathname.startsWith('/api/')) {
      return this.handleAPI(pathname, parsedUrl.query as Record<string, string>, res);
    }

    // Static file serving
    return this.serveStatic(pathname, res);
  }

  private async handleAPI(
    pathname: string,
    query: Record<string, string>,
    res: http.ServerResponse
  ): Promise<void> {
    const json = (data: unknown, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    try {
      // GET /api/status
      if (pathname === '/api/status') {
        const stats = this.cg.getStats();
        json({ stats, projectRoot: this.projectRoot, projectName: path.basename(this.projectRoot) });
        return;
      }

      // GET /api/embeddings/status
      if (pathname === '/api/embeddings/status') {
        const config = this.cg.getConfig();
        const embeddingStats = this.cg.getEmbeddingStats();
        const isEnabled = config.enableEmbeddings === true;
        const isInitialized = this.cg.isEmbeddingsInitialized();
        const totalVectors = embeddingStats?.totalVectors ?? 0;
        const stats = this.cg.getStats();
        // Consider ready if we have vectors for at least half the eligible nodes
        const eligibleNodes = stats.nodeCount - (stats.nodesByKind.file ?? 0) - (stats.nodesByKind.import ?? 0);
        const isReady = isEnabled && totalVectors > 0 && totalVectors >= eligibleNodes * 0.5;
        json({ isEnabled, isInitialized, isReady, totalVectors, eligibleNodes });
        return;
      }

      // GET /api/embeddings/generate — SSE stream that enables, initializes, and generates embeddings
      if (pathname === '/api/embeddings/generate') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });

        const send = (event: string, data: unknown) => {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        try {
          // Step 1: Enable embeddings in config
          send('status', { phase: 'config', message: 'Enabling embeddings...' });
          const config = this.cg.getConfig();
          if (!config.enableEmbeddings) {
            this.cg.updateConfig({ enableEmbeddings: true });
          }

          // Step 2: Initialize embedding model (downloads on first use)
          send('status', { phase: 'model', message: 'Loading embedding model (first time may download ~30MB)...' });
          await this.cg.initializeEmbeddings();
          send('status', { phase: 'model', message: 'Embedding model ready' });

          // Step 3: Generate embeddings with progress
          send('status', { phase: 'embedding', message: 'Generating embeddings...' });
          const count = await this.cg.generateEmbeddings((progress) => {
            send('progress', {
              current: progress.current,
              total: progress.total,
              nodeName: progress.nodeName,
              percent: progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0,
            });
          });

          send('complete', { totalEmbedded: count, message: `Generated ${count} embeddings` });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          send('error', { message });
        }

        res.end();
        return;
      }

      // GET /api/search?q=...&kind=...&limit=...
      if (pathname === '/api/search') {
        const q = query.q || '';
        const kind = query.kind as NodeKind | undefined;
        const limit = parseInt(query.limit || '30', 10);
        if (!q) {
          json({ results: [] });
          return;
        }
        const results = this.cg.searchNodes(q, { kinds: kind ? [kind] : undefined, limit });
        json({ results });
        return;
      }

      // GET /api/explore?q=...&maxNodes=...
      // Natural language question → semantic or keyword-based subgraph
      if (pathname === '/api/explore') {
        const q = query.q || '';
        const maxNodes = parseInt(query.maxNodes || '30', 10);
        if (!q) {
          json({ nodes: [], edges: [], roots: [] });
          return;
        }

        // Extract keywords and stems for relevance scoring (used by all paths)
        const stopWords = new Set(['how', 'does', 'what', 'the', 'is', 'a', 'an', 'and', 'or', 'in', 'to', 'for', 'of', 'with', 'when', 'do', 'it', 'my', 'work', 'works', 'about']);
        const keywords = q.toLowerCase()
          .split(/\s+/)
          .map(w => w.replace(/[^a-z0-9]/g, ''))
          .filter(w => w.length >= 2 && !stopWords.has(w));

        const stems = keywords.map(kw => kw.length > 5 ? kw.slice(0, Math.max(4, Math.ceil(kw.length * 0.5))) : kw);
        const uniqueStems = [...new Set(stems)];

        const _isRelevant = (node: Node): boolean => {
          const haystack = `${node.name} ${node.filePath} ${node.qualifiedName}`.toLowerCase();
          return uniqueStems.some(stem => haystack.includes(stem));
        };
        void _isRelevant; // Used by keyword fallback when Claude is unavailable

        // Step 1: Find seed nodes
        const seedMap = new Map<string, Node>();
        const validKinds: NodeKind[] = ['function', 'method', 'class', 'interface', 'component', 'route'];
        let usedClaude = false;

        // Try Claude CLI first for intelligent query interpretation
        let entryNodeId: string | null = null;
        const claudeNames = await this.askClaude(q);
        if (claudeNames && claudeNames.length > 0) {
          usedClaude = true;
          for (const name of claudeNames) {
            const results = this.cg.searchNodes(name, { kinds: validKinds, limit: 3 });
            for (const r of results) {
              // Only add if the name is a close match
              if (r.node.name.toLowerCase().includes(name.toLowerCase()) ||
                  name.toLowerCase().includes(r.node.name.toLowerCase())) {
                seedMap.set(r.node.id, r.node);
                // First match of first name = entry point
                if (!entryNodeId && name === claudeNames[0]) {
                  entryNodeId = r.node.id;
                }
              }
            }
          }
        }

        // Keyword fallback if Claude unavailable or returned nothing useful
        if (seedMap.size < 3) {
          for (const kw of keywords) {
            const kwResults = this.cg.searchNodes(kw, { kinds: validKinds, limit: 10 });
            for (const r of kwResults) {
              seedMap.set(r.node.id, r.node);
            }
          }
          const fullResults = this.cg.searchNodes(q, { kinds: validKinds, limit: 10 });
          for (const r of fullResults) {
            seedMap.set(r.node.id, r.node);
          }
        }

        if (seedMap.size === 0) {
          const broad = this.cg.searchNodes(q, { limit: 10 });
          for (const r of broad) seedMap.set(r.node.id, r.node);
        }

        if (seedMap.size === 0) {
          json({ nodes: [], edges: [], roots: [] });
          return;
        }

        const rootIds = Array.from(seedMap.keys());
        const nodeMap = new Map<string, Node>(seedMap);
        const edgeList: Edge[] = [];
        const edgeSet = new Set<string>();

        const addEdge = (edge: Edge) => {
          const ek = `${edge.source}-${edge.kind}-${edge.target}`;
          if (!edgeSet.has(ek)) { edgeSet.add(ek); edgeList.push(edge); }
        };

        // Step 2: Find edges between seeds (trust Claude's picks)
        // Only add non-seed nodes if they bridge two seeds
        for (const [seedId] of seedMap) {
          // Check if this seed directly connects to another seed
          const callees = this.cg.getCallees(seedId, 1);
          const callers = this.cg.getCallers(seedId, 1);
          for (const item of [...callees, ...callers]) {
            if (seedMap.has(item.node.id)) {
              addEdge(item.edge);
            }
          }
        }

        // Step 3: Bridge pass — for isolated seeds, find shared callees
        // that connect them to other seeds or to each other
        const connectedAfterDirect = new Set<string>();
        for (const e of edgeList) {
          connectedAfterDirect.add(e.source);
          connectedAfterDirect.add(e.target);
        }

        const isolatedSeeds = Array.from(seedMap.keys()).filter(id => !connectedAfterDirect.has(id));

        // Collect all callees/callers of isolated seeds to find bridges
        const bridgeCandidates = new Map<string, { node: Node; connectedSeeds: Set<string>; edges: Edge[] }>();
        for (const seedId of isolatedSeeds) {
          const callees = this.cg.getCallees(seedId, 1);
          const callers = this.cg.getCallers(seedId, 1);
          for (const item of [...callees, ...callers]) {
            const candidate = bridgeCandidates.get(item.node.id);
            if (candidate) {
              candidate.connectedSeeds.add(seedId);
              candidate.edges.push(item.edge);
            } else {
              bridgeCandidates.set(item.node.id, {
                node: item.node,
                connectedSeeds: new Set([seedId]),
                edges: [item.edge],
              });
            }
          }
        }

        // Add bridges that connect 2+ seeds, or connect an isolated seed to a connected one
        for (const [bridgeId, { node: bridgeNode, connectedSeeds, edges }] of bridgeCandidates) {
          const connectsToGraph = connectedAfterDirect.has(bridgeId) || seedMap.has(bridgeId);
          const connectsMultiple = connectedSeeds.size >= 2;

          if ((connectsMultiple || connectsToGraph) && nodeMap.size < maxNodes) {
            nodeMap.set(bridgeId, bridgeNode);
            for (const edge of edges) addEdge(edge);
          }
        }

        // Step 4: Cross-connection pass — find edges between all result nodes
        for (const [nodeId] of nodeMap) {
          const callers = this.cg.getCallers(nodeId, 1);
          const callees = this.cg.getCallees(nodeId, 1);
          for (const item of [...callers, ...callees]) {
            if (nodeMap.has(item.node.id)) {
              addEdge(item.edge);
            }
          }
        }

        // Step 5: Filter and clean up
        const finalEdges = edgeList.filter(e => nodeMap.has(e.source) && nodeMap.has(e.target));

        const connectedIds = new Set<string>();
        for (const e of finalEdges) {
          connectedIds.add(e.source);
          connectedIds.add(e.target);
        }
        for (const id of rootIds) connectedIds.add(id);

        const finalNodes = Array.from(nodeMap.values()).filter(n => connectedIds.has(n.id));

        json({ nodes: finalNodes, edges: finalEdges, roots: rootIds, entryPoint: entryNodeId, usedClaude });
        return;
      }

      // GET /api/overview?limit=...
      if (pathname === '/api/overview') {
        const limit = parseInt(query.limit || '50', 10);
        // Get top-level exported classes, functions, components
        const kinds: NodeKind[] = ['class', 'function', 'interface', 'component', 'enum', 'type_alias'];
        const nodes: Node[] = [];
        for (const kind of kinds) {
          const kindNodes = this.cg.getNodesByKind(kind);
          for (const n of kindNodes) {
            if (n.isExported || n.kind === 'class' || n.kind === 'component') {
              nodes.push(n);
            }
            if (nodes.length >= limit) break;
          }
          if (nodes.length >= limit) break;
        }
        json({ nodes });
        return;
      }

      // GET /api/files
      if (pathname === '/api/files') {
        const files = this.cg.getFiles();
        json({ files });
        return;
      }

      // Routes with node ID: /api/node/<id>/...
      const nodeMatch = pathname.match(/^\/api\/node\/([^/]+)(\/.*)?$/);
      if (nodeMatch) {
        const nodeId = decodeURIComponent(nodeMatch[1]!);
        const sub = nodeMatch[2] || '';

        // GET /api/node/<id>
        if (!sub || sub === '/') {
          const node = this.cg.getNode(nodeId);
          if (!node) {
            json({ error: 'Node not found' }, 404);
            return;
          }
          const code = await this.cg.getCode(nodeId);
          const ancestors = this.cg.getAncestors(nodeId);
          json({ node, code, ancestors });
          return;
        }

        // GET /api/node/<id>/callers?depth=...
        if (sub === '/callers') {
          const depth = parseInt(query.depth || '1', 10);
          const items = this.cg.getCallers(nodeId, depth);
          json({ items });
          return;
        }

        // GET /api/node/<id>/callees?depth=...
        if (sub === '/callees') {
          const depth = parseInt(query.depth || '1', 10);
          const items = this.cg.getCallees(nodeId, depth);
          json({ items });
          return;
        }

        // GET /api/node/<id>/children
        if (sub === '/children') {
          const children = this.cg.getChildren(nodeId);
          json({ children });
          return;
        }

        // GET /api/node/<id>/impact?depth=...
        if (sub === '/impact') {
          const depth = parseInt(query.depth || '2', 10);
          const subgraph = this.cg.getImpactRadius(nodeId, depth);
          json(serializeSubgraph(subgraph));
          return;
        }

        // GET /api/node/<id>/callgraph?depth=...
        if (sub === '/callgraph') {
          const depth = parseInt(query.depth || '2', 10);
          const subgraph = this.cg.getCallGraph(nodeId, depth);
          json(serializeSubgraph(subgraph));
          return;
        }

        // GET /api/node/<id>/context
        if (sub === '/context') {
          const context = this.cg.getContext(nodeId);
          json({ context });
          return;
        }

        json({ error: 'Unknown endpoint' }, 404);
        return;
      }

      // GET /api/file-nodes?path=...
      if (pathname === '/api/file-nodes') {
        const filePath = query.path || '';
        if (!filePath) {
          json({ error: 'path parameter required' }, 400);
          return;
        }
        const nodes = this.cg.getNodesInFile(filePath);
        json({ nodes });
        return;
      }

      json({ error: 'Unknown API endpoint' }, 404);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      json({ error: message }, 500);
    }
  }

  private serveStatic(pathname: string, res: http.ServerResponse): void {
    if (pathname === '/' || pathname === '/index.html') {
      pathname = '/index.html';
    }

    // Resolve from the public directory next to this file
    const publicDir = path.join(__dirname, 'public');
    const filePath = path.join(publicDir, pathname);

    // Security: prevent directory traversal
    if (!filePath.startsWith(publicDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
    };

    try {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(content);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  }
}
