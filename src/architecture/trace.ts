import { Node, Edge, EdgeKind } from '../types';
import { QueryBuilder } from '../db/queries';
import { GraphTraverser } from '../graph/traversal';
import { inferArchitecture, InferredArchitecture } from './node-role-helpers';

/**
 * Input to ArchitectureTraceEngine.trace().
 *
 * Either explicit `from`/`to` identifiers or a `query` string may be supplied.
 * The wrapper resolves `query` via the indexed graph before tracing.
 */
export interface ArchitectureTraceInput {
  /** Starting node ID or qualified name (optional if query is provided) */
  from?: string;

  /** Target node ID or qualified name (optional if query is provided) */
  to?: string;

  /** Free-form query used to resolve endpoint(s) when ids are absent */
  query?: string;

  /** Edge kinds to consider when finding a path (default: all) */
  edgeKinds?: EdgeKind[];

  /** Minimum confidence for a hop to be included in the default path */
  confidenceThreshold?: number;

  /** When true, ambiguous hops are kept in paths; otherwise they are surfaced as warnings */
  includeAmbiguous?: boolean;

  /** Maximum depth for callees/callers expansion around endpoints */
  expansionDepth?: number;
}

/**
 * A single hop in an architecture trace path.
 */
export interface ArchitectureTraceHop {
  node: Node;
  edge: Edge | null;
  confidence: number;
  provenance?: Edge['provenance'];
  isAmbiguous: boolean;
  architecture?: InferredArchitecture;
}

/**
 * One trace path from source to target.
 */
export interface ArchitectureTracePath {
  hops: ArchitectureTraceHop[];
  /** Aggregate confidence (geometric mean of hop confidences) */
  confidence: number;
}

/**
 * Metadata about an entrypoint surfaced by the trace.
 */
export interface ArchitectureTraceEntrypoint {
  nodeId: string;
  name: string;
  kind: Node['kind'];
  role?: string;
  layer?: string;
  filePath: string;
}

/**
 * Structured result returned by ArchitectureTraceEngine.trace().
 */
export interface ArchitectureTraceResult {
  /** True when the supplied query/identifiers could not be resolved */
  notFound: boolean;

  /** Entrypoints discovered near the trace endpoints */
  entrypoints: ArchitectureTraceEntrypoint[];

  /** Default paths (ambiguous hops excluded by default) */
  paths: ArchitectureTracePath[];

  /** Warnings describing ambiguity, low-confidence hops, or unresolved inputs */
  warnings: string[];

  /** Number of graph nodes examined while building the result */
  examinedNodeCount: number;
}

/**
 * Edge kinds that are considered "plausible architecture hops" when detecting
 * ambiguity. We exclude containment because it is structural, not a flow hop.
 */
const AMBIGUITY_EDGE_KINDS: EdgeKind[] = ['calls', 'references', 'instantiates', 'imports'];

/**
 * Architecture-aware wrapper around GraphTraverser path-finding.
 *
 * - Preserves provenance and confidence semantics.
 * - Marks low-confidence / heuristic hops.
 * - Detects ambiguous hops and moves them from default paths to warnings.
 * - Returns graceful structured not-found responses instead of throwing.
 */
export class ArchitectureTraceEngine {
  private traverser: GraphTraverser;
  private queries: QueryBuilder;

  constructor(traverser: GraphTraverser, queries: QueryBuilder) {
    this.traverser = traverser;
    this.queries = queries;
  }

  /**
   * Resolve a trace request into a structured result.
   */
  trace(input: ArchitectureTraceInput): ArchitectureTraceResult {
    const warnings: string[] = [];
    const confidenceThreshold = input.confidenceThreshold ?? 0.7;
    const includeAmbiguous = input.includeAmbiguous ?? false;
    const expansionDepth = input.expansionDepth ?? 2;

    const fromResolution = this.resolveEndpoint(input.from, input.query, 'from', warnings);
    const toResolution = this.resolveEndpoint(input.to, undefined, 'to', warnings);

    if (!fromResolution.node && !toResolution.node) {
      return this.emptyResult(true, [
        ...warnings,
        input.query
          ? `Could not resolve query "${input.query}" to a known symbol or node.`
          : 'No trace endpoints were provided or resolved.',
      ]);
    }

    const fromNode = fromResolution.node;
    const toNode = toResolution.node;

    if (fromNode && !toNode) {
      // Single-ended trace: expand callers/callees around the resolved node.
      return this.singleEndedTrace(fromNode, {
        confidenceThreshold,
        includeAmbiguous,
        expansionDepth,
        warnings,
      });
    }

    if (!fromNode && toNode) {
      return this.singleEndedTrace(toNode, {
        confidenceThreshold,
        includeAmbiguous,
        expansionDepth,
        warnings,
      });
    }

    // Both endpoints resolved.
    const path = this.traverser.findPath(fromNode!.id, toNode!.id, input.edgeKinds);

    if (!path) {
      return this.emptyResult(false, [
        ...warnings,
        `No traversable path found between ${fromNode!.qualifiedName} and ${toNode!.qualifiedName}.`,
      ]);
    }

    const tracePath = this.buildTracePath(path, confidenceThreshold, includeAmbiguous, warnings);
    const paths = this.filterDefaultPaths([tracePath], includeAmbiguous);

    const entrypoints = this.collectEntrypoints([fromNode!, toNode!], expansionDepth);

    return {
      notFound: false,
      entrypoints,
      paths,
      warnings,
      examinedNodeCount: path.length,
    };
  }

  private resolveEndpoint(
    identifier: string | undefined,
    query: string | undefined,
    label: 'from' | 'to',
    warnings: string[]
  ): { node: Node | null; resolvedFromQuery: boolean } {
    if (identifier) {
      const byId = this.queries.getNodeById(identifier);
      if (byId) return { node: byId, resolvedFromQuery: false };
      const byName = this.queries.getNodesByQualifiedNameExact(identifier);
      if (byName.length > 0) return { node: byName[0]!, resolvedFromQuery: false };
      const byLower = this.queries.getNodesByName(identifier);
      if (byLower.length > 0) return { node: byLower[0]!, resolvedFromQuery: false };
      warnings.push(`Could not resolve ${label} identifier "${identifier}".`);
      return { node: null, resolvedFromQuery: false };
    }

    if (query && label === 'from') {
      const results = this.queries.searchNodes(query, { limit: 5 });
      if (results.length === 0) {
        warnings.push(`Query "${query}" did not resolve to any known symbol.`);
        return { node: null, resolvedFromQuery: false };
      }
      if (results.length > 1) {
        warnings.push(
          `Query "${query}" resolved to ${results.length} candidates; using top match "${results[0]!.node.qualifiedName}".`
        );
      }
      return { node: results[0]!.node, resolvedFromQuery: true };
    }

    return { node: null, resolvedFromQuery: false };
  }

  private singleEndedTrace(
    focalNode: Node,
    opts: {
      confidenceThreshold: number;
      includeAmbiguous: boolean;
      expansionDepth: number;
      warnings: string[];
    }
  ): ArchitectureTraceResult {
    const { confidenceThreshold, includeAmbiguous, expansionDepth, warnings } = opts;

    const callers = this.traverser.getCallers(focalNode.id, expansionDepth);
    const callees = this.traverser.getCallees(focalNode.id, expansionDepth);

    const allNodes = [focalNode, ...callers.map((c) => c.node), ...callees.map((c) => c.node)];
    const uniqueNodes = Array.from(new Map(allNodes.map((n) => [n.id, n])).values());

    const paths: ArchitectureTracePath[] = [];

    // Build one-hop paths for each caller/callee so the response still has structure.
    for (const { node, edge } of [...callers, ...callees]) {
      const direction: 'caller' | 'callee' = callers.some((c) => c.node.id === node.id) ? 'caller' : 'callee';
      const path: Array<{ node: Node; edge: Edge | null }> =
        direction === 'caller'
          ? [{ node, edge }, { node: focalNode, edge: null }]
          : [{ node: focalNode, edge: null }, { node, edge }];
      const tracePath = this.buildTracePath(path, confidenceThreshold, includeAmbiguous, warnings);
      paths.push(tracePath);
    }

    const filteredPaths = this.filterDefaultPaths(paths, includeAmbiguous);

    if (paths.length === 0) {
      warnings.push(`No callers or callees found for ${focalNode.qualifiedName}.`);
    }

    return {
      notFound: false,
      entrypoints: this.collectEntrypoints(uniqueNodes, expansionDepth),
      paths: filteredPaths,
      warnings,
      examinedNodeCount: uniqueNodes.length,
    };
  }

  private buildTracePath(
    path: Array<{ node: Node; edge: Edge | null }>,
    confidenceThreshold: number,
    includeAmbiguous: boolean,
    warnings: string[]
  ): ArchitectureTracePath {
    const hops: ArchitectureTraceHop[] = [];
    let aggregateConfidence = 1.0;

    for (let i = 0; i < path.length; i++) {
      const { node, edge } = path[i]!;
      const confidence = this.hopConfidence(edge);
      const provenance = edge?.provenance;
      const isAmbiguous = i > 0 ? this.isAmbiguousHop(path[i - 1]!.node, edge) : false;

      if (isAmbiguous && !includeAmbiguous) {
        warnings.push(
          `Ambiguous hop omitted from default path at ${path[i - 1]!.node.qualifiedName}: multiple plausible next hops.`
        );
        // Truncate path here: do not include this hop or any subsequent hops in the default path.
        // We still mark it in the returned hop list so callers can see where it stopped when
        // includeAmbiguous is true.
      }

      hops.push({
        node,
        edge,
        confidence,
        provenance,
        isAmbiguous,
        architecture: inferArchitecture(node),
      });

      aggregateConfidence *= confidence;

      if (confidence < confidenceThreshold) {
        warnings.push(
          `Low-confidence hop at ${node.qualifiedName} (${provenance ?? 'unknown'} provenance, confidence ${confidence.toFixed(2)}).`
        );
      }
    }

    return { hops, confidence: aggregateConfidence };
  }

  private filterDefaultPaths(paths: ArchitectureTracePath[], includeAmbiguous: boolean): ArchitectureTracePath[] {
    if (includeAmbiguous) return paths;

    return paths
      .map((p) => {
        const cutoff = p.hops.findIndex((h) => h.isAmbiguous);
        if (cutoff === -1) return p;
        return { ...p, hops: p.hops.slice(0, cutoff) };
      })
      .filter((p) => p.hops.length > 0);
  }

  private hopConfidence(edge: Edge | null): number {
    if (!edge) return 1.0;
    switch (edge.provenance) {
      case 'tree-sitter':
        return 1.0;
      case 'scip':
        return 0.9;
      case 'heuristic':
        if (typeof edge.metadata?.confidence === 'number') {
          return edge.metadata.confidence as number;
        }
        return 0.5;
      default:
        return 1.0;
    }
  }

  /**
   * A hop is ambiguous when the source node has multiple plausible outgoing
   * edges that could have been chosen at this step.
   */
  private isAmbiguousHop(sourceNode: Node, edge: Edge | null): boolean {
    if (!edge) return false;

    const outgoing = this.queries.getOutgoingEdges(sourceNode.id, AMBIGUITY_EDGE_KINDS);
    const sameKindOutgoing = outgoing.filter((e) => e.kind === edge.kind);

    // More than one outgoing edge of the same kind is ambiguous.
    if (sameKindOutgoing.length > 1) return true;

    // Heuristic edges are considered ambiguous when the registered wiring site
    // or channel name is present but low confidence.
    if (edge.provenance === 'heuristic') {
      const confidence = this.hopConfidence(edge);
      if (confidence < 0.8) return true;
    }

    return false;
  }

  private collectEntrypoints(nodes: Node[], depth: number): ArchitectureTraceEntrypoint[] {
    const entrypoints: ArchitectureTraceEntrypoint[] = [];
    const seen = new Set<string>();

    for (const node of nodes) {
      const arch = inferArchitecture(node);
      if (arch.isEntrypoint || arch.layer === 'entry') {
        if (!seen.has(node.id)) {
          seen.add(node.id);
          entrypoints.push({
            nodeId: node.id,
            name: node.name,
            kind: node.kind,
            role: arch.role,
            layer: arch.layer,
            filePath: node.filePath,
          });
        }
        continue;
      }

      // Walk backwards a few steps looking for entrypoints.
      const callers = this.traverser.getCallers(node.id, depth);
      for (const { node: caller } of callers) {
        const callerArch = inferArchitecture(caller);
        if ((callerArch.isEntrypoint || callerArch.layer === 'entry') && !seen.has(caller.id)) {
          seen.add(caller.id);
          entrypoints.push({
            nodeId: caller.id,
            name: caller.name,
            kind: caller.kind,
            role: callerArch.role,
            layer: callerArch.layer,
            filePath: caller.filePath,
          });
        }
      }
    }

    return entrypoints;
  }

  private emptyResult(notFound: boolean, warnings: string[]): ArchitectureTraceResult {
    return {
      notFound,
      entrypoints: [],
      paths: [],
      warnings,
      examinedNodeCount: 0,
    };
  }
}

/**
 * Convenience function for callers that don't want to instantiate the engine.
 */
export function traceArchitecture(
  traverser: GraphTraverser,
  queries: QueryBuilder,
  input: ArchitectureTraceInput
): ArchitectureTraceResult {
  return new ArchitectureTraceEngine(traverser, queries).trace(input);
}
