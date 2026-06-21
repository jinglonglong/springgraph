import { DatabaseConnection } from '../db';
import { Node } from '../types';

/**
 * ArchitectureLayer represents the logical tier/layer of a component.
 */
export type ArchitectureLayer =
  | 'entry'      // HTTP endpoints, Schedulers, Event Listeners
  | 'remote'     // RPC/Feign clients, external integrations
  | 'business'   // Service layer, business logic
  | 'data'       // Data access layer, Mappers, Repositories
  | 'model'      // Domain entities, DTOs, value objects
  | 'infra'      // Infrastructure configuration, components
  | 'unknown';

/**
 * ArchitectureRole represents the specific architectural role of a symbol.
 * e.g., "Controller", "Service", "Mapper", "Entity", "Config", etc.
 */
export type ArchitectureRole = string;

/**
 * ArchitectureContext provides necessary database and environment access
 * for ArchitectureFacets to execute detection logic.
 */
export interface ArchitectureContext {
  /** Database connection to query the knowledge graph */
  db: DatabaseConnection;

  /** Root directory of the indexed project */
  projectRoot: string;

  /** Optional helper to get all nodes of interest */
  getNodes?(): Promise<Node[]>;
}

/**
 * ArchitectureSignal represents a piece of evidence detected by a facet.
 */
export interface ArchitectureSignal {
  /** The node ID this signal applies to, if node-specific */
  nodeId?: string;

  /** Name of the facet that detected this signal */
  facetName: string;

  /** Name of the architecture profile containing the facet */
  profileName: string;

  /** Confidence score between 0.0 and 1.0 */
  confidence: number;

  /** Human-readable evidence/proof messages */
  evidence: string[];

  /** Optional scope of the signal */
  scope?: 'project' | 'module' | 'file' | 'node';

  /** Optional file path where the signal was detected */
  filePath?: string;

  /** Optional module/service name */
  module?: string;

  /** Optional extra metadata */
  metadata?: Record<string, any>;
}

/**
 * NodeArchitectureFacet represents the final architectural classification of a single node.
 */
export interface NodeArchitectureFacet {
  /** The unique ID of the node */
  nodeId: string;

  /** Name of the facet that classified this node */
  facetName: string;

  /** Confidence score between 0.0 and 1.0 */
  confidence: number;

  /** Human-readable evidence supporting this classification */
  evidence: string[];

  /** The assigned architectural role */
  role?: ArchitectureRole;

  /** The assigned logical layer */
  layer?: ArchitectureLayer;

  /** Associated architecture profile name/ID */
  profileId?: string;

  /** Associated module name (e.g. Maven module) */
  module?: string;

  /** Package name of the node */
  packageName?: string;

  /** Whether the node serves as an application entry point */
  isEntrypoint?: boolean;
}

/**
 * ArchitectureProfileMatch represents the match status of a profile against a project.
 */
export interface ArchitectureProfileMatch {
  /** Name of the profile (e.g., "spring-cloud") */
  profileName: string;

  /** Overall confidence score between 0.0 and 1.0 */
  confidence: number;

  /** Number of nodes matching this profile */
  nodeCount: number;

  /** Count of nodes per logical layer */
  layerBreakdown: Record<string, number>;

  /** Count of nodes per architectural role */
  roleBreakdown: Record<string, number>;

  /** Detected signals relevant to this profile match */
  signals: ArchitectureSignal[];
}

/**
 * ProfileDetectionResult represents the final selection of the active profile.
 */
export interface ProfileDetectionResult {
  /** Name of the selected active profile (or null if none match sufficiently) */
  activeProfile: string | null;

  /** List of all profile matches sorted by confidence descending */
  allMatches: ArchitectureProfileMatch[];

  /** Warnings generated during detection (e.g. conflicts, missing files) */
  warnings: string[];
}

/**
 * RoleConflict represents a situation where multiple facets or rules
 * assign different architectural roles to the same node.
 */
export interface RoleConflict {
  /** The node with the conflict */
  nodeId: string;

  /** List of competing roles and their scores */
  roles: {
    role: ArchitectureRole;
    confidence: number;
    facetName: string;
  }[];

  /** The role selected after conflict resolution */
  resolvedRole?: ArchitectureRole;
}

/**
 * ArchitectureSnapshot bundles the project-level profile detection result,
 * the resolved active profile, and the per-node facet map. This is the shape
 * consumed by the web UI's /api/architecture/* handlers.
 */
export interface ArchitectureSnapshot {
  result: ProfileDetectionResult;
  profile: ArchitectureProfile;
  facets: Map<string, NodeArchitectureFacet>;
  nodes: Node[];
}

/**
 * FacetSignalAggregator acts as a helper state machine for the facet engine
 * to accumulate signals and derive final facet results.
 */
export interface FacetSignalAggregator {
  /** Maps nodeId to its accumulated signals */
  nodeSignals: Map<string, ArchitectureSignal[]>;

  /** Accumulated project-level signals */
  globalSignals: ArchitectureSignal[];

  /** Add a single signal to the aggregator */
  addSignal(signal: ArchitectureSignal): void;

  /** Add multiple signals to the aggregator */
  addSignals(signals: ArchitectureSignal[]): void;

  /** Aggregate all signals and return the final per-node classification list */
  aggregate(): NodeArchitectureFacet[];
}

/**
 * ArchitectureFacet represents an individual detector that analyzes
 * the graph to find architectural signals.
 */
export interface ArchitectureFacet {
  /** Unique ID of the facet */
  id: string;

  /** Human-readable name of the facet */
  name: string;

  /** Optional description of what this facet detects */
  description?: string;

  /** Executes detection logic against the context and returns signals */
  detect(context: ArchitectureContext): ArchitectureSignal[] | Promise<ArchitectureSignal[]>;
}

/**
 * ArchitectureProfile defines the rules and metadata for a specific architecture pattern.
 */
export interface ArchitectureProfile {
  /** Unique ID of the profile (e.g., "spring-cloud") */
  id: string;

  /** Human-readable name of the profile */
  name: string;

  /** Description of the architecture pattern */
  description: string;

  /** List of facet IDs this profile uses */
  facetIds: string[];

  /** Supported logical layers */
  layers: {
    id: ArchitectureLayer;
    label: string;
    tier: number;
  }[];

  /** Supported architectural roles */
  roles: {
    id: string;
    label: string;
    layerId: ArchitectureLayer;
    entrypoint?: boolean;
  }[];

  /** Evaluates signals to calculate match confidence and breakdown */
  detect(signals: ArchitectureSignal[]): ArchitectureProfileMatch;
}
