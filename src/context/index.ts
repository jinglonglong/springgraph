/**
 * Context Builder
 *
 * Builds rich context for tasks by combining semantic search with graph traversal.
 * Outputs structured context ready to inject into Claude.
 */

import * as fs from 'fs';
import {
  Node,
  Edge,
  NodeKind,
  EdgeKind,
  Subgraph,
  CodeBlock,
  TaskContext,
  TaskInput,
  BuildContextOptions,
  FindRelevantContextOptions,
  SearchResult,
} from '../types';
import { QueryBuilder } from '../db/queries';
import { GraphTraverser } from '../graph';
import { VectorManager } from '../vectors';
import { formatContextAsMarkdown, formatContextAsJson } from './formatter';
import { logDebug, logWarn } from '../errors';
import { validatePathWithinRoot } from '../utils';
import { isTestFile } from '../search/query-utils';

/**
 * Extract likely symbol names from a natural language query
 *
 * Identifies potential code symbols using patterns:
 * - CamelCase: UserService, signInWithGoogle
 * - snake_case: user_service, sign_in
 * - SCREAMING_SNAKE: MAX_RETRIES
 * - dot.notation: app.isPackaged (extracts both sides)
 * - Single words that look like identifiers (no spaces, not common English words)
 *
 * @param query - Natural language query
 * @returns Array of potential symbol names
 */
function extractSymbolsFromQuery(query: string): string[] {
  const symbols = new Set<string>();

  // Extract CamelCase identifiers (2+ chars, starts with letter)
  const camelCasePattern = /\b([A-Z][a-z]+(?:[A-Z][a-z]*)*|[a-z]+(?:[A-Z][a-z]*)+)\b/g;
  let match;
  while ((match = camelCasePattern.exec(query)) !== null) {
    if (match[1] && match[1].length >= 2) {
      symbols.add(match[1]);
    }
  }

  // Extract snake_case identifiers
  const snakeCasePattern = /\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/gi;
  while ((match = snakeCasePattern.exec(query)) !== null) {
    if (match[1] && match[1].length >= 3) {
      symbols.add(match[1]);
    }
  }

  // Extract SCREAMING_SNAKE_CASE
  const screamingPattern = /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g;
  while ((match = screamingPattern.exec(query)) !== null) {
    if (match[1]) {
      symbols.add(match[1]);
    }
  }

  // Extract dot.notation and split into parts (e.g., "app.isPackaged" -> ["app", "isPackaged"])
  const dotPattern = /\b([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+)\b/g;
  while ((match = dotPattern.exec(query)) !== null) {
    if (match[1]) {
      // Add both the full path and individual parts
      symbols.add(match[1]);
      const parts = match[1].split('.');
      for (const part of parts) {
        if (part.length >= 2) {
          symbols.add(part);
        }
      }
    }
  }

  // Filter out common English words that might match patterns
  const commonWords = new Set([
    'the', 'and', 'for', 'with', 'from', 'this', 'that', 'have', 'been',
    'will', 'would', 'could', 'should', 'does', 'done', 'make', 'made',
    'use', 'used', 'using', 'work', 'works', 'find', 'found', 'show',
    'call', 'called', 'calling', 'get', 'set', 'add', 'all', 'any',
    'how', 'what', 'when', 'where', 'which', 'who', 'why'
  ]);

  return Array.from(symbols).filter(s => !commonWords.has(s.toLowerCase()));
}

/**
 * Default options for context building
 *
 * Tuned for minimal context usage while still providing useful results:
 * - Fewer nodes and code blocks by default
 * - Smaller code block size limit
 * - Shallower traversal
 */
const DEFAULT_BUILD_OPTIONS: Required<BuildContextOptions> = {
  maxNodes: 20,           // Reduced from 50 - most tasks don't need 50 symbols
  maxCodeBlocks: 5,       // Reduced from 10 - only show most relevant code
  maxCodeBlockSize: 1500, // Reduced from 2000
  includeCode: true,
  format: 'markdown',
  searchLimit: 3,         // Reduced from 5 - fewer entry points
  traversalDepth: 1,      // Reduced from 2 - shallower graph expansion
  minScore: 0.3,
};

/**
 * Node kinds that provide high information value in context results.
 * Imports/exports are excluded because they have near-zero information density -
 * they tell you something exists, not how it works.
 */
const HIGH_VALUE_NODE_KINDS: NodeKind[] = [
  'function', 'method', 'class', 'interface', 'type_alias', 'struct', 'trait',
  'component', 'route', 'variable', 'constant', 'enum', 'module', 'namespace',
];

/**
 * Default options for finding relevant context
 */
const DEFAULT_FIND_OPTIONS: Required<FindRelevantContextOptions> = {
  searchLimit: 3,        // Reduced from 5
  traversalDepth: 1,     // Reduced from 2
  maxNodes: 20,          // Reduced from 50
  minScore: 0.3,
  edgeKinds: [],
  nodeKinds: HIGH_VALUE_NODE_KINDS, // Filter out imports/exports by default
};

/**
 * Context Builder
 *
 * Coordinates semantic search and graph traversal to build
 * comprehensive context for tasks.
 */
export class ContextBuilder {
  private projectRoot: string;
  private queries: QueryBuilder;
  private traverser: GraphTraverser;
  private vectorManager: VectorManager | null;

  constructor(
    projectRoot: string,
    queries: QueryBuilder,
    traverser: GraphTraverser,
    vectorManager: VectorManager | null
  ) {
    this.projectRoot = projectRoot;
    this.queries = queries;
    this.traverser = traverser;
    this.vectorManager = vectorManager;
  }

  /**
   * Build context for a task
   *
   * Pipeline:
   * 1. Parse task input (string or {title, description})
   * 2. Run semantic search to find entry points
   * 3. Expand graph around entry points
   * 4. Extract code blocks for key nodes
   * 5. Format output for Claude
   *
   * @param input - Task description or object with title/description
   * @param options - Build options
   * @returns TaskContext (structured) or formatted string
   */
  async buildContext(
    input: TaskInput,
    options: BuildContextOptions = {}
  ): Promise<TaskContext | string> {
    const opts = { ...DEFAULT_BUILD_OPTIONS, ...options };

    // Parse input
    const query = typeof input === 'string' ? input : `${input.title}${input.description ? `: ${input.description}` : ''}`;

    // Find relevant context (semantic search + graph expansion)
    const subgraph = await this.findRelevantContext(query, {
      searchLimit: opts.searchLimit,
      traversalDepth: opts.traversalDepth,
      maxNodes: opts.maxNodes,
      minScore: opts.minScore,
    });

    // Get entry points (nodes from semantic search)
    const entryPoints = this.getEntryPoints(subgraph);

    // Extract code blocks for key nodes
    const codeBlocks = opts.includeCode
      ? await this.extractCodeBlocks(subgraph, opts.maxCodeBlocks, opts.maxCodeBlockSize)
      : [];

    // Get related files
    const relatedFiles = this.getRelatedFiles(subgraph);

    // Generate summary
    const summary = this.generateSummary(query, subgraph, entryPoints);

    // Calculate stats
    const stats = {
      nodeCount: subgraph.nodes.size,
      edgeCount: subgraph.edges.length,
      fileCount: relatedFiles.length,
      codeBlockCount: codeBlocks.length,
      totalCodeSize: codeBlocks.reduce((sum, block) => sum + block.content.length, 0),
    };

    const context: TaskContext = {
      query,
      subgraph,
      entryPoints,
      codeBlocks,
      relatedFiles,
      summary,
      stats,
    };

    // Return formatted output or raw context
    if (opts.format === 'markdown') {
      return formatContextAsMarkdown(context);
    } else if (opts.format === 'json') {
      return formatContextAsJson(context);
    }

    return context;
  }

  /**
   * Find relevant subgraph for a query
   *
   * Uses hybrid search combining exact symbol lookup with semantic search:
   * 1. Extract potential symbol names from query
   * 2. Look up exact matches for those symbols (high confidence)
   * 3. Use semantic search for concept matching
   * 4. Merge results, prioritizing exact matches
   * 5. Traverse graph from entry points
   *
   * @param query - Natural language query
   * @param options - Search and traversal options
   * @returns Subgraph of relevant nodes and edges
   */
  async findRelevantContext(
    query: string,
    options: FindRelevantContextOptions = {}
  ): Promise<Subgraph> {
    const opts = { ...DEFAULT_FIND_OPTIONS, ...options };

    // Start with empty subgraph
    const nodes = new Map<string, Node>();
    const edges: Edge[] = [];
    const roots: string[] = [];

    // Handle empty query - return empty subgraph
    if (!query || query.trim().length === 0) {
      return { nodes, edges, roots };
    }

    // === HYBRID SEARCH ===

    // Step 1: Extract potential symbol names from query
    const symbolsFromQuery = extractSymbolsFromQuery(query);
    logDebug('Extracted symbols from query', { query, symbols: symbolsFromQuery });

    // Step 2: Look up exact matches for extracted symbols
    let exactMatches: SearchResult[] = [];
    if (symbolsFromQuery.length > 0) {
      try {
        exactMatches = this.queries.findNodesByExactName(symbolsFromQuery, {
          limit: Math.ceil(opts.searchLimit * 2), // Get more since we'll merge
          kinds: opts.nodeKinds && opts.nodeKinds.length > 0 ? opts.nodeKinds : undefined,
        });
        logDebug('Exact symbol matches', { count: exactMatches.length });
      } catch (error) {
        logDebug('Exact symbol lookup failed', { error: String(error) });
      }
    }

    // Step 3: Try semantic search if vector manager is available
    let semanticResults: SearchResult[] = [];
    if (this.vectorManager && this.vectorManager.isInitialized()) {
      try {
        semanticResults = await this.vectorManager.search(query, {
          limit: opts.searchLimit,
          kinds: opts.nodeKinds && opts.nodeKinds.length > 0 ? opts.nodeKinds : undefined,
        });
        logDebug('Semantic search results', { count: semanticResults.length });
      } catch (error) {
        logDebug('Semantic search failed, falling back to text search', { query, error: String(error) });
      }
    }

    // Step 4: Fall back to text search if no semantic results
    if (semanticResults.length === 0 && exactMatches.length === 0) {
      try {
        const textResults = this.queries.searchNodes(query, {
          limit: opts.searchLimit,
          kinds: opts.nodeKinds && opts.nodeKinds.length > 0 ? opts.nodeKinds : undefined,
        });
        semanticResults = textResults;
      } catch (error) {
        logWarn('Text search failed', { query, error: String(error) });
        // Return empty results
      }
    }

    // Step 5: Merge results, prioritizing exact matches
    const seenIds = new Set<string>();
    let searchResults: SearchResult[] = [];

    // Add exact matches first (highest priority)
    for (const result of exactMatches) {
      if (!seenIds.has(result.node.id)) {
        seenIds.add(result.node.id);
        searchResults.push(result);
      }
    }

    // Add semantic/text results
    for (const result of semanticResults) {
      if (!seenIds.has(result.node.id)) {
        seenIds.add(result.node.id);
        searchResults.push(result);
      }
    }

    // Limit total results
    searchResults = searchResults.slice(0, opts.searchLimit * 2);

    // Deprioritize test files unless the query is about tests
    const queryLower = query.toLowerCase();
    const isTestQuery = queryLower.includes('test') || queryLower.includes('spec');
    if (!isTestQuery) {
      searchResults = searchResults.map(r => ({
        ...r,
        score: isTestFile(r.node.filePath) ? r.score * 0.3 : r.score,
      }));
      searchResults.sort((a, b) => b.score - a.score);
    }

    // Filter by minimum score
    let filteredResults = searchResults.filter((r) => r.score >= opts.minScore);

    // Resolve imports/exports to their actual definitions
    // If someone searches "terminal" and finds `import { TerminalPanel }`,
    // they want the TerminalPanel class, not the import statement
    filteredResults = this.resolveImportsToDefinitions(filteredResults);

    // Add entry points to subgraph
    for (const result of filteredResults) {
      nodes.set(result.node.id, result.node);
      roots.push(result.node.id);
    }

    // Traverse from each entry point
    for (const result of filteredResults) {
      const traversalResult = this.traverser.traverseBFS(result.node.id, {
        maxDepth: opts.traversalDepth,
        edgeKinds: opts.edgeKinds && opts.edgeKinds.length > 0 ? opts.edgeKinds : undefined,
        nodeKinds: opts.nodeKinds && opts.nodeKinds.length > 0 ? opts.nodeKinds : undefined,
        direction: 'both',
        limit: Math.ceil(opts.maxNodes / Math.max(1, filteredResults.length)),
      });

      // Merge nodes
      for (const [id, node] of traversalResult.nodes) {
        if (!nodes.has(id)) {
          nodes.set(id, node);
        }
      }

      // Merge edges (avoid duplicates)
      for (const edge of traversalResult.edges) {
        const exists = edges.some(
          (e) => e.source === edge.source && e.target === edge.target && e.kind === edge.kind
        );
        if (!exists) {
          edges.push(edge);
        }
      }
    }

    // Trim to max nodes if needed
    if (nodes.size > opts.maxNodes) {
      // Prioritize entry points and their direct neighbors
      const priorityIds = new Set(roots);
      for (const edge of edges) {
        if (priorityIds.has(edge.source)) {
          priorityIds.add(edge.target);
        }
        if (priorityIds.has(edge.target)) {
          priorityIds.add(edge.source);
        }
      }

      // Keep priority nodes, then fill remaining slots
      const trimmedNodes = new Map<string, Node>();
      for (const id of priorityIds) {
        const node = nodes.get(id);
        if (node && trimmedNodes.size < opts.maxNodes) {
          trimmedNodes.set(id, node);
        }
      }

      // Fill remaining from other nodes
      for (const [id, node] of nodes) {
        if (trimmedNodes.size >= opts.maxNodes) break;
        if (!trimmedNodes.has(id)) {
          trimmedNodes.set(id, node);
        }
      }

      // Filter edges to only include kept nodes
      const trimmedEdges = edges.filter(
        (e) => trimmedNodes.has(e.source) && trimmedNodes.has(e.target)
      );

      return { nodes: trimmedNodes, edges: trimmedEdges, roots };
    }

    return { nodes, edges, roots };
  }

  /**
   * Get the source code for a node
   *
   * Reads the file and extracts the code between startLine and endLine.
   *
   * @param nodeId - ID of the node
   * @returns Code string or null if not found
   */
  async getCode(nodeId: string): Promise<string | null> {
    const node = this.queries.getNodeById(nodeId);
    if (!node) {
      return null;
    }

    return this.extractNodeCode(node);
  }

  /**
   * Extract code from a node's source file
   */
  private async extractNodeCode(node: Node): Promise<string | null> {
    const filePath = validatePathWithinRoot(this.projectRoot, node.filePath);

    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      // Extract lines (1-indexed to 0-indexed)
      const startIdx = Math.max(0, node.startLine - 1);
      const endIdx = Math.min(lines.length, node.endLine);

      return lines.slice(startIdx, endIdx).join('\n');
    } catch (error) {
      logDebug('Failed to extract code from node', { nodeId: node.id, filePath: node.filePath, error: String(error) });
      return null;
    }
  }

  /**
   * Get entry points from a subgraph (the root nodes)
   */
  private getEntryPoints(subgraph: Subgraph): Node[] {
    return subgraph.roots
      .map((id) => subgraph.nodes.get(id))
      .filter((n): n is Node => n !== undefined);
  }

  /**
   * Extract code blocks for key nodes in the subgraph
   */
  private async extractCodeBlocks(
    subgraph: Subgraph,
    maxBlocks: number,
    maxBlockSize: number
  ): Promise<CodeBlock[]> {
    const blocks: CodeBlock[] = [];

    // Prioritize entry points, then functions/methods
    const priorityNodes: Node[] = [];

    // First: entry points
    for (const id of subgraph.roots) {
      const node = subgraph.nodes.get(id);
      if (node) {
        priorityNodes.push(node);
      }
    }

    // Then: functions and methods
    for (const node of subgraph.nodes.values()) {
      if (!subgraph.roots.includes(node.id)) {
        if (node.kind === 'function' || node.kind === 'method') {
          priorityNodes.push(node);
        }
      }
    }

    // Then: classes
    for (const node of subgraph.nodes.values()) {
      if (!subgraph.roots.includes(node.id)) {
        if (node.kind === 'class') {
          priorityNodes.push(node);
        }
      }
    }

    // Extract code for priority nodes
    for (const node of priorityNodes) {
      if (blocks.length >= maxBlocks) break;

      const code = await this.extractNodeCode(node);
      if (code) {
        // Truncate if too long
        const truncated = code.length > maxBlockSize
          ? code.slice(0, maxBlockSize) + '\n// ... truncated ...'
          : code;

        blocks.push({
          content: truncated,
          filePath: node.filePath,
          startLine: node.startLine,
          endLine: node.endLine,
          language: node.language,
          node,
        });
      }
    }

    return blocks;
  }

  /**
   * Get unique files from a subgraph
   */
  private getRelatedFiles(subgraph: Subgraph): string[] {
    const files = new Set<string>();
    for (const node of subgraph.nodes.values()) {
      files.add(node.filePath);
    }
    return Array.from(files).sort();
  }

  /**
   * Generate a summary of the context
   */
  private generateSummary(_query: string, subgraph: Subgraph, entryPoints: Node[]): string {
    const nodeCount = subgraph.nodes.size;
    const edgeCount = subgraph.edges.length;
    const files = this.getRelatedFiles(subgraph);

    const entryPointNames = entryPoints
      .slice(0, 3)
      .map((n) => n.name)
      .join(', ');

    const remaining = entryPoints.length > 3 ? ` and ${entryPoints.length - 3} more` : '';

    return `Found ${nodeCount} relevant code symbols across ${files.length} files. ` +
      `Key entry points: ${entryPointNames}${remaining}. ` +
      `${edgeCount} relationships identified.`;
  }

  /**
   * Resolve import/export nodes to their actual definitions
   *
   * When search returns `import { TerminalPanel }`, users want the TerminalPanel
   * class definition, not the import statement. This follows the `imports` edge
   * to find and return the actual definition instead.
   *
   * @param results - Search results that may include import/export nodes
   * @returns Results with imports resolved to definitions where possible
   */
  private resolveImportsToDefinitions(results: SearchResult[]): SearchResult[] {
    const resolved: SearchResult[] = [];
    const seenIds = new Set<string>();

    for (const result of results) {
      const { node, score } = result;

      // If it's not an import/export, keep it as-is
      if (node.kind !== 'import' && node.kind !== 'export') {
        if (!seenIds.has(node.id)) {
          seenIds.add(node.id);
          resolved.push(result);
        }
        continue;
      }

      // For imports/exports, try to find what they reference
      // Imports have outgoing 'imports' edges to the definition
      // Exports have outgoing 'exports' edges to the definition
      const edgeKind = node.kind === 'import' ? 'imports' : 'exports';
      const outgoingEdges = this.queries.getOutgoingEdges(node.id, [edgeKind as EdgeKind]);

      let foundDefinition = false;
      for (const edge of outgoingEdges) {
        const targetNode = this.queries.getNodeById(edge.target);
        if (targetNode && !seenIds.has(targetNode.id)) {
          // Found the definition - use it instead of the import
          seenIds.add(targetNode.id);
          resolved.push({
            node: targetNode,
            score: score, // Preserve the original score
          });
          foundDefinition = true;
          logDebug('Resolved import to definition', {
            import: node.name,
            definition: targetNode.name,
            kind: targetNode.kind,
          });
        }
      }

      // If we couldn't resolve the import, skip it (it's low-value on its own)
      if (!foundDefinition) {
        logDebug('Skipping unresolved import', { name: node.name, file: node.filePath });
      }
    }

    return resolved;
  }
}

/**
 * Create a context builder
 */
export function createContextBuilder(
  projectRoot: string,
  queries: QueryBuilder,
  traverser: GraphTraverser,
  vectorManager: VectorManager | null
): ContextBuilder {
  return new ContextBuilder(projectRoot, queries, traverser, vectorManager);
}

// Re-export formatter
export { formatContextAsMarkdown, formatContextAsJson } from './formatter';
