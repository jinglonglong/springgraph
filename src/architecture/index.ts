export { ArchitectureTraceEngine, traceArchitecture } from './trace';
export { ArchitectureImpactEngine, impactArchitecture } from './impact';
export { inferArchitecture, inferRoleFromNode, inferLayerForRole } from './node-role-helpers';
export type { ArchitectureTraceInput, ArchitectureTraceResult, ArchitectureTracePath, ArchitectureTraceHop, ArchitectureTraceEntrypoint } from './trace';
export type { ArchitectureImpactInput, ArchitectureImpactResult, ArchitectureImpactBreakdown, ArchitectureRecommendedTest } from './impact';
export type { InferredArchitecture } from './node-role-helpers';
