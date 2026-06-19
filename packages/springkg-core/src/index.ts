// packages/springkg-core/src/index.ts
// Real implementation of SpringKg and SpringDatabase will be added in subsequent tasks.
// This index.ts re-exports from the actual implementation modules.

export { SpringKg } from './spring-kg.js';
export { SpringDatabase } from './db/spring-db.js';
export type { Resolver as SpringKgResolver, SpringKgEnhanceInput, SpringKgEnhanceOutput } from '@colbymchenry/springkg-shared';
