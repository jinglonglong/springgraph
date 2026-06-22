/**
 * SpringKg — orchestrator that wraps Springgraph + SpringDatabase + resolver chain.
 *
 * This is the public entry point for all other teams. It manages:
 * - Springgraph lifecycle (init/open/close)
 * - SpringDatabase lifecycle (initialize/open/close)
 * - Resolver registration and ordered execution
 * - File watching with automatic enhanceOnSync bridging
 * - SummaryGenerator lifecycle
 */

import * as path from 'path';
import type { Resolver, SpringKgEnhanceInput, SpringKgEnhanceOutput } from '@jinglonglong/springkg-shared';
import { SPRINGKG_CONFIG } from '@jinglonglong/springkg-shared';
import { SpringDatabase } from './db/spring-db.js';
import { SummaryGenerator } from './community/summary-generator.js';

// Springgraph is a peer dependency — import dynamically at runtime
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySpringgraph = any;

export interface SpringKgOptions {
  projectPath: string;
  /** Initial resolvers (others can be added via registerResolver). */
  resolvers?: Resolver[];
  /** When true (default), enables the file watcher on init(). */
  autoWatch?: boolean;
}

/**
 * Thin facade for resolvers — exposes only read-only Springgraph query methods.
 * Prevents resolvers from accidentally calling mutating methods on Springgraph.
 */
function buildCgFacade(cg: AnySpringgraph) {
  return {
    getNode: (id: string) => cg.getNode(id),
    getOutgoingEdges: (id: string) => cg.getOutgoingEdges(id),
    getIncomingEdges: (id: string) => cg.getIncomingEdges(id),
    getNodesInFile: (filePath: string) => cg.getNodesInFile(filePath),
  };
}

/**
 * Sort resolvers by SPRINGKG_CONFIG.resolverChain order.
 * Resolvers NOT in the chain run after chain resolvers, in registration order.
 */
function sortByChain(resolvers: Resolver[]): Resolver[] {
  const chain = SPRINGKG_CONFIG.resolverChain;
  return [...resolvers].sort((a, b) => {
    const ai = chain.indexOf(a.name as typeof chain[number]);
    const bi = chain.indexOf(b.name as typeof chain[number]);
    const aIdx = ai === -1 ? Infinity : ai;
    const bIdx = bi === -1 ? Infinity : bi;
    return aIdx - bIdx;
  });
}

export class SpringKg {
  private resolvers: Map<string, Resolver> = new Map();
  private summaryGenerator: SummaryGenerator;
  private lastEnhanceAt: number = 0;

  private constructor(
    public readonly cg: AnySpringgraph,
    public readonly db: SpringDatabase,
    private readonly projectPath: string,
  ) {
    this.summaryGenerator = new SummaryGenerator(db);
  }

  // -------------------------------------------------------------------------
  // Static factories
  // -------------------------------------------------------------------------

  /**
   * Create a fresh SpringKg — initializes Springgraph + SpringDatabase.
   */
  static async init(options: SpringKgOptions): Promise<SpringKg> {
    // Dynamic import of Springgraph (peer dependency)
    const cgModule = await import('@jinglonglong/springgraph');
    const Springgraph = (cgModule as any).Springgraph || (cgModule as any).default?.Springgraph || (cgModule as any).default;

    const cg = Springgraph.isInitialized(options.projectPath)
      ? await Springgraph.open(options.projectPath)
      : await Springgraph.init(options.projectPath);
    const db = SpringDatabase.initialize(options.projectPath);
    const sk = new SpringKg(cg, db, options.projectPath);

    // Register initial resolvers
    for (const r of options.resolvers ?? []) {
      sk.registerResolver(r);
    }

    // Start summary generator timer
    sk.summaryGenerator.start();

    return sk;
  }

  /**
   * Open an existing SpringKg — opens Springgraph + SpringDatabase.
   */
  static async open(options: SpringKgOptions): Promise<SpringKg> {
    const cgModule = await import('@jinglonglong/springgraph');
    const Springgraph = (cgModule as any).Springgraph || (cgModule as any).default?.Springgraph || (cgModule as any).default;

    const cg = await Springgraph.open(options.projectPath);
    const db = SpringDatabase.open(options.projectPath);
    const sk = new SpringKg(cg, db, options.projectPath);

    for (const r of options.resolvers ?? []) {
      sk.registerResolver(r);
    }

    sk.summaryGenerator.start();

    return sk;
  }

  // -------------------------------------------------------------------------
  // Resolver management
  // -------------------------------------------------------------------------

  /**
   * Register a resolver (idempotent: same name re-registered replaces).
   */
  registerResolver(r: Resolver): void {
    this.resolvers.set(r.name, r);
  }

  // -------------------------------------------------------------------------
  // Enhance (resolver execution)
  // -------------------------------------------------------------------------

  /**
   * Run all registered resolvers against current state + changed files.
   * Resolvers execute in SPRINGKG_CONFIG.resolverChain order.
   * One resolver failing MUST NOT block the others.
   */
  async enhanceOnSync(paths: ReadonlyArray<string>): Promise<SpringKgEnhanceOutput[]> {
    const since = this.lastEnhanceAt;

    // Collect unique node IDs from changed files
    const nodeIds = new Set<string>();
    for (const filePath of paths) {
      try {
        const nodes = this.cg.getNodesInFile(filePath);
        for (const node of nodes) {
          nodeIds.add(node.id);
        }
      } catch {
        // File might not be in Springgraph index yet — skip
      }
    }

    // Collect edges for those nodes
    const edges: unknown[] = [];
    for (const nodeId of nodeIds) {
      try {
        const outgoing = this.cg.getOutgoingEdges(nodeId);
        edges.push(...outgoing);
      } catch {
        // Ignore edge query errors
      }
    }

    // Build enhance input
    const input: SpringKgEnhanceInput = {
      springgraphNodes: [...nodeIds].map((id) => {
        const node = this.cg.getNode(id);
        return node ?? { id, kind: 'unknown', name: '', filePath: '' };
      }),
      springgraphEdges: edges as SpringKgEnhanceInput['springgraphEdges'],
      changedFiles: paths,
      cg: buildCgFacade(this.cg) as SpringKgEnhanceInput['cg'],
      since,
    } as SpringKgEnhanceInput;

    // Stage definitions — if ALL resolvers in a stage fail, skip subsequent stages
    const STAGE_DEFINITIONS: ReadonlyArray<{ name: string; resolvers: readonly string[] }> = [
      { name: 'Team-B-semantic', resolvers: ['annotation-engine', 'endpoint-resolver', 'feign-resolver', 'feign-provider-bridge', 'feign-request-response-type'] },
      { name: 'Team-D-runtime', resolvers: ['config-resolver', 'middleware-inventory', 'nacos-config-resolver', 'config-property-usage-tracker', 'gateway-route-resolver'] },
      { name: 'Team-C-data', resolvers: ['mybatis-xml-extractor', 'annotation-sql-extractor', 'sql-table-column', 'mapper-binding', 'mybatis-plus'] },
      { name: 'Team-F-community', resolvers: ['community-builder'] },
    ];

    const results: SpringKgEnhanceOutput[] = [];
    let stageFailed = false;

    for (const stage of STAGE_DEFINITIONS) {
      if (stageFailed) {
        console.debug(`[springkg] Skipping stage ${stage.name} (previous stage failed entirely)`);
        continue;
      }

      const stageResolvers = stage.resolvers
        .map(name => this.resolvers.get(name))
        .filter((r): r is Resolver => r !== undefined);

      if (stageResolvers.length === 0) continue;

      let anySucceeded = false;
      const stageStart = Date.now();

      for (const resolver of stageResolvers) {
        try {
          const start = Date.now();
          const output = await resolver.enhance(input);
          const duration = Date.now() - start;
          console.debug(`[springkg] ${resolver.name}: ${duration}ms, +${output.symbolsAdded} symbols, +${output.edgesAdded} edges`);
          results.push(output);
          anySucceeded = true;
        } catch (err) {
          console.error(`[springkg] Resolver ${resolver.name} failed:`, err);
          results.push({ symbolsAdded: 0, edgesAdded: 0, byKind: {} });
        }
      }

      const stageDuration = Date.now() - stageStart;
      console.debug(`[springkg] Stage ${stage.name}: ${stageDuration}ms, succeeded=${anySucceeded}`);

      // If ALL resolvers in this stage failed, skip subsequent stages
      if (!anySucceeded) {
        stageFailed = true;
      }
    }

    // Run any resolvers not in a defined stage (fallback, in chain order)
    const stagedNames = new Set(STAGE_DEFINITIONS.flatMap(s => s.resolvers));
    const unstagedResolvers = sortByChain(
      [...this.resolvers.values()].filter(r => !stagedNames.has(r.name))
    );

    for (const resolver of unstagedResolvers) {
      try {
        const start = Date.now();
        const output = await resolver.enhance(input);
        const duration = Date.now() - start;
        console.debug(`[springkg] ${resolver.name}: ${duration}ms, +${output.symbolsAdded} symbols, +${output.edgesAdded} edges`);
        results.push(output);
      } catch (err) {
        console.error(`[springkg] Resolver ${resolver.name} failed:`, err);
        results.push({ symbolsAdded: 0, edgesAdded: 0, byKind: {} });
      }
    }

    this.lastEnhanceAt = Date.now();
    return results;
  }

  // -------------------------------------------------------------------------
  // Index / Sync
  // -------------------------------------------------------------------------

  /**
   * Index the project (wraps Springgraph.indexAll, then enhanceOnSync).
   */
  async index(): Promise<{ indexed: number; enhanced: SpringKgEnhanceOutput[] }> {
    const result = await this.cg.indexAll();
    const enhanced = await this.enhanceOnSync([]);
    return {
      indexed: (result.filesAdded ?? 0) + (result.filesModified ?? 0),
      enhanced,
    };
  }

  /**
   * Incremental sync (wraps Springgraph.sync, then enhanceOnSync with changed files).
   */
  async sync(): Promise<SpringKgEnhanceOutput[]> {
    await this.cg.sync();
    const changed = this.cg.getChangedFiles();
    const paths = [
      ...(changed.added || []),
      ...(changed.modified || []),
      ...(changed.removed || []),
    ];
    return this.enhanceOnSync(paths);
  }

  // -------------------------------------------------------------------------
  // Watch
  // -------------------------------------------------------------------------

  /**
   * Start watcher. Uses Springgraph.watch + bridges onSyncComplete → enhanceOnSync.
   */
  watch(opts?: { onSyncComplete?: (result: { filesChanged: number; durationMs: number }) => void }): boolean {
    return this.cg.watch({
      debounceMs: 2000,
      onSyncComplete: async (result: { filesChanged: number; durationMs: number }) => {
        // After sync completes, get pending files and enhance
        try {
          const pending = this.cg.getPendingFiles();
          const paths = pending.map((pf: { path: string }) =>
            path.resolve(this.projectPath, pf.path)
          );
          await this.enhanceOnSync(paths);
        } catch (err) {
          console.error('[springkg] Watch enhance error:', err);
        }
        // Call original callback if provided
        opts?.onSyncComplete?.(result);
      },
    });
  }

  /**
   * Stop watcher.
   */
  unwatch(): void {
    this.cg.unwatch();
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------

  /**
   * Manual trigger for community summary regeneration.
   * Used by Team G's CLI.
   */
  async summarizeNow(): Promise<void> {
    await this.summaryGenerator.regenerateIfDirty();
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Close Springgraph + SpringDatabase + SummaryGenerator.
   */
  async close(): Promise<void> {
    this.summaryGenerator.stop();
    this.cg.close();
    this.db.close();
  }
}
