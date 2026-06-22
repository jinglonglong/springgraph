export const SPRINGKG_PACKAGE = '@jinglonglong/springkg-community' as const;

export { CommunityBuilder } from './community-builder.js';
export { SummaryGenerator } from './summary-generator.js';
export { DirtyQueue } from './dirty-queue.js';

export type {
  BuildOptions,
  FeatureCommunity,
  FeatureCommunityMember,
  GraphLoader,
  SpringDatabase,
  SqliteDatabaseLike,
} from './types.js';
