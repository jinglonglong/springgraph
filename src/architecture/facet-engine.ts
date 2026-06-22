import { DatabaseConnection } from '../db';
import { Node } from '../types';
import {
  ArchitectureContext,
  ArchitectureFacet,
  ArchitectureProfile,
  ArchitectureSignal,
  FacetSignalAggregator,
  NodeArchitectureFacet,
  ArchitectureLayer,
  ArchitectureRole
} from './types';
import { resolveRole } from './role-assignment';
import * as path from 'path';

/**
 * Registry for active facets. Enables dynamic registration and lookup.
 */
export class FacetRegistry {
  private facets = new Map<string, ArchitectureFacet>();

  register(facet: ArchitectureFacet): void {
    this.facets.set(facet.id, facet);
  }

  getFacet(id: string): ArchitectureFacet | undefined {
    return this.facets.get(id);
  }

  getFacets(): ArchitectureFacet[] {
    return Array.from(this.facets.values());
  }

  clear(): void {
    this.facets.clear();
  }
}

export const facetRegistry = new FacetRegistry();

/**
 * Default implementation of FacetSignalAggregator.
 * Collects project-level and node-level signals, and aggregates them.
 */
export class DefaultFacetSignalAggregator implements FacetSignalAggregator {
  nodeSignals = new Map<string, ArchitectureSignal[]>();
  globalSignals: ArchitectureSignal[] = [];

  addSignal(signal: ArchitectureSignal): void {
    if (signal.nodeId) {
      const list = this.nodeSignals.get(signal.nodeId) || [];
      list.push(signal);
      this.nodeSignals.set(signal.nodeId, list);
    } else {
      this.globalSignals.push(signal);
    }
  }

  addSignals(signals: ArchitectureSignal[]): void {
    for (const s of signals) {
      this.addSignal(s);
    }
  }

  aggregate(): NodeArchitectureFacet[] {
    const facets: NodeArchitectureFacet[] = [];

    for (const [nodeId, signals] of this.nodeSignals.entries()) {
      if (signals.length === 0) continue;

      let bestRole: ArchitectureRole | undefined;
      let bestLayer: ArchitectureLayer | undefined;
      let bestModule: string | undefined;
      let bestPackage: string | undefined;
      let isEntrypoint = false;

      let maxRoleConfidence = -1;
      let maxLayerConfidence = -1;

      const combinedEvidence: string[] = [];

      for (const s of signals) {
        combinedEvidence.push(...s.evidence);

        const role = s.metadata?.role || s.metadata?.roleId;
        const layer = s.metadata?.layer || s.metadata?.layerId;
        const module = s.module || s.metadata?.module;
        const packageName = s.metadata?.packageName;
        const entrypoint = s.metadata?.isEntrypoint || s.metadata?.entrypoint;

        if (role && s.confidence > maxRoleConfidence) {
          bestRole = role;
          maxRoleConfidence = s.confidence;
        }

        if (layer && s.confidence > maxLayerConfidence) {
          bestLayer = layer as ArchitectureLayer;
          maxLayerConfidence = s.confidence;
        }

        if (module) {
          bestModule = module;
        }

        if (packageName) {
          bestPackage = packageName;
        }

        if (entrypoint) {
          isEntrypoint = true;
        }
      }

      facets.push({
        nodeId,
        facetName: Array.from(new Set(signals.map(s => s.facetName))).join(','),
        confidence: Math.max(...signals.map(s => s.confidence), 0),
        evidence: Array.from(new Set(combinedEvidence)),
        role: bestRole,
        layer: bestLayer,
        module: bestModule,
        packageName: bestPackage,
        isEntrypoint,
        profileId: signals[0]?.profileName,
      });
    }

    // Resolve conflicts
    resolveRole(facets);

    return facets;
  }
}

/**
 * FacetEngine aggregates signals from multiple facets and computes per-node NodeArchitectureFacet.
 */
export class FacetEngine {
  private signals: ArchitectureSignal[] = [];
  private aggregator: FacetSignalAggregator;

  constructor(
    private profile: ArchitectureProfile,
    aggregator?: FacetSignalAggregator
  ) {
    this.aggregator = aggregator || new DefaultFacetSignalAggregator();
  }

  /**
   * Runs all facet.detect() on each node (via context), returns per-node facet results.
   */
  runFacets(nodes: Node[], db: DatabaseConnection): NodeArchitectureFacet[] {
    this.signals = [];

    // Derive project root from database path: e.g. path/to/project/.springgraph/springgraph.db -> path/to/project
    const dbPath = db.getPath();
    const projectRoot = path.dirname(path.dirname(dbPath));

    const context: ArchitectureContext = {
      db,
      projectRoot,
      getNodes: async () => nodes
    };

    // 1. Run all facets in the profile
    for (const facetId of this.profile.facetIds) {
      const facet = facetRegistry.getFacet(facetId);
      if (!facet) {
        continue;
      }

      try {
        const result = facet.detect(context);
        if (result instanceof Promise) {
          console.warn(
            `[FacetEngine] Facet '${facetId}' returned a Promise. Asynchronous facets are not supported in synchronous runFacets.`
          );
        } else if (Array.isArray(result)) {
          this.signals.push(...result);
        }
      } catch (err) {
        console.error(`[FacetEngine] Error running facet '${facetId}':`, err);
      }
    }

    // 2. Group signals by nodeId
    const signalsByNode = new Map<string, ArchitectureSignal[]>();
    for (const signal of this.signals) {
      if (signal.nodeId) {
        const list = signalsByNode.get(signal.nodeId) || [];
        list.push(signal);
        signalsByNode.set(signal.nodeId, list);
      }
    }

    // 3. Compute per-node facets
    const nodeFacets: NodeArchitectureFacet[] = [];
    for (const [nodeId, nodeSignals] of signalsByNode.entries()) {
      const nodeFacet = this.computeNodeFacet(nodeId, nodeSignals);
      nodeFacets.push(nodeFacet);
    }

    // 4. Resolve role conflicts across computed node facets
    resolveRole(nodeFacets);

    // Update the aggregator with signals for backward compatibility/external users
    this.aggregator.addSignals(this.signals);

    return nodeFacets;
  }

  /**
   * Runs all facets associated with the profile and return the accumulated signals.
   * Provided for compatibility with profile-detector.ts.
   */
  async runFacetsAsync(context: ArchitectureContext): Promise<ArchitectureSignal[]> {
    const signals: ArchitectureSignal[] = [];

    for (const facetId of this.profile.facetIds) {
      const facet = facetRegistry.getFacet(facetId);
      if (facet) {
        try {
          const result = facet.detect(context);
          const facetSignals = result instanceof Promise ? await result : result;
          signals.push(...facetSignals);
        } catch (e) {
          console.error(`Error running facet ${facetId} in FacetEngine:`, e);
        }
      }
    }

    this.signals = signals;
    this.aggregator.addSignals(signals);
    return signals;
  }

  /**
   * Synchronous version of runFacets.
   * Provided for compatibility with profile-detector.ts.
   */
  runFacetsSync(context: ArchitectureContext): ArchitectureSignal[] {
    const signals: ArchitectureSignal[] = [];

    for (const facetId of this.profile.facetIds) {
      const facet = facetRegistry.getFacet(facetId);
      if (facet) {
        try {
          const result = facet.detect(context);
          if (result instanceof Promise) {
            console.warn(`Facet ${facetId} returned a Promise in sync execution mode; skipping.`);
          } else {
            signals.push(...result);
          }
        } catch (e) {
          console.error(`Error running facet ${facetId} (sync) in FacetEngine:`, e);
        }
      }
    }

    this.signals = signals;
    this.aggregator.addSignals(signals);
    return signals;
  }

  /**
   * Flattens and returns all signals matching the processed node facets.
   */
  aggregateSignals(facets: NodeArchitectureFacet[]): ArchitectureSignal[] {
    const nodeIds = new Set(facets.map(f => f.nodeId));
    return this.signals.filter(s => !s.nodeId || nodeIds.has(s.nodeId));
  }

  /**
   * Combines all signals for a single node into a NodeArchitectureFacet,
   * applying confidence scoring to select the best role and layer.
   */
  computeNodeFacet(nodeId: string, signals: ArchitectureSignal[]): NodeArchitectureFacet {
    // Collect all facet names and evidence
    const facetName = Array.from(new Set(signals.map(s => s.facetName))).join(',');
    const evidence = signals.flatMap(s => s.evidence);

    const nodeFacet: NodeArchitectureFacet = {
      nodeId,
      facetName: facetName || this.profile.name,
      confidence: 0,
      evidence,
      profileId: this.profile.id,
      isEntrypoint: false
    };

    let maxRoleConf = -1;
    let bestRole: string | undefined = undefined;

    let maxLayerConf = -1;
    let bestLayer: ArchitectureLayer | undefined = undefined;

    let maxModuleConf = -1;
    let bestModule: string | undefined = undefined;

    let bestPackage: string | undefined = undefined;

    let isEntrypoint = false;

    // Apply confidence scoring: if multiple facets give different role/layer for the same node, take the highest confidence
    for (const signal of signals) {
      const role = signal.metadata?.role || signal.metadata?.roleId;
      if (role && signal.confidence > maxRoleConf) {
        maxRoleConf = signal.confidence;
        bestRole = role;
      }

      const layer = signal.metadata?.layer || signal.metadata?.layerId;
      if (layer && signal.confidence > maxLayerConf) {
        maxLayerConf = signal.confidence;
        bestLayer = layer as ArchitectureLayer;
      }

      const mod = signal.module || signal.metadata?.module;
      if (mod && signal.confidence > maxModuleConf) {
        maxModuleConf = signal.confidence;
        bestModule = mod;
      }

      const pkg = signal.metadata?.packageName || signal.metadata?.package;
      if (pkg) {
        bestPackage = pkg;
      }

      if (signal.metadata?.isEntrypoint === true || signal.metadata?.entrypoint === true) {
        isEntrypoint = true;
      }
    }

    if (bestRole !== undefined) {
      nodeFacet.role = bestRole;
    }
    if (bestLayer !== undefined) {
      nodeFacet.layer = bestLayer;
    }
    if (bestModule !== undefined) {
      nodeFacet.module = bestModule;
    }
    if (bestPackage !== undefined) {
      nodeFacet.packageName = bestPackage;
    }
    if (isEntrypoint) {
      nodeFacet.isEntrypoint = true;
    }

    // Set overall confidence as the maximum of all signals
    nodeFacet.confidence = Math.max(...signals.map(s => s.confidence), 0);

    return nodeFacet;
  }

  /**
   * Get the signal aggregator instance.
   * Provided for compatibility with profile-detector.ts.
   */
  getAggregator(): FacetSignalAggregator {
    return this.aggregator;
  }
}