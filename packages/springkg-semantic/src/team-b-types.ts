// packages/springkg-semantic/src/team-b-types.ts
//
// Team B-owned extensions on top of the real `@colbymchenry/springkg-shared`
// package that Team A landed. This file is the ONLY place where Team B adds
// types beyond what the shared package already exposes.
//
// Why we need this file at all:
//   1. `SpringKgEnhanceOutput` from the shared package deliberately omits
//      `nodes` / `edges` arrays — but Team B's tests inspect those arrays to
//      verify resolver behavior. We keep a `TeamBEnhanceOutput` wrapper that
//      extends the real output with those arrays so test coverage is preserved.
//   2. `SPRINGKG_NODE_KINDS` does not yet include `configuration`, `bean`, or
//      `dto` (Team B's T12 / T42 emission surface). Team B local-extends the
//      union; once Team A merges these into the shared kind list, the
//      extensions become no-ops.
//   3. `SPRINGKG_EDGE_KINDS` does not include `references` or `USES_DTO`.
//      Team B emits `USES_DTO` per T42 and `references` as the documented
//      fallback. We local-extend the edge union until Team A promotes them.
//   4. `SpringKgEnhanceInput` requires `cg` (CodeGraph instance) and a
//      non-empty `changedFiles` array. Team B resolvers currently do not use
//      `cg`, but the contract now mandates it. We expose a `makeCodegraphStub`
//      helper so tests can satisfy the contract without dragging in the
//      real CodeGraph class.

import type {
  SpringKgEdge as SharedSpringKgEdge,
  SpringKgEdgeKind as SharedSpringKgEdgeKind,
  SpringKgEnhanceOutput as SharedSpringKgEnhanceOutput,
  SpringKgNode as SharedSpringKgNode,
  SpringKgNodeKind as SharedSpringKgNodeKind,
} from '@colbymchenry/springkg-shared';

export {
  SPRINGKG_NODE_KINDS,
  SPRINGKG_EDGE_KINDS,
  SPRINGKG_CONFIG,
} from '@colbymchenry/springkg-shared';

// ---- Team B local extensions ---------------------------------------------

/** Team B's superset of node kinds: shared kinds + Team B-owned additions. */
export type TeamBNodeKind =
  | SharedSpringKgNodeKind
  | 'configuration'
  | 'bean'
  | 'dto';

/** Team B's superset of edge kinds: shared kinds + Team B-owned additions. */
export type TeamBEdgeKind =
  | SharedSpringKgEdgeKind
  | 'references'
  | 'USES_DTO';

/**
 * Re-declared with Team B's superset kinds. Structurally compatible with
 * `SpringKgNode` because the fields are identical; only the `kind` union is
 * wider.
 */
export interface SpringKgNode extends Omit<SharedSpringKgNode, 'kind'> {
  kind: TeamBNodeKind;
}

/** Re-declared with Team B's superset edge kinds. */
export interface SpringKgEdge extends Omit<SharedSpringKgEdge, 'kind'> {
  kind: TeamBEdgeKind;
}

/**
 * Team B wrapper around the real shared output. The shared output deliberately
 * carries only aggregate counts (`symbolsAdded`, `edgesAdded`, `byKind`); for
 * Team B test ergonomics we attach the actual `nodes` / `edges` arrays so
 * existing assertions like `result.nodes[0]?.kind` keep working.
 */
export interface TeamBEnhanceOutput extends SharedSpringKgEnhanceOutput {
  nodes: SpringKgNode[];
  edges: SpringKgEdge[];
}

/**
 * CodeGraph-compatible node shape that Team B resolvers consume. The real
 * shared `SpringKgEnhanceInput.codegraphNodes` uses `[k: string]: unknown`,
 * so any extra fields (`decorators`, `signature`, `qualifiedName`,
 * `startLine`, ...) flow through the index signature without TS friction.
 */
export interface CodegraphNodeLike {
  id: string;
  kind: string;
  name: string;
  filePath: string;
  qualifiedName?: string;
  language?: string;
  startLine?: number;
  endLine?: number;
  decorators?: string[];
  signature?: string;
  returnType?: string;
  visibility?: 'public' | 'private' | 'protected' | 'internal';
  isExported?: boolean;
  isStatic?: boolean;
  isAbstract?: boolean;
  metadata?: Record<string, unknown>;
  updatedAt?: number;
  [k: string]: unknown;
}

/**
 * CodeGraph-compatible edge shape. The real shared input uses
 * `[k: string]: unknown`, so `line`, `column`, `provenance` etc. flow through.
 */
export interface CodegraphEdgeLike {
  id?: string;
  source: string;
  target: string;
  kind: string;
  metadata?: Record<string, unknown>;
  line?: number;
  column?: number;
  provenance?: 'tree-sitter' | 'scip' | 'heuristic';
  [k: string]: unknown;
}

/**
 * Team B-flavoured resolver contract. Resolvers consume `TeamBEnhanceInput`
 * (which adds the `cg` stub + required `changedFiles`) and return
 * `TeamBEnhanceOutput` (which carries the per-row `nodes`/`edges` arrays).
 */
export interface TeamBResolver {
  readonly name: string;
  readonly emitsKinds?: ReadonlyArray<TeamBNodeKind>;
  enhance(input: TeamBEnhanceInput): Promise<TeamBEnhanceOutput>;
}

/** Team B-flavoured enhance input: requires `cg` + non-empty `changedFiles`. */
export interface TeamBEnhanceInput {
  codegraphNodes: ReadonlyArray<CodegraphNodeLike>;
  codegraphEdges: ReadonlyArray<CodegraphEdgeLike>;
  changedFiles: ReadonlyArray<string>;
  cg: CodegraphCgStub;
}

/**
 * Minimal stand-in for a real CodeGraph instance. Team B resolvers do not
 * currently call into `cg`; once they do, callers should inject the real
 * `CodeGraph` class instance.
 */
export interface CodegraphCgStub {
  getNode(id: string): unknown;
  getOutgoingEdges(id: string): unknown[];
  getIncomingEdges(id: string): unknown[];
  getNodesInFile(path: string): unknown[];
  [k: string]: unknown;
}

/**
 * Build a no-op `cg` stub. Tests inject this when constructing
 * `TeamBEnhanceInput` so they can satisfy the shared input contract without
 * pulling in the real CodeGraph runtime.
 */
export function makeCodegraphStub(): CodegraphCgStub {
  return {
    getNode: () => undefined,
    getOutgoingEdges: () => [],
    getIncomingEdges: () => [],
    getNodesInFile: () => [],
  };
}

/**
 * Back-compat alias: the resolver files imported `Resolver` from
 * `./shared-types` — keep that name working by re-exporting the shared
 * `Resolver` interface here.
 */
export type { Resolver as SharedResolverContract } from '@colbymchenry/springkg-shared';