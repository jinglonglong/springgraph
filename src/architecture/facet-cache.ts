/**
 * Runtime cache for architecture profile detection and per-node facets.
 *
 * The cache is intentionally derived (not persisted) so it stays in sync with
 * the graph automatically as long as the indexing lifecycle calls the hooks
 * below. Project-level profile detection is only recomputed when a full index
 * runs or when a global signal file (pom.xml, build.gradle, application.yml,
 * etc.) changes; ordinary file syncs update only the facets for the changed
 * files and evict facets for deleted files.
 */
import type { CodeGraph } from '../index';
import type { Node } from '../types';
import type { DatabaseConnection } from '../db';
import { Mutex } from '../utils';
import { detectArchitectureProfile } from './profile-detector';
import { FacetEngine } from './facet-engine';
import { profileRegistry } from './profile-registry';
import type {
  ArchitectureProfile,
  ArchitectureSnapshot,
  NodeArchitectureFacet,
  ProfileDetectionResult,
} from './types';
import { indexFacets } from '../web/graph-response';

const GLOBAL_PROFILE_REDETECT_FILES = new Set([
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'application.yml',
  'application.yaml',
  'application.properties',
]);

function isGlobalProfileFile(filePath: string): boolean {
  const base = filePath.split('/').pop() || filePath;
  return GLOBAL_PROFILE_REDETECT_FILES.has(base);
}

function getCgDb(cg: CodeGraph): DatabaseConnection {
  return (cg as any).db as DatabaseConnection;
}

function collectArchitectureNodes(cg: CodeGraph): Node[] {
  return cg.getNodesByKind('class').concat(cg.getNodesByKind('interface'));
}

function buildFullState(cg: CodeGraph): CachedArchitectureState {
  const nodes = collectArchitectureNodes(cg);
  const db = getCgDb(cg);
  const result = detectArchitectureProfile(nodes, db);
  const activeName = result.activeProfile ?? 'generic';
  const profile =
    profileRegistry.findByName(activeName) ?? profileRegistry.getGenericFallback();

  let facets: NodeArchitectureFacet[] = [];
  if (profile && profile.facetIds.length > 0) {
    const engine = new FacetEngine(profile);
    facets = engine.runFacets(nodes, db);
  }

  return {
    result,
    profile,
    facets: indexFacets(facets),
  };
}

function computeFacetsForNodes(
  cg: CodeGraph,
  profile: ArchitectureProfile,
  nodes: Node[]
): NodeArchitectureFacet[] {
  if (!profile || profile.facetIds.length === 0) return [];
  const engine = new FacetEngine(profile);
  return engine.runFacets(nodes, getCgDb(cg));
}

export interface CachedArchitectureState {
  result: ProfileDetectionResult;
  profile: ArchitectureProfile;
  facets: Map<string, NodeArchitectureFacet>;
}

/**
 * Cached architecture snapshot plus a monotonic generation counter. The
 * generation lets consumers (e.g. the web API) detect when the cache has
 * been refreshed and avoid serving the same stale data twice.
 */
export interface SnapshotResult {
  snapshot: ArchitectureSnapshot;
  generation: number;
}

/**
 * ArchitectureFacetCache keeps the latest architecture profile and per-node
 * facet results in memory. It is updated by CodeGraph.indexAll/sync and read
 * by the architecture REST API and WebUI.
 */
export class ArchitectureFacetCache {
  private cg: CodeGraph;
  private mutex = new Mutex();
  private state: CachedArchitectureState | null = null;
  private generation = 0;

  constructor(cg: CodeGraph) {
    this.cg = cg;
  }

  /**
   * Fully recompute project-level profile detection and all node facets.
   * Callers should invoke this under the indexing lock so architecture state
   * cannot be observed mid-update.
   */
  async recomputeAll(): Promise<SnapshotResult> {
    return this.mutex.withLock(async () => {
      this.state = buildFullState(this.cg);
      this.generation += 1;
      return { snapshot: this.toSnapshot(this.state), generation: this.generation };
    });
  }

  /**
   * Incrementally update architecture state after a sync.
   *
   * - Refreshes facets for nodes in each changed file.
   * - Evicts facets for nodes in each deleted file.
   * - Re-runs project-level profile detection if a global signal file changed.
   */
  async applySyncChanges(
    changedFilePaths: string[],
    removedFilePaths: string[]
  ): Promise<SnapshotResult> {
    return this.mutex.withLock(async () => {
      if (!this.state) {
        // No cached state yet (e.g. sync ran before the first full index) —
        // do a full compute rather than leaving the API with nothing.
        this.state = buildFullState(this.cg);
        this.generation += 1;
        return { snapshot: this.toSnapshot(this.state), generation: this.generation };
      }

      const needsProjectRedetect =
        changedFilePaths.some(isGlobalProfileFile) ||
        removedFilePaths.some(isGlobalProfileFile);

      if (needsProjectRedetect) {
        this.state = buildFullState(this.cg);
        this.generation += 1;
        return { snapshot: this.toSnapshot(this.state), generation: this.generation };
      }

      const hasClassInterfaceChanges =
        changedFilePaths.some((fp) =>
          this.cg.getNodesInFile(fp).some((n) => n.kind === 'class' || n.kind === 'interface')
        ) ||
        removedFilePaths.some((fp) =>
          this.cg.getNodesInFile(fp).some((n) => n.kind === 'class' || n.kind === 'interface')
        );

      if (hasClassInterfaceChanges) {
        const newNodes = collectArchitectureNodes(this.cg);
        const currentCount = this.state.facets.size;
        if (newNodes.length > 0 && currentCount === 0) {
          this.state = buildFullState(this.cg);
          this.generation += 1;
          return { snapshot: this.toSnapshot(this.state), generation: this.generation };
        }
      }

      const profile = this.state.profile;

      // Evict stale facets for deleted files.
      for (const filePath of removedFilePaths) {
        for (const [nodeId] of this.state.facets) {
          const node = this.cg.getNode(nodeId);
          if (!node || node.filePath === filePath) {
            this.state.facets.delete(nodeId);
          }
        }
      }

      // Recompute facets for changed files.
      for (const filePath of changedFilePaths) {
        const nodesInFile = this.cg
          .getNodesInFile(filePath)
          .filter((n) => n.kind === 'class' || n.kind === 'interface');

        // Remove any stale facets for this file first (in case a class was
        // deleted inside a modified file).
        for (const [nodeId] of this.state.facets) {
          const node = this.cg.getNode(nodeId);
          if (node && node.filePath === filePath) {
            this.state.facets.delete(nodeId);
          }
        }

        if (nodesInFile.length > 0) {
          const fresh = computeFacetsForNodes(this.cg, profile, nodesInFile);
          for (const facet of fresh) {
            this.state.facets.set(facet.nodeId, facet);
          }
        }
      }

      this.generation += 1;
      return { snapshot: this.toSnapshot(this.state), generation: this.generation };
    });
  }

  /**
   * Return the current cached snapshot, computing it on-demand if necessary.
   * The optional `minGeneration` parameter lets callers wait for a fresher
   * generation (e.g. after a watch-triggered sync).
   */
  async getSnapshot(minGeneration?: number): Promise<SnapshotResult> {
    return this.mutex.withLock(async () => {
      if (!this.state) {
        this.state = buildFullState(this.cg);
        this.generation += 1;
      }
      // If the caller observed an older generation and is waiting for a newer
      // one, it must poll; this guard simply ensures we never go backwards.
      if (minGeneration !== undefined && this.generation < minGeneration) {
        // Recompute to satisfy the minimum generation request. In practice this
        // should not happen because sync/indexAll bump the generation.
        this.state = buildFullState(this.cg);
        this.generation = Math.max(this.generation + 1, minGeneration);
      }
      return { snapshot: this.toSnapshot(this.state), generation: this.generation };
    });
  }

  /**
   * Synchronous peek at the cached state. Returns null when no cache exists.
   * Prefer getSnapshot() for API responses; this is useful for tests and
   * diagnostics that only need the current value.
   */
  getCachedState(): CachedArchitectureState | null {
    return this.state;
  }

  /**
   * Return the current snapshot, computing it synchronously on-demand if
   * necessary. Used by the sync web API handlers.
   */
  getSnapshotSync(): ArchitectureSnapshot {
    if (!this.state) {
      this.state = buildFullState(this.cg);
      this.generation += 1;
    }
    return this.toSnapshot(this.state);
  }

  getGeneration(): number {
    return this.generation;
  }

  private toSnapshot(state: CachedArchitectureState): ArchitectureSnapshot {
    return {
      result: state.result,
      profile: state.profile,
      facets: state.facets,
      nodes: collectArchitectureNodes(this.cg),
    };
  }
}
