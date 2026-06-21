
## [2026-06-19T10:05Z] Team A Phase 1 dependency

- Team A Phase 1 (packages/springkg-shared, packages/springkg-core, root package.json workspaces) has not landed.
- packages/ directory does not exist.
- Decision: bootstrap minimal local shared types inside packages/springkg-semantic/src/shared-types.ts so Team B can compile and test independently.
- When Team A lands, replace local imports with '@codegraph-springcloud/springkg-shared'.


## [2026-06-19T10:23Z] Root vitest discovery blocker

- 
px vitest run packages/springkg-semantic/__tests__/policy.test.ts fails from repo root with 'No test files found'.
- Root itest.config.ts includes only __tests__/**/*.test.ts, so package-local tests under packages/springkg-semantic/__tests__ are excluded.
- Package-local verification works with: 
px vitest run --config packages/springkg-semantic/vitest.config.ts packages/springkg-semantic/__tests__/policy.test.ts.
- This blocker is outside Team B owned files, so T68 implementation is complete but top-level plan checkbox cannot be honestly marked complete until cross-team/root test discovery is resolved.


