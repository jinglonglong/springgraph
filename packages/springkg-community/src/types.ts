import type {
  FeatureCommunity as SharedFeatureCommunity,
  FeatureCommunityMember as SharedFeatureCommunityMember,
  SpringKgEdge,
  SpringKgNode,
} from '@jinglonglong/springkg-shared';

export interface FeatureCommunity extends SharedFeatureCommunity {
  dominantPackage: string;
  keywords?: string[];
  memberSpringNodeIds: string[];
}

export interface FeatureCommunityMember extends SharedFeatureCommunityMember {}

export interface BuildOptions {
  denylistKinds?: readonly string[];
  denylistNames?: readonly string[];
  packageAffinityDepth?: number;
  now?: () => number;
}

export interface PreparedStatementLike {
  run(...params: unknown[]): { changes?: number; lastInsertRowid?: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqliteDatabaseLike {
  prepare(sql: string): PreparedStatementLike;
  exec?(sql: string): void;
}

export interface SpringDatabase {
  getDb(): SqliteDatabaseLike;
}

export interface GraphSnapshot {
  nodes: SpringKgNode[];
  edges: SpringKgEdge[];
}

export type GraphLoader = () => Promise<GraphSnapshot>;
