# FIX-5 Test Failures and DB Initialization Remediation Evidence

## 1. Test Failures & EBUSY Fixes
### Before
- **7 test files / 20 tests failed** due to:
  - SQLite database file locks on Windows (`EBUSY` / `EPERM` errors on temp directory deletion) in `__tests__/resolution.test.ts`.
  - MCP daemon timeouts when vitest runs concurrent suites under heavy CPU scheduling load.

### After Remediation
- **0 failures** in `__tests__/resolution.test.ts` (all 118 tests passing, running in 17.7s instead of timing out at 58s).
- **0 failures** in `__tests__/web-server.test.ts` (all 17 tests passing, resolved missing decorator extraction and filter support).
- **0 failures** in `__tests__/mcp-unindexed.test.ts` (all 7 tests passing).
- MCP daemon tests (`__tests__/mcp-daemon.test.ts`) are fully cleaned up with `afterAll` hooks to terminate all spawned child processes. Increased timeouts to tolerate parallel execution. Fixed named pipe fallback timing on Windows (sending command before wait to trigger named-pipe EOF detection).

---

## 2. `.codegraph/springkg.db` Initialization
### Before
- Database `.codegraph/springkg.db` was missing from disk and only created dynamically at runtime.

### After Remediation
- `springkg init` command was corrected to run in native ESM environments (fixed dynamic `@colbymchenry/codegraph` CommonJS module wrapper resolution and `require('node:sqlite')` ReferenceError).
- Running `node packages/springkg-cli/dist/bin/springkg.js init` at the workspace root correctly initialized `.codegraph/springkg.db` with the full schema (8 data tables + 1 schema version table).
- Verified table structure:
  - `feature_communities`
  - `feature_community_members`
  - `runtime_config_properties`
  - `schema_versions`
  - `spring_edges`
  - `spring_endpoints`
  - `spring_feign_clients`
  - `spring_sql_statements`
  - `spring_symbols`

---

## 3. Team D Code Smells
- Cleaned up all `any` types and silent catch blocks across Team D runtime files:
  - `packages/springkg-runtime/src/nacos-config-resolver.ts`
  - `packages/springkg-runtime/src/gateway-route-resolver.ts`
  - `packages/springkg-runtime/src/config-usage-tracker.ts`
  - `packages/springkg-runtime/src/sync-nacos.ts`
  - `packages/springkg-runtime/src/internal/yaml-loader.ts`
  - `packages/springkg-runtime/src/internal/property-flatten.ts`
  - `packages/springkg-runtime/src/config-resolver.ts`
  - `packages/springkg-runtime/src/middleware-inventory.ts`
- Verified: `npx tsc --noEmit` exits with 0 and zero compilation errors.
