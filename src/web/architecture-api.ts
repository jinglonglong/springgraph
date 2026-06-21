/**
 * Architecture-specific REST endpoints.
 *
 * Owns /api/architecture/* and keeps Spring/architecture interpretation
 * logic out of src/web/server.ts.
 */
import * as http from 'http';
import * as url from 'url';
import { type CodeGraph } from '../index';
import { type Node, type Edge, type EdgeKind } from '../types';
import {
  type NodeArchitectureFacet,
  type ArchitectureSnapshot,
} from '../architecture/types';
import {
  serializeNodeWithFacet,
  serializeEdgeWithMetadata,
  buildBreakdowns,
  subgraphToCytoscape,
} from './graph-response';
import { profileRegistry } from '../architecture/profile-registry';

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

// ---------------------------------------------------------------------------
// Architecture context helpers
// ---------------------------------------------------------------------------

export function getArchitectureSnapshot(cg: CodeGraph): ArchitectureSnapshot {
  return cg.getArchitectureSnapshot();
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

export interface FilterSet {
  roles: string[] | null;
  layers: string[] | null;
  modules: string[] | null;
  decorators: string[] | null;
}

function parseCsv(param: string | undefined | null): string[] | null {
  if (!param) return null;
  const list = param
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : null;
}

export function extractModule(filePath: string | undefined | null): string {
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

export function matchesFilters(node: Node, facet: NodeArchitectureFacet | undefined, filters: FilterSet): boolean {
  if (filters.roles && filters.roles.length > 0) {
    const role = facet?.role?.toLowerCase() ?? '';
    if (!filters.roles.some((r) => role === r.toLowerCase())) return false;
  }
  if (filters.layers && filters.layers.length > 0) {
    const layer = facet?.layer?.toLowerCase() ?? '';
    if (!filters.layers.some((l) => layer === l.toLowerCase())) return false;
  }
  if (filters.modules && filters.modules.length > 0) {
    const mod = facet?.module ?? extractModule(node.filePath);
    if (!filters.modules.some((m) => mod.toLowerCase() === m.toLowerCase())) return false;
  }
  if (filters.decorators && filters.decorators.length > 0) {
    const decs = node.decorators ?? [];
    if (!filters.decorators.some((d) => decs.includes(d))) return false;
  }
  return true;
}

export function parseFilters(query: url.UrlWithParsedQuery['query']): FilterSet {
  return {
    roles: parseCsv(query.role as string | undefined),
    layers: parseCsv(query.layer as string | undefined),
    modules: parseCsv(query.module as string | undefined),
    decorators: parseCsv(query.decorator as string | undefined),
  };
}

// ---------------------------------------------------------------------------
// Node / query resolution
// ---------------------------------------------------------------------------

function resolveQuery(
  cg: CodeGraph,
  query: string
): { node: Node | null; warnings: string[] } {
  const results = cg.searchNodes(query, { limit: 5 });
  if (results.length === 0) {
    return { node: null, warnings: [`No node found for query: ${query}`] };
  }
  if (results.length > 1) {
    const names = results.map((r) => r.node.name).join(', ');
    return {
      node: results[0]!.node,
      warnings: [`Query "${query}" resolved to multiple nodes; using ${results[0]!.node.name} (also: ${names})`],
    };
  }
  return { node: results[0]!.node, warnings: [] };
}

function resolveNodeId(
  cg: CodeGraph,
  nodeId: string | undefined,
  query: string | undefined
): { node: Node | null; warnings: string[] } {
  if (nodeId) {
    const node = cg.getNode(nodeId);
    return node ? { node, warnings: [] } : { node: null, warnings: [`Node not found: ${nodeId}`] };
  }
  if (query) return resolveQuery(cg, query);
  return { node: null, warnings: ['Missing nodeId or query parameter'] };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleArchitectureProfiles(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  cg: CodeGraph
): Promise<void> {
  const snapshot = await getArchitectureSnapshot(cg);
  const activeMatch = snapshot.result.allMatches[0];
  sendJson(res, 200, {
    profileId: snapshot.profile.id,
    profileName: snapshot.profile.name,
    description: snapshot.profile.description,
    activeProfile: snapshot.profile.name,
    profileConfidence: activeMatch?.confidence ?? 0,
    layers: snapshot.profile.layers,
    roles: snapshot.profile.roles,
    matches: snapshot.result.allMatches.map((m) => ({
      profileName: profileRegistry.findByName(m.profileName)?.name ?? m.profileName,
      confidence: m.confidence,
      nodeCount: m.nodeCount,
      layerBreakdown: m.layerBreakdown,
      roleBreakdown: m.roleBreakdown,
    })),
    warnings: snapshot.result.warnings,
  });
}

export async function handleArchitectureOverview(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  cg: CodeGraph
): Promise<void> {
  const parsed = url.parse(req.url || '', true);
  const limit = Math.min(Math.max(parseInt((parsed.query.limit as string) || '80', 10) || 80, 1), 200);
  const filters = parseFilters(parsed.query);

  const snapshot = await getArchitectureSnapshot(cg);
  let selected = snapshot.nodes.filter((n) => matchesFilters(n, snapshot.facets.get(n.id), filters));

  // Prefer entrypoints, then by confidence, then by name for stability.
  selected.sort((a, b) => {
    const fa = snapshot.facets.get(a.id);
    const fb = snapshot.facets.get(b.id);
    const entryDiff = Number(!!fb?.isEntrypoint) - Number(!!fa?.isEntrypoint);
    if (entryDiff !== 0) return entryDiff;
    const confDiff = (fb?.confidence ?? 0) - (fa?.confidence ?? 0);
    if (confDiff !== 0) return confDiff;
    return a.filePath.localeCompare(b.filePath);
  });

  const capped = selected.slice(0, limit);
  const ids = new Set(capped.map((n) => n.id));
  const edges = cg.getEdgesForNodes(capped.map((n) => n.id)).filter(
    (e) => ids.has(e.source) && ids.has(e.target)
  );

  const elements = subgraphToCytoscape({ nodes: new Map(capped.map((n) => [n.id, n])), edges }, snapshot.facets);
  const breakdowns = buildBreakdowns(capped, snapshot.facets);

  sendJson(res, 200, {
    mode: 'architecture',
    profileId: snapshot.profile.id,
    activeProfile: snapshot.profile.name,
    profileConfidence: snapshot.result.allMatches[0]?.confidence ?? 0,
    nodeCount: elements.nodes.length,
    edgeCount: elements.edges.length,
    nodes: elements.nodes,
    edges: elements.edges,
    facets: Object.fromEntries(
      Array.from(snapshot.facets.entries()).filter(([id]) => ids.has(id))
    ),
    ...breakdowns,
  });
}

const TRACE_EDGE_KINDS: EdgeKind[] = [
  'calls',
  'references',
  'extends',
  'implements',
  'instantiates',
  'overrides',
  'decorates',
  'type_of',
  'returns',
];

function confidenceForEdge(edge: Edge): number {
  if (edge.provenance === 'heuristic') return 0.6;
  if (edge.provenance === 'scip') return 0.9;
  return 0.95;
}

export async function handleArchitectureTrace(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  cg: CodeGraph
): Promise<void> {
  const parsed = url.parse(req.url || '', true);
  const fromParam = (parsed.query.from as string | undefined)?.trim();
  const toParam = (parsed.query.to as string | undefined)?.trim();
  const queryParam = (parsed.query.query as string | undefined)?.trim();

  const warnings: string[] = [];

  let fromNode: Node | null = null;
  let toNode: Node | null = null;

  if (fromParam) {
    fromNode = cg.getNode(fromParam);
    if (!fromNode) warnings.push(`From node not found: ${fromParam}`);
  }
  if (toParam) {
    toNode = cg.getNode(toParam);
    if (!toNode) warnings.push(`To node not found: ${toParam}`);
  }

  if (queryParam) {
    const resolved = resolveQuery(cg, queryParam);
    if (!fromNode && resolved.node) fromNode = resolved.node;
    else if (!toNode && resolved.node) toNode = resolved.node;
    warnings.push(...resolved.warnings);
  }

  if (!fromNode || !toNode) {
    sendJson(res, 200, {
      from: fromNode ? serializeNodeWithFacet(fromNode) : null,
      to: toNode ? serializeNodeWithFacet(toNode) : null,
      entrypoint: null,
      paths: [],
      confidence: 0,
      warnings,
    });
    return;
  }

  const snapshot = await getArchitectureSnapshot(cg);
  const fromFacet = snapshot.facets.get(fromNode.id);
  const entrypoint = fromFacet?.isEntrypoint
    ? serializeNodeWithFacet(fromNode, fromFacet)
    : null;

  const rawPath = cg.findPath(fromNode.id, toNode.id, TRACE_EDGE_KINDS);
  if (!rawPath) {
    sendJson(res, 200, {
      from: serializeNodeWithFacet(fromNode, fromFacet),
      to: serializeNodeWithFacet(toNode, snapshot.facets.get(toNode.id)),
      entrypoint,
      paths: [],
      confidence: 0,
      warnings: [...warnings, `No path found between ${fromNode.name} and ${toNode.name}`],
    });
    return;
  }

  const pathConfidence =
    rawPath.length > 1
      ? rawPath.slice(1).reduce((min, hop) => Math.min(min, hop.edge ? confidenceForEdge(hop.edge) : 1), 1)
      : 1;

  const hops = rawPath.map((hop) => ({
    node: serializeNodeWithFacet(hop.node, snapshot.facets.get(hop.node.id)),
    edge: hop.edge ? serializeEdgeWithMetadata(hop.edge) : null,
    confidence: hop.edge ? confidenceForEdge(hop.edge) : 1,
  }));

  const heuristicHops = hops.filter((h) => h.edge && (h.edge as any).provenance === 'heuristic');
  if (heuristicHops.length > 0) {
    warnings.push(`${heuristicHops.length} hop(s) derived from heuristic architecture evidence.`);
  }

  sendJson(res, 200, {
    from: serializeNodeWithFacet(fromNode, fromFacet),
    to: serializeNodeWithFacet(toNode, snapshot.facets.get(toNode.id)),
    entrypoint,
    paths: [hops],
    confidence: pathConfidence,
    warnings,
  });
}

const IMPACT_EDGE_KINDS: EdgeKind[] = [
  'calls',
  'references',
  'extends',
  'implements',
  'instantiates',
  'overrides',
  'decorates',
  'type_of',
  'returns',
];

function categoryForNode(node: Node, facet: NodeArchitectureFacet | undefined): string {
  const role = facet?.role?.toLowerCase() ?? '';
  const layer = facet?.layer;
  if (facet?.isEntrypoint || layer === 'entry' || layer === 'remote') return 'entrypoint';
  if (role.includes('service')) return 'service';
  if (role.includes('mapper') || role.includes('repository')) return 'mapper';
  if (role.includes('config') || role.includes('component')) return 'config';
  if (role.includes('entity') || role.includes('table')) return 'model';
  if (node.kind === 'field' || node.kind === 'property') return 'field';
  return 'other';
}

export async function handleArchitectureImpact(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  cg: CodeGraph
): Promise<void> {
  const parsed = url.parse(req.url || '', true);
  const nodeId = (parsed.query.nodeId as string | undefined)?.trim();
  const query = (parsed.query.query as string | undefined)?.trim();
  const depth = Math.min(Math.max(parseInt((parsed.query.depth as string) || '3', 10) || 3, 1), 5);
  const filters = parseFilters(parsed.query);

  const { node: target, warnings } = resolveNodeId(cg, nodeId, query);
  if (!target) {
    sendJson(res, 200, {
      node: null,
      depth,
      impact: { nodes: [], edges: [] },
      breakdown: { entrypoint: 0, service: 0, mapper: 0, sql: 0, field: 0, config: 0, other: 0 },
      riskLevel: 'low',
      recommendedTests: [],
      warnings,
    });
    return;
  }

  const subgraph = cg.traverse(target.id, {
    maxDepth: depth,
    direction: 'both',
    edgeKinds: IMPACT_EDGE_KINDS,
    includeStart: true,
  });

  const snapshot = await getArchitectureSnapshot(cg);

  // Apply role/layer/module/decorator filters server-side.
  const filteredNodes = Array.from(subgraph.nodes.values()).filter((n) =>
    matchesFilters(n, snapshot.facets.get(n.id), filters)
  );
  const allowedIds = new Set(filteredNodes.map((n) => n.id));
  const filteredEdges = subgraph.edges.filter(
    (e) => allowedIds.has(e.source) && allowedIds.has(e.target)
  );

  const breakdown: Record<string, number> = {
    entrypoint: 0,
    service: 0,
    mapper: 0,
    sql: 0,
    field: 0,
    config: 0,
    other: 0,
  };
  for (const n of filteredNodes) {
    const facet = snapshot.facets.get(n.id);
    const cat = categoryForNode(n, facet);
    breakdown[cat] = (breakdown[cat] || 0) + 1;
  }

  // SQL surface is any mapper/repository node for now; future SQL extraction
  // can increment this explicitly.
  breakdown.sql = breakdown.mapper || 0;

  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  if ((breakdown.entrypoint || 0) > 0) riskLevel = 'high';
  else if ((breakdown.service || 0) > 0 || (breakdown.mapper || 0) > 0) riskLevel = 'medium';

  const recommendedTests: string[] = [];
  for (const n of filteredNodes) {
    const facet = snapshot.facets.get(n.id);
    const cat = categoryForNode(n, facet);
    if (cat === 'entrypoint' || cat === 'service' || cat === 'mapper') {
      recommendedTests.push(`Test ${n.name}`);
    }
  }

  const elements = subgraphToCytoscape(
    { nodes: new Map(filteredNodes.map((n) => [n.id, n])), edges: filteredEdges },
    snapshot.facets
  );

  sendJson(res, 200, {
    node: serializeNodeWithFacet(target, snapshot.facets.get(target.id)),
    depth,
    impact: elements,
    breakdown,
    riskLevel,
    recommendedTests,
    warnings,
  });
}

// ---------------------------------------------------------------------------
// Registration surface
// ---------------------------------------------------------------------------

/**
 * Register all /api/architecture/* routes on the request handler.
 *
 * Callers pass the parsed pathname/segments and the active CodeGraph instance.
 * Returns true if the request was handled.
 */
export async function handleArchitectureRoute(
  pathname: string,
  segments: string[],
  req: http.IncomingMessage,
  res: http.ServerResponse,
  cg: CodeGraph
): Promise<boolean> {
  if (segments[0] !== 'api' || segments[1] !== 'architecture') return false;

  if (pathname === '/api/architecture/profiles' && req.method === 'GET') {
    await handleArchitectureProfiles(req, res, cg);
    return true;
  }
  if (pathname === '/api/architecture/overview' && req.method === 'GET') {
    await handleArchitectureOverview(req, res, cg);
    return true;
  }
  if (pathname === '/api/architecture/trace' && req.method === 'GET') {
    await handleArchitectureTrace(req, res, cg);
    return true;
  }
  if (pathname === '/api/architecture/impact' && req.method === 'GET') {
    await handleArchitectureImpact(req, res, cg);
    return true;
  }

  return false;
}
