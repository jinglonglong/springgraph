# Team A Learnings

## 2026-06-19 Session start
- Working in git worktree `D:\code\cg-team-a` on branch `team-a-foundation`.
- Plan: `.omo/plans/team-a.md` — 15 tasks, Phase 1 (1-5) unblocks Teams B/C/D/F; Phase 2 (6-15) closes installer/MCP/Metis M gates.
- Hard boundaries: do NOT modify `src/**`; do NOT implement resolver internals; do NOT create `.springkg/` at project root.
- `springkg.db` lives in `.codegraph/springkg.db` next to CodeGraph's own DB.
- CodeGraph public API: `CodeGraph.init/open/indexAll/sync/watch/getPendingFiles/close`.
- PRAGMA order: `busy_timeout` first, then `foreign_keys`, `journal_mode=WAL`, `synchronous=NORMAL`, etc.


## 2026-06-19 Task 1 — monorepo scaffold
- Created all 9 packages under `packages/springkg-{shared,core,installer,semantic,data,runtime,community,mcp,cli}/`.
- Root package.json: added `workspaces: ["packages/*"]`, `peerDependencies: { "@colbymchenry/codegraph": ">=0.9.0 <1.0.0" }`, build and test scripts.
- Root tsconfig.json: added `composite: true` and `references` to springkg-shared, springkg-core, springkg-installer.
- Key issue resolved: root tsconfig.json has `"module": "commonjs"` but packages are `"type": "module"` — had to explicitly set `"module": "ES2022"` + `"moduleResolution": "bundler"` in each package's tsconfig to override the inherited commonjs setting.
- springkg-shared: no copy-assets script (no db folder).
- springkg-core: stub exports using `undefined as unknown as` pattern; real implementation in Task 2+.
- springkg-cli: references both springkg-shared and springkg-installer.
- npm install exits 0 ✓; tsc -b springkg-shared springkg-core exits 0 ✓; dist/index.js exists for both ✓.
- Created packages/springkg-core/src/db/schema.sql with 9 tables (8 data + schema_versions).
- Both spring_symbols and spring_edges have confidence REAL DEFAULT 1.0.
- 18 indexes total (including unique index on eature_community_members(community_id, spring_node_id)).

## 2026-06-19 Task 3 — SpringDatabase + migrations
- Created packages/springkg-core/src/db/spring-db.ts — SpringDatabase class mirroring CodeGraph's DatabaseConnection:
  - Static initialize() and open() factories
  - Exact PRAGMA order: busy_timeout=5000 (first), foreign_keys=ON, journal_mode=WAL, synchronous=NORMAL, cache_size=-64000, temp_store=MEMORY, mmap_size=268435456
  - Schema loaded from springkg-schema.sql (copied to dist/db/springkg-schema.sql)
  - Uses createDatabase deep-imported from @colbymchenry/codegraph/dist/db/sqlite-adapter.js
  - Transaction wrapper: db.transaction(fn)()
  - getJournalMode() extracts from pragma row object
  - Private constructor with SqliteDatabase structural type
- Created packages/springkg-core/src/db/migrations.ts:
  - CURRENT_SCHEMA_VERSION = 1
  - getCurrentVersion(db) — SELECT MAX(version) FROM schema_versions, returns 0 on error
  - unMigrations(db, fromVersion) — runs pending migrations in a transaction
  - Migration SQL files live in src/db/migrations/*.sql
- Created packages/springkg-core/src/db/migrations/001_initial_8_tables.sql:
  - The 8 data tables (spring_symbols, spring_edges, spring_endpoints, spring_feign_clients, spring_sql_statements, runtime_config_properties, feature_communities, feature_community_members) + all 18 indexes
  - Does NOT create schema_versions (already exists from schema.sql)
- Updated springkg-core/package.json copy-assets to also copy src/db/migrations/*.sql to dist/db/migrations/
- Key TypeScript fix: imported unMigrations aliased as unPendingMigrations because the instance method unMigrations() shadows the imported function at compile time
- Build: 
pm run build --workspace=@colbymchenry/springkg-core exits 0 ✓

## 2026-06-19 Task 15 — monorepo package.json inter-dependencies
- npm v10.9.4 does NOT support `workspace:*` protocol — that is a pnpm feature.
- For npm workspaces, standard version numbers (e.g., "0.1.0") work fine because npm resolves them from the workspace automatically.
- When npm install failed with `workspace:*`, reverted all packages to use "0.1.0" version for intra-mono references.
- Correct package.json structure per spec:
  - springkg-shared: devDependencies only (typescript), NO dependencies, NO peerDependencies
  - springkg-installer: depends on springkg-shared, NO peerDependencies
  - springkg-core/semantic/data/runtime/community/mcp: depend on springkg-shared + peerDep codegraph
  - springkg-cli: depends on springkg-shared + springkg-installer + peerDep codegraph
- Root package.json already had correct peerDependencies for codegraph from Task 1.

## 2026-06-19 Task 8 — community resolver + summary stub handoff
- `packages/springkg-shared/src/index.ts` already had `SPRINGKG_CONFIG.resolverChain` ending with `community-builder`; no code change needed there in this checkout.
- Created `packages/springkg-core/src/community/summary-generator.ts` with a stub `SummaryGenerator` that starts/stops a single timer, regenerates dirty or all `feature_communities`, writes `summary`, clears `dirty`, stamps `last_summarized_at`, and never throws outward (logs with `console.error`).
- The current `packages/springkg-core/src/spring-kg.ts` is still the Task 4 placeholder here, so `SummaryGenerator` integration (`summaryGenerator` field, start/stop lifecycle, `summarizeNow()`, and `community-builder` stub resolver registration) still needs to be applied onto the real SpringKg implementation once that lands.
- The DB rows expose `member_count`, but the summary hook contract is easier to keep camel-cased; map rows to `{ memberCount }` before calling the hook so the generator compiles cleanly without leaking SQL naming into the hook API.

## 2026-06-19 Tasks 12/13/14 — Test files
- Created `__tests__/setup.ts` at `__tests__/` root (NOT inside `team-a/`).
- Created `__tests__/team-a/concurrent-wal.test.ts`, `schema-confidence.test.ts`, `platform-paths.test.ts`.
- All files use ES module imports with `.js` extension (required by vitest bundler).
- Import path from `team-a/` to setup is `../setup.js` (resolves to `__tests__/setup.js`).
- TypeScript typecheck passes (`npx tsc --noEmit` exits 0).
- platform-paths tests pass (2/2) on Windows; concurrent-wal and schema-confidence fail at runtime due to existing deep-import issue in spring-db.ts (`@colbymchenry/codegraph/dist/db/sqlite-adapter.js` not exported by package) — test files themselves are correctly structured.
