/**
 * Graph serialization helpers used by the web UI REST surface.
 *
 * This module owns the conversion from Springgraph nodes/edges into the JSON
 * shapes returned by /api/*, including architecture-facet overlays.
 */
import { type Node, type Edge } from '../types';
import { type NodeArchitectureFacet } from '../architecture/types';

/**
 * Map a NodeKind to a Cytoscape-friendly color. Centralized so the frontend
 * doesn't need to maintain a parallel table.
 */
export const KIND_COLORS: Record<string, string> = {
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
export const EDGE_COLORS: Record<string, string> = {
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
    provenance: edge.provenance ?? 'tree-sitter',
    metadata: edge.metadata,
  };
}

/**
 * Serialize a node and merge its architecture facet, if present.
 */
export function serializeNodeWithFacet(
  node: Node,
  facet?: NodeArchitectureFacet
): Record<string, unknown> {
  const base = summarizeNode(node);
  if (!facet) return base;
  return {
    ...base,
    role: facet.role,
    layer: facet.layer,
    profileId: facet.profileId,
    confidence: facet.confidence,
    isEntrypoint: facet.isEntrypoint,
    evidence: facet.evidence,
    module: facet.module,
    packageName: facet.packageName,
  };
}

/**
 * Serialize an edge, preserving any provenance/metadata.
 */
export function serializeEdgeWithMetadata(edge: Edge): Record<string, unknown> {
  const base = summarizeEdge(edge);
  return {
    ...base,
    provenance: edge.provenance ?? 'tree-sitter',
    metadata: edge.metadata,
  };
}

/**
 * Convert a Subgraph (Map<id, Node>, Edge[]) into the flat array shape that
 * Cytoscape's elements:{ nodes, edges } expects.
 */
export function subgraphToCytoscape(
  subgraph: { nodes: Map<string, Node>; edges: Edge[] },
  facets?: Map<string, NodeArchitectureFacet>
): { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } {
  const nodes = Array.from(subgraph.nodes.values()).map((n) =>
    serializeNodeWithFacet(n, facets?.get(n.id))
  );
  const edges = subgraph.edges.map((e) => serializeEdgeWithMetadata(e));
  return { nodes, edges };
}

function extractModule(filePath: string | undefined | null): string {
  if (!filePath) return '_root';
  const first = filePath.split('/')[0] || '_root';
  if (
    first === 'src' ||
    first === 'test' ||
    first === 'tests' ||
    first === 'node_modules' ||
    first.endsWith('.xml') ||
    first.endsWith('.gradle')
  ) {
    return '_config';
  }
  return first;
}

/**
 * Compute role, layer, and module breakdowns for a set of nodes using the
 * supplied architecture facet map.
 */
export function buildBreakdowns(
  nodes: Node[],
  facets: Map<string, NodeArchitectureFacet> | undefined
): {
  roleBreakdown: Record<string, number>;
  layerBreakdown: Record<string, number>;
  moduleBreakdown: Record<string, number>;
} {
  const roleBreakdown: Record<string, number> = {};
  const layerBreakdown: Record<string, number> = {};
  const moduleBreakdown: Record<string, number> = {};

  for (const node of nodes) {
    const facet = facets?.get(node.id);
    if (facet?.role) {
      roleBreakdown[facet.role] = (roleBreakdown[facet.role] || 0) + 1;
    } else {
      roleBreakdown[node.kind] = (roleBreakdown[node.kind] || 0) + 1;
    }
    if (facet?.layer) {
      layerBreakdown[facet.layer] = (layerBreakdown[facet.layer] || 0) + 1;
    } else {
      layerBreakdown['unknown'] = (layerBreakdown['unknown'] || 0) + 1;
    }
    const mod = facet?.module ?? extractModule(node.filePath);
    moduleBreakdown[mod] = (moduleBreakdown[mod] || 0) + 1;
  }

  return { roleBreakdown, layerBreakdown, moduleBreakdown };
}

/**
 * Build a facets map from a list of NodeArchitectureFacet results.
 */
export function indexFacets(facets: NodeArchitectureFacet[]): Map<string, NodeArchitectureFacet> {
  const map = new Map<string, NodeArchitectureFacet>();
  for (const f of facets) map.set(f.nodeId, f);
  return map;
}
