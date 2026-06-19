// packages/springkg-core/src/spring-kg.ts
// SpringKg — orchestrator that wires CodeGraph + SpringDatabase + Resolvers

import * as path from 'path';
import { CodeGraph } from '@colbymchenry/codegraph';
import type { Resolver, SpringKgEnhanceInput, SpringKgEnhanceOutput } from '@colbymchenry/springkg-shared';
import { SPRINGKG_CONFIG } from '@colbymchenry/springkg-shared';
import { SpringDatabase } from './db/spring-db.js';

export interface SpringKgOptions {
  projectPath: string;
  resolvers?: Resolver[];
  autoWatch?: boolean;
}

export class SpringKg {
  // Duck-typed CodeGraph facade (satisfies { [k: string]: unknown })
  readonly cg: { [k: string]: unknown };

  // Expose the SpringDatabase
  readonly db: SpringDatabase;

  private constructor(
    private readonly _cg: CodeGraph,
    springDb: SpringDatabase,
    private readonly _resolvers: Map<string, Resolver>,
    private readonly _projectPath: string,
    private _watching = false,
  ) {
    this.cg = _cg as unknown as { [k: string]: unknown };
    this.db = springDb;
  }

  // -------------------------------------------------------------------------
  // Factory methods
  // -------------------------------------------------------------------------

  /**
   * Initialize a new SpringKg project — creates .codegraph/, CodeGraph DB,
   * and springkg.db, then runs resolvers on the empty graph.
   */
  static async init(options: SpringKgOptions): Promise<SpringKg> {
    const cg = await CodeGraph.init(options.projectPath);
    const db = SpringDatabase.initialize(options.projectPath);

    const resolvers = new Map<string, Resolver>();
    for (const r of options.resolvers ?? []) {
      resolvers.set(r.name, r);
    }

    const instance = new SpringKg(cg, db, resolvers, options.projectPath, options.autoWatch ?? false);

    // Run resolvers on empty paths (initialization pass)
    if (resolvers.size > 0) {
      await instance.enhanceOnSync([]);
    }

    if (options.autoWatch) {
      instance.watch();
    }

    return instance;
  }

  /**
   * Open an existing SpringKg project — opens both the CodeGraph DB and springkg.db.
   */
  static async open(options: SpringKgOptions): Promise<SpringKg> {
    const cg = await CodeGraph.open(options.projectPath);
    const db = SpringDatabase.open(options.projectPath);

    const resolvers = new Map<string, Resolver>();
    for (const r of options.resolvers ?? []) {
      resolvers.set(r.name, r);
    }

    return new SpringKg(cg, db, resolvers, options.projectPath, options.autoWatch ?? false);
  }

  // -------------------------------------------------------------------------
  // Resolver management
  // -------------------------------------------------------------------------

  /**
   * Register a resolver. If a resolver with the same name already exists it is
   * replaced. Resolvers are executed in the order defined by
   * `SPRINGKG_CONFIG.resolverChain`.
   */
  registerResolver(r: Resolver): void {
    this._resolvers.set(r.name, r);
  }

  // -------------------------------------------------------------------------
  // Enhance
  // -------------------------------------------------------------------------

  /**
   * Build `SpringKgEnhanceInput` from a set of absolute file paths using the
   * CodeGraph API, then call `enhance()` on every registered resolver.
   *
   * Errors from individual resolvers are caught and logged so one failing
   * resolver does NOT block the others.
   */
  async enhanceOnSync(paths: ReadonlyArray<string>): Promise<SpringKgEnhanceOutput[]> {
    // Collect all nodes and edges from the given paths
    const allNodes: Array<{ id: string; kind: string; name: string; filePath: string }> = [];
    const allEdges: Array<{ id: string; source: string; target: string; kind: string }> = [];
    const nodeIds = new Set<string>();

    for (const filePath of paths) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nodes = (this._cg as any).getNodesInFile(filePath) as Array<{ id: string; kind: string; name: string; filePath: string }>;
      for (const node of nodes) {
        if (!nodeIds.has(node.id)) {
          nodeIds.add(node.id);
          allNodes.push(node);
        }
      }
    }

    if (nodeIds.size > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const edges = (this._cg as any).getEdgesForNodes(Array.from(nodeIds)) as Array<{ id: string; source: string; target: string; kind: string }>;
      allEdges.push(...edges);
    }

    const input: SpringKgEnhanceInput = {
      codegraphNodes: allNodes,
      codegraphEdges: allEdges,
      changedFiles: Array.from(paths),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cg: this._cg as any,
    };

    const outputs: SpringKgEnhanceOutput[] = [];

    // Execute resolvers in canonical chain order
    for (const resolverName of SPRINGKG_CONFIG.resolverChain) {
      const resolver = this._resolvers.get(resolverName);
      if (!resolver) continue;

      try {
        const output = await resolver.enhance(input);
        outputs.push(output);
      } catch (err) {
        // Log and continue — one resolver failing must NOT block others
        console.error(`[SpringKg] Resolver "${resolver.name}" threw:`, err instanceof Error ? err.message : String(err));
        outputs.push({ symbolsAdded: 0, edgesAdded: 0, byKind: {} });
      }
    }

    return outputs;
  }

  // -------------------------------------------------------------------------
  // Index & Sync
  // -------------------------------------------------------------------------

  /**
   * Run a full index (`cg.indexAll`) then enhance all resolvers.
   * Returns the index result and the array of enhance outputs.
   */
  async index(): Promise<{ indexed: number; enhanced: SpringKgEnhanceOutput[] }> {
    const result = await this._cg.indexAll();
    const enhanced = await this.enhanceOnSync([]);
    return { indexed: result.filesIndexed, enhanced };
  }

  /**
   * Run an incremental sync (`cg.sync`) then enhance all resolvers on the
   * changed files. Returns the array of enhance outputs.
   */
  async sync(): Promise<SpringKgEnhanceOutput[]> {
    await this._cg.sync();
    const changed = this._cg.getChangedFiles();
    const changedFiles: string[] = [
      ...changed.added,
      ...changed.modified,
      ...changed.removed,
    ];
    return this.enhanceOnSync(changedFiles);
  }

  // -------------------------------------------------------------------------
  // Watch
  // -------------------------------------------------------------------------

  /**
   * Start watching file changes. When a sync completes, retrieves the pending
   * files via `cg.getPendingFiles()` and runs `enhanceOnSync` on them.
   *
   * Returns `true` if watching started successfully.
   */
  watch(
    opts?: { onSyncComplete?: (r: { filesChanged: number; durationMs: number }) => void },
  ): boolean {
    if (this._watching) return true;

    const started = this._cg.watch({
      onSyncComplete: (result: { filesChanged: number; durationMs: number }) => {
        // Translate pending files (project-relative) to absolute paths and enhance
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pending = (this._cg as any).getPendingFiles() as Array<{ path: string; indexing: boolean }>;
        const absPaths = pending.map((f) => path.resolve(this._projectPath, f.path));

        if (absPaths.length > 0) {
          this.enhanceOnSync(absPaths).catch((err) => {
            console.error('[SpringKg] enhanceOnSync in watch callback threw:', err);
          });
        }

        opts?.onSyncComplete?.(result);
      },
    });

    if (started) {
      this._watching = true;
    }
    return started;
  }

  /**
   * Stop watching file changes.
   */
  unwatch(): void {
    if (!this._watching) return;
    this._cg.unwatch();
    this._watching = false;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Stop watching and close both the CodeGraph instance and the SpringDatabase.
   */
  async close(): Promise<void> {
    this.unwatch();
    this._cg.close();
    this.db.close();
  }
}
