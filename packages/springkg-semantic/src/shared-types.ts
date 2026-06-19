// Local stub for Team-A-owned shared types.
// Replace these with '@codegraph-springcloud/springkg-shared' imports once Team A Phase 1 lands.

/** Spring-specific node kinds for the springkg knowledge graph. */
export type SpringKgNodeKind =
  | 'controller'
  | 'service'
  | 'repository'
  | 'component'
  | 'configuration'
  | 'mapper'
  | 'feign_client'
  | 'feign_method'
  | 'endpoint'
  | 'remote_service'
  | 'dto'
  | 'bean';

/** Spring-specific edge kinds for the springkg knowledge graph. */
export type SpringKgEdgeKind =
  | 'HANDLED_BY'
  | 'CALLS'
  | 'BELONGS_TO'
  | 'CALLS_FEIGN'
  | 'TARGETS_ENDPOINT'
  | 'references'
  | 'USES_DTO';

/** Minimal node shape — compatible subset of root src/types.ts CodeGraph node. */
export interface CodegraphNodeLike {
  id: string;
  kind: string;
  name: string;
  qualifiedName: string;
  filePath: string;
  language: string;
  startLine: number;
  endLine: number;
  decorators?: string[];
  signature?: string;
  returnType?: string;
  visibility?: string;
  isExported?: boolean;
  isStatic?: boolean;
  isAbstract?: boolean;
  updatedAt?: number;
  metadata?: Record<string, unknown>;
}

/** Minimal edge shape — compatible subset of root src/types.ts CodeGraph edge. */
export interface CodegraphEdgeLike {
  source: string;
  target: string;
  kind: string;
  metadata?: Record<string, unknown>;
  line?: number;
  column?: number;
}

/** A Spring knowledge-graph node (standalone — does NOT extend CodegraphNodeLike). */
export interface SpringKgNode {
  id: string;
  kind: SpringKgNodeKind;
  codegraphNodeId: string;
  name?: string;
  qualifiedName?: string;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  metadata?: Record<string, unknown>;
  confidence: number;
  createdAt: number;
  updatedAt: number;
}

/** A Spring knowledge-graph edge. */
export interface SpringKgEdge {
  id: string;
  sourceId: string;
  targetId: string;
  kind: SpringKgEdgeKind;
  metadata?: Record<string, unknown>;
  confidence: number;
  createdAt: number;
}

/** Input for a resolver to enhance the graph with Spring semantics. */
export interface SpringKgEnhanceInput {
  codegraphNodes: CodegraphNodeLike[];
  codegraphEdges: CodegraphEdgeLike[];
  changedFiles?: string[];
}

/** Output from a resolver's semantic enhancement pass. */
export interface SpringKgEnhanceOutput {
  symbolsAdded: number;
  edgesAdded: number;
  byKind: Record<string, number>;
  nodes: SpringKgNode[];
  edges: SpringKgEdge[];
}

/** Resolver contract — each resolver has a name and an enhance method. */
export interface Resolver {
  name: string;
  enhance(input: SpringKgEnhanceInput): Promise<SpringKgEnhanceOutput>;
}
