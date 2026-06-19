// packages/springkg-shared/src/index.ts

// -----------------------------------------------------------------------------
// Node / Edge kinds — union of all per-team symbol/edge kinds.
// -----------------------------------------------------------------------------

export const SPRINGKG_NODE_KINDS = [
  // Team A (none — only schema owner)
  // Team B (semantic)
  'controller', 'service', 'repository', 'component',
  'feign_client', 'feign_method', 'endpoint', 'remote_service',
  // Team C (data)
  'mapper', 'mapper_method', 'sql_statement', 'entity', 'table', 'column',
  // Team D (runtime)
  'config_property', 'middleware', 'nacos_cluster', 'nacos_config', 'gateway_route',
  // Team F (community)
  'feature_community', 'feature_community_member',
] as const;
export type SpringKgNodeKind = (typeof SPRINGKG_NODE_KINDS)[number];

export const SPRINGKG_EDGE_KINDS = [
  // Team B
  'HANDLED_BY', 'CALLS', 'BELONGS_TO', 'CALLS_FEIGN', 'TARGETS_ENDPOINT',
  // Team C
  'EXECUTES_SQL', 'READS_TABLE', 'WRITES_TABLE', 'MAPS_TO_TABLE', 'BIND_TO',
  // Team D
  'CONNECTS_TO', 'LOADS_CONFIG', 'ROUTES_TO',
  // Team F
  'MEMBER_OF',
] as const;
export type SpringKgEdgeKind = (typeof SPRINGKG_EDGE_KINDS)[number];

// -----------------------------------------------------------------------------
// Core node / edge records persisted to springkg.db
// -----------------------------------------------------------------------------

export interface SpringKgNode {
  id: string;                         // deterministic: `${kind}:${sha256(...).slice(0,32)}`
  kind: SpringKgNodeKind;
  codegraphNodeId: string;            // FK into CodeGraph's nodes table
  name?: string;
  qualifiedName?: string;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  metadata?: Record<string, unknown>;
  confidence: number;                 // 0.0-1.0 (Metis M fix; default 1.0)
  createdAt: number;
  updatedAt: number;
}

export interface SpringKgEdge {
  id: string;
  sourceId: string;                   // SpringKgNode.id
  targetId: string;                   // SpringKgNode.id
  kind: SpringKgEdgeKind;
  metadata?: Record<string, unknown>;
  confidence: number;                 // 0.0-1.0 (Metis M fix; default 1.0)
  createdAt: number;
}

export interface SpringKgEndpoint {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD' | '*';
  path: string;
  handlerClassId?: string;            // SpringKgNode.id (controller)
  handlerMethodId?: string;           // SpringKgNode.id
  sourceFilePath: string;
  sourceLine: number;
}

export interface SpringKgFeignClient {
  id: string;
  clientName: string;                 // e.g. "UserClient"
  targetService: string;              // e.g. "user-service" (from @FeignClient name)
  targetUrl?: string;                 // from @FeignClient url=
  methodCount: number;
}

export interface SpringKgSqlStatement {
  id: string;
  mapperId: string;                   // SpringKgNode.id (mapper)
  sqlHash: string;                  // sha256 of normalized SQL
  sqlText: string;                  // canonicalized
  parameterCount: number;
  tables: string[];                   // derived
  sourceFilePath: string;
  sourceLine: number;
}

export interface RuntimeConfigProperty {
  id: string;
  key: string;
  valueHash: string;                  // sha256 of value (sensitive values are redacted)
  isSensitive: boolean;               // true iff key matches SPRINGKG_CONFIG.sensitiveKeyPatterns
  sourceFilePath: string;
  sourceLine: number;
  beanId?: string;                    // @ConfigurationProperties prefix
}

export interface FeatureCommunity {
  id: string;
  label: string;
  summary: string;
  memberCount: number;
  dirty: boolean;                     // true until SummaryGenerator runs
  lastSummarizedAt?: number;
}

export interface FeatureCommunityMember {
  communityId: string;
  springNodeId: string;               // SpringKgNode.id
  membershipScore: number;
}

// -----------------------------------------------------------------------------
// Resolver contract (Teams B / C / D / F implement this)
// -----------------------------------------------------------------------------

export interface SpringKgEnhanceInput {
  codegraphNodes: ReadonlyArray<{ id: string; kind: string; name: string; filePath: string; [k: string]: unknown }>;
  codegraphEdges: ReadonlyArray<{ id: string; source: string; target: string; kind: string; [k: string]: unknown }>;
  /** Absolute file paths that changed since the last enhance call. */
  changedFiles: ReadonlyArray<string>;
  /** Active CodeGraph instance (use for ad-hoc queries). */
  cg: { getNode(id: string): unknown; getOutgoingEdges(id: string): unknown[]; getIncomingEdges(id: string): unknown[]; getNodesInFile(path: string): unknown[]; [k: string]: unknown };
}

export interface SpringKgEnhanceOutput {
  symbolsAdded: number;
  edgesAdded: number;
  byKind: Record<string, number>;
}

export interface Resolver {
  /** Unique name, used for log lines and idempotency checks. */
  readonly name: string;
  /** Optional: declared kind of nodes this resolver emits. Used for diagnostics only. */
  readonly emitsKinds?: ReadonlyArray<SpringKgNodeKind>;
  /** Called after every sync. Must be idempotent — same input twice MUST yield same output. */
  enhance(input: SpringKgEnhanceInput): Promise<SpringKgEnhanceOutput>;
}

// -----------------------------------------------------------------------------
// Shared config (Team A owns; Teams B–G read)
// -----------------------------------------------------------------------------

export const SPRINGKG_CONFIG = {
  version: '0.1.0',
  db: {
    filename: 'springkg.db',         // always inside .codegraph/
    journalMode: 'wal' as const,
    busyTimeoutMs: 5000,
    synchronous: 'NORMAL' as const,
  },
  mcp: {
    name: 'springkg-mcp',
    version: '0.1.0',
  },
  sensitiveKeyPatterns: [
    /password/i, /passwd/i, /secret/i, /token/i,
    /access[-_]?key/i, /api[-_]?key/i, /private[-_]?key/i,
    /credential/i, /auth/i,
  ] as const,
  /** Resolver execution order (append to this list as new resolvers land). */
  resolverChain: [
    // Team B
    'annotation-engine', 'endpoint-resolver', 'feign-resolver',
    'feign-provider-bridge', 'feign-request-response-type',
    // Team D
    'config-resolver', 'middleware-inventory',
    'nacos-config-resolver', 'config-property-usage-tracker', 'gateway-route-resolver',
    // Team C
    'mybatis-xml-extractor', 'annotation-sql-extractor',
    'sql-table-column', 'mapper-binding', 'mybatis-plus',
    // Team F (after per-file resolvers)
    'community-builder',
  ] as const,
  /** Async summary generation cadence (Metis M — manual + timer). */
  summaryRegeneration: {
    intervalMs: 60_000,                // 60s timer
    triggerOn: ['manual', 'timer', 'dirty-count-100'] as const,
  },
} as const;
