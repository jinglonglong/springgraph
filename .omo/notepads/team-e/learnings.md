# Learnings

> Document key insights, discoveries, and knowledge gained during the project.

## 2026-06-19

- (initial entry)

## ESM Directory Import Fix (spring-db.ts)

- In Node.js ESM, omitting file extensions from relative imports (`from './migrations'`) relies on directory import resolution, which can fail on Windows due to case-insensitive filesystem semantics and ESM's stricter module resolution rules. Always use explicit `.js` extensions in ESM relative imports.
- The `node:sqlite` built-in module is not available as a type declaration in TypeScript < 5.9 / @types/node < 22. This is a pre-existing issue unrelated to import resolution; `--skipLibCheck` does not help since it's a missing module declaration, not a type mismatch.

## ESM ReferenceError Fix (spring-db.ts)

- `require()` inside an ES module file throws `ReferenceError: require is not defined` at runtime on Node.js ESM. Replacing `const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')` with a proper `import { DatabaseSync } from 'node:sqlite'` fixes this and also removes the type-assertion workaround.

## Web Server Compilation Fix (server.ts)

- Team G introduced `getDecorators(limit)` and `getEdgesForNodes(topIds)` methods on `CodeGraph` for the web UI overview/search features, but these methods were never implemented on the main `CodeGraph` class. Stubs returning empty arrays `[]` resolve the compilation errors while preserving the API surface for future implementation.
- The `decorators` option in `cg.searchNodes()` was also not part of the official `CodeGraph` search API, so removing it from the call site resolves the type mismatch.
- Pre-existing build failure: `springkg-semantic` package has `"composite": false` in its tsconfig but is referenced from the root `tsconfig.json` (which requires composite projects). This is unrelated to server.ts changes.

## springkg-semantic tsconfig composite flag

- The `packages/springkg-semantic/tsconfig.json` already had `"composite": true` set. No change was required — the build compiles successfully with this configuration. All springkg packages referenced from the root `tsconfig.json` must have `"composite": true` to satisfy TypeScript project references.
