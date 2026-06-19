// packages/springkg-semantic/src/shared-types.ts
//
// Backward-compatibility shim. All Team B source files import from
// `./shared-types`. That path now resolves to `./team-b-types`, which
// re-exports the real `@colbymchenry/springkg-shared` types and adds the
// Team B-owned extensions (configuration/bean/dto node kinds,
// references/USES_DTO edge kinds, TeamBEnhanceOutput wrapper, cg stub).

export type {
  SpringKgNodeKind as _SharedSpringKgNodeKind,
  SpringKgEdgeKind as _SharedSpringKgEdgeKind,
} from '@colbymchenry/springkg-shared';

export {
  SPRINGKG_NODE_KINDS,
  SPRINGKG_EDGE_KINDS,
} from '@colbymchenry/springkg-shared';

export type {
  TeamBNodeKind as SpringKgNodeKind,
  TeamBEdgeKind as SpringKgEdgeKind,
  SpringKgNode,
  SpringKgEdge,
  TeamBEnhanceOutput as SpringKgEnhanceOutput,
  CodegraphNodeLike,
  CodegraphEdgeLike,
  TeamBResolver as Resolver,
  TeamBEnhanceInput as SpringKgEnhanceInput,
  CodegraphCgStub,
} from './team-b-types';

export { makeCodegraphStub } from './team-b-types';