import { Node, Subgraph } from '../types';
import { QueryBuilder } from '../db/queries';
import { GraphTraverser } from '../graph/traversal';
import { inferArchitecture } from './node-role-helpers';
import { ArchitectureLayer, ArchitectureRole } from './types';

/**
 * Input to ArchitectureImpactEngine.impact().
 */
export interface ArchitectureImpactInput {
  /** Explicit target node ID or qualified name */
  nodeId?: string;

  /** Query used to resolve the target when nodeId is absent */
  query?: string;

  /** Maximum traversal depth (default: 3) */
  depth?: number;
}

/**
 * A recommended regression test derived from an affected architecture surface.
 */
export interface ArchitectureRecommendedTest {
  nodeId: string;
  name: string;
  role: ArchitectureRole;
  filePath: string;
  reason: string;
}

/**
 * Architecture-oriented breakdown of an impact surface.
 */
export interface ArchitectureImpactBreakdown {
  entrypoints: Node[];
  services: Node[];
  mappers: Node[];
  sql: Node[];
  fields: Node[];
  configs: Node[];
}

/**
 * Structured result returned by ArchitectureImpactEngine.impact().
 */
export interface ArchitectureImpactResult {
  /** True when the supplied query/nodeId could not be resolved */
  notFound: boolean;

  /** Raw impact subgraph from GraphTraverser.getImpactRadius */
  subgraph: Subgraph;

  /** Architecture-oriented categorization of affected nodes */
  breakdown: ArchitectureImpactBreakdown;

  /** Count of affected nodes per role */
  roleAggregation: Record<string, number>;

  /** Count of affected nodes per logical layer */
  layerAggregation: Record<string, number>;

  /** Derived regression-test recommendations */
  recommendedTests: ArchitectureRecommendedTest[];

  /** Overall risk level */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';

  /** Warnings generated during analysis */
  warnings: string[];

  /** Effective depth used */
  effectiveDepth: number;
}

/**
 * Architecture-aware wrapper around GraphTraverser.getImpactRadius.
 *
 * - Bounds depth with a default of 3.
 * - Avoids reverse-contains explosion (relies on getImpactRadius, which already
 *   excludes incoming `contains` edges, and we do not re-add them).
 * - Aggregates affected nodes by architectural role and layer.
 * - Derives a `recommendedTests` array from affected entrypoints, services, and mappers.
 * - Returns a stable structured result even for empty/minimal impact surfaces.
 */
export class ArchitectureImpactEngine {
  private traverser: GraphTraverser;
  private queries: QueryBuilder;

  constructor(traverser: GraphTraverser, queries: QueryBuilder) {
    this.traverser = traverser;
    this.queries = queries;
  }

  /**
   * Calculate architecture-oriented impact for a target node.
   */
  impact(input: ArchitectureImpactInput): ArchitectureImpactResult {
    const depth = input.depth ?? 3;
    const warnings: string[] = [];

    const targetNode = this.resolveTarget(input.nodeId, input.query, warnings);
    if (!targetNode) {
      return {
        notFound: true,
        subgraph: { nodes: new Map(), edges: [], roots: [] },
        breakdown: this.emptyBreakdown(),
        roleAggregation: {},
        layerAggregation: {},
        recommendedTests: [],
        riskLevel: 'low',
        warnings,
        effectiveDepth: depth,
      };
    }

    const subgraph = this.traverser.getImpactRadius(targetNode.id, depth);

    // Defensive: ensure no reverse-contains edges leaked into the result.
    const sanitizedEdges = subgraph.edges.filter((e) => e.kind !== 'contains' || e.source !== targetNode.id);
    if (sanitizedEdges.length !== subgraph.edges.length) {
      warnings.push('Reverse containment edges were suppressed to avoid impact explosion.');
    }
    subgraph.edges = sanitizedEdges;

    const breakdown = this.categorizeNodes(subgraph, targetNode);
    const { roleAggregation, layerAggregation } = this.aggregateByRoleAndLayer(subgraph);
    const recommendedTests = this.deriveRecommendedTests(breakdown, targetNode);
    const riskLevel = this.deriveRiskLevel(breakdown, subgraph);

    return {
      notFound: false,
      subgraph,
      breakdown,
      roleAggregation,
      layerAggregation,
      recommendedTests,
      riskLevel,
      warnings,
      effectiveDepth: depth,
    };
  }

  private resolveTarget(
    nodeId: string | undefined,
    query: string | undefined,
    warnings: string[]
  ): Node | null {
    if (nodeId) {
      const byId = this.queries.getNodeById(nodeId);
      if (byId) return byId;
      const byName = this.queries.getNodesByQualifiedNameExact(nodeId);
      if (byName.length > 0) return byName[0]!;
      const byLower = this.queries.getNodesByName(nodeId);
      if (byLower.length > 0) return byLower[0]!;
      warnings.push(`Could not resolve nodeId "${nodeId}".`);
      return null;
    }

    if (query) {
      const results = this.queries.searchNodes(query, { limit: 5 });
      if (results.length === 0) {
        warnings.push(`Query "${query}" did not resolve to any known symbol.`);
        return null;
      }
      if (results.length > 1) {
        warnings.push(
          `Query "${query}" resolved to ${results.length} candidates; using top match "${results[0]!.node.qualifiedName}".`
        );
      }
      return results[0]!.node;
    }

    warnings.push('No nodeId or query was provided.');
    return null;
  }

  private categorizeNodes(subgraph: Subgraph, targetNode: Node): ArchitectureImpactBreakdown {
    const entrypoints: Node[] = [];
    const services: Node[] = [];
    const mappers: Node[] = [];
    const sql: Node[] = [];
    const fields: Node[] = [];
    const configs: Node[] = [];

    for (const node of subgraph.nodes.values()) {
      if (node.id === targetNode.id) continue;

      const arch = inferArchitecture(node);
      const role = arch.role?.toLowerCase() ?? '';
      const layer = arch.layer;

      if (layer === 'entry' || arch.isEntrypoint) {
        entrypoints.push(node);
      }
      if (role.includes('service')) {
        services.push(node);
      }
      if (role.includes('mapper') || role.includes('repository')) {
        mappers.push(node);
      }
      if (role.includes('config') || role.includes('configuration') || role.includes('component')) {
        configs.push(node);
      }
      if (node.kind === 'field' || node.kind === 'property') {
        fields.push(node);
      }
      if (this.looksLikeSql(node)) {
        sql.push(node);
      }
    }

    return { entrypoints, services, mappers, sql, fields, configs };
  }

  private looksLikeSql(node: Node): boolean {
    const lower = node.name.toLowerCase();
    const file = node.filePath.toLowerCase();
    return (
      lower.includes('sql') ||
      lower.includes('query') ||
      lower.includes('select') ||
      lower.includes('insert') ||
      lower.includes('update') ||
      lower.includes('delete') ||
      file.includes('mapper') ||
      file.endsWith('.xml')
    );
  }

  private aggregateByRoleAndLayer(subgraph: Subgraph): {
    roleAggregation: Record<string, number>;
    layerAggregation: Record<string, number>;
  } {
    const roleAggregation: Record<ArchitectureRole, number> = {};
    const layerAggregation: Partial<Record<ArchitectureLayer, number>> = {};

    for (const node of subgraph.nodes.values()) {
      const arch = inferArchitecture(node);
      if (arch.role) {
        roleAggregation[arch.role] = (roleAggregation[arch.role] ?? 0) + 1;
      }
      if (arch.layer) {
        layerAggregation[arch.layer] = (layerAggregation[arch.layer] ?? 0) + 1;
      }
    }

    return { roleAggregation, layerAggregation };
  }

  private deriveRecommendedTests(
    breakdown: ArchitectureImpactBreakdown,
    targetNode: Node
  ): ArchitectureRecommendedTest[] {
    const tests: ArchitectureRecommendedTest[] = [];
    const seen = new Set<string>();

    const add = (node: Node, reason: string) => {
      if (seen.has(node.id)) return;
      seen.add(node.id);
      const arch = inferArchitecture(node);
      tests.push({
        nodeId: node.id,
        name: node.name,
        role: arch.role ?? 'unknown',
        filePath: node.filePath,
        reason,
      });
    };

    for (const node of breakdown.entrypoints) {
      add(node, `Entrypoint affected by change to ${targetNode.name}`);
    }
    for (const node of breakdown.services) {
      add(node, `Service affected by change to ${targetNode.name}`);
    }
    for (const node of breakdown.mappers) {
      add(node, `Data-access surface affected by change to ${targetNode.name}`);
    }

    return tests;
  }

  private deriveRiskLevel(breakdown: ArchitectureImpactBreakdown, subgraph: Subgraph): ArchitectureImpactResult['riskLevel'] {
    const affectedCount = subgraph.nodes.size - 1; // exclude target
    const entrypoints = breakdown.entrypoints.length;
    const services = breakdown.services.length;
    const mappers = breakdown.mappers.length;

    if (entrypoints > 0 && (services > 0 || mappers > 0)) return 'critical';
    if (entrypoints > 0) return 'high';
    if ((services > 0 && mappers > 0) || services > 2 || mappers > 2) return 'high';
    if (services > 0 || mappers > 0) return 'medium';
    if (affectedCount > 10) return 'medium';
    return 'low';
  }

  private emptyBreakdown(): ArchitectureImpactBreakdown {
    return {
      entrypoints: [],
      services: [],
      mappers: [],
      sql: [],
      fields: [],
      configs: [],
    };
  }
}

/**
 * Convenience function for callers that don't want to instantiate the engine.
 */
export function impactArchitecture(
  traverser: GraphTraverser,
  queries: QueryBuilder,
  input: ArchitectureImpactInput
): ArchitectureImpactResult {
  return new ArchitectureImpactEngine(traverser, queries).impact(input);
}
