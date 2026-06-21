Build PASS | Tests 1712/1749 | Files 51 clean/11 issues | VERDICT: FAIL

# F2 Code Quality Review (2026-06-20)

## Scope

- Ran the required repo-wide verification commands from `D:/code/codegraph-springcloud`
- Reviewed source files under `packages/springkg-*/src/`
- Verified DB location requirements
- Checked modified-file ownership against the springcloud team map

## Command evidence

### Required commands run

1. `npm test 2>&1 | tee /tmp/f2-test.log`
2. `npx tsc --noEmit 2>&1 | tee /tmp/f2-tsc.log`
3. `npm run build 2>&1 | tee /tmp/f2-build.log`
4. `ls -la .codegraph/ 2>&1`
5. `ls -la .springkg/ 2>&1`
6. `git status --short`

### Captured outputs

- Test log: `/tmp/f2-test.log` (`124123` bytes)
- TypeScript log: `/tmp/f2-tsc.log` (`0` bytes; no diagnostics emitted)
- Build log: `/tmp/f2-build.log` (`849` bytes)

### Build / typecheck results

- `npx tsc --noEmit`: **PASS** (empty log, exit succeeded)
- `npm run build`: **PASS**

### Test results

- `npm test`: **FAIL**
- Summary from captured run:
  - Test files: **102 passed / 111 total**, **7 failed**, **2 skipped**
  - Tests: **1712 passed / 1749 total**, **20 failed**, **17 skipped**
  - Duration: **133.19s**

### Failed test inventory

The failing suite is dominated by Windows `EBUSY` cleanup/teardown failures and MCP/daemon timing issues:

- `__tests__/node-sqlite-backend.test.ts`
  - hook timeout in `node:sqlite backend — real index + queries`
  - `EBUSY` unlink on temp `.codegraph/codegraph.db`
- `__tests__/frameworks-integration.test.ts`
  - 3 JVM import tests failed with `EBUSY` unlink on temp `.codegraph/codegraph.db`
- `__tests__/mcp-daemon.test.ts`
  - 2 timeouts
  - 4 `EBUSY` temp-dir cleanup failures
- `__tests__/mcp-initialize.test.ts`
  - 3 `EBUSY` temp-dir cleanup failures
- `__tests__/mcp-roots.test.ts`
  - 3 `EBUSY` temp-dir cleanup failures
- `__tests__/react-native-bridge.test.ts`
  - 1 timeout
  - 1 `EBUSY` unlink failure
- `__tests__/resolution.test.ts`
  - 4 `EBUSY` unlink failures

This matches the repo's documented Windows-specific failure pattern in `CLAUDE.md` for MCP temp-dir cleanup and file-locking, but the required full suite still **failed in this environment**.

## DB location verification

### Project-root `.codegraph/`

Observed from `ls -la .codegraph/`:

- `.codegraph/codegraph.db` exists
- `.codegraph/springkg.db` **does not exist** at the repo root

### Forbidden `.springkg/`

- `ls -la .springkg/` failed with `No such file or directory`
- Therefore `.springkg/` is **absent**, which is correct

### DB location verdict

- `.codegraph/springkg.db exists`: **FAIL**
- `.springkg/ does NOT exist`: **PASS**

## Source inventory reviewed

Reviewed `62` source files under `packages/springkg-*/src/`.

- `51` files: no actionable code-quality issue found in this pass
- `11` files: actionable code-quality or boundary/ownership issues found

## Code-quality issues (file:line)

### 1) Team E file contains Team G self-seeding logic and direct DB writes

- `packages/springkg-mcp/src/server.ts:588`
- `packages/springkg-mcp/src/server.ts:607`
- `packages/springkg-mcp/src/server.ts:648`
- `packages/springkg-mcp/src/server.ts:792`

Why it matters:

- This file contains startup seeding logic (`seedDatabase`, `clearSeedTables`, `insertSeedBundle`, `loadCodeGraphContext`, `buildSeedBundle`) inside a Team E-owned MCP server file.
- It directly clears/inserts SpringKg tables, matching the F1 finding that Team G's self-seeding logic landed inside Team E's file.
- This is both a code-boundary violation and a maintenance risk because MCP startup now owns data seeding, table truncation, and CodeGraph DB introspection.

Additional code-quality smell in the same file:

- `packages/springkg-mcp/src/server.ts:10` — `type SqliteDatabase = any;`

### 2) Team A-owned community implementation in core package

- `packages/springkg-core/src/community/summary-generator.ts:9`
- `packages/springkg-core/src/community/summary-generator.ts:20`
- `packages/springkg-core/src/community/summary-generator.ts:36`

Why it matters:

- The file is a real community-summary implementation in Team A-owned `springkg-core`, while F1 already established Team F's community work was expected in `packages/springkg-community/src/`.
- That makes this an ownership contamination issue even though the code itself is readable.

### 3) Placeholder runtime implementation with fake persistence and explicit `any`

- `packages/springkg-runtime/src/sync-nacos.ts:46`
- `packages/springkg-runtime/src/sync-nacos.ts:68`
- `packages/springkg-runtime/src/sync-nacos.ts:71`
- `packages/springkg-runtime/src/sync-nacos.ts:74`

Why it matters:

- `runSyncNacos()` logs success metrics, but `createRealKg()` is only a placeholder and does not persist anything.
- The file uses explicit `any` in the fake persistence surface.
- This can create misleading behavior: the command appears successful while the “real” path is a no-op.

### 4) Silent exception swallowing in Nacos resolver

- `packages/springkg-runtime/src/nacos-config-resolver.ts:7`
- `packages/springkg-runtime/src/nacos-config-resolver.ts:169`
- `packages/springkg-runtime/src/nacos-config-resolver.ts:189`
- `packages/springkg-runtime/src/nacos-config-resolver.ts:202`
- `packages/springkg-runtime/src/nacos-config-resolver.ts:231`

Why it matters:

- Resolver contract uses `kg: any`.
- Four empty `catch (e) {}` blocks suppress failed symbol/edge upserts entirely, losing data and making diagnosis difficult.

### 5) Silent exception swallowing in gateway resolver

- `packages/springkg-runtime/src/gateway-route-resolver.ts:7`
- `packages/springkg-runtime/src/gateway-route-resolver.ts:21`
- `packages/springkg-runtime/src/gateway-route-resolver.ts:130`
- `packages/springkg-runtime/src/gateway-route-resolver.ts:151`
- `packages/springkg-runtime/src/gateway-route-resolver.ts:169`
- `packages/springkg-runtime/src/gateway-route-resolver.ts:185`
- `packages/springkg-runtime/src/gateway-route-resolver.ts:203`
- `packages/springkg-runtime/src/gateway-route-resolver.ts:226`
- `packages/springkg-runtime/src/gateway-route-resolver.ts:239`

Why it matters:

- Uses `kg: any` and `Record<string, any>` metadata typing.
- Seven silent catches drop route, endpoint, and edge write failures without surfacing them.

### 6) Silent exception swallowing in config usage tracker

- `packages/springkg-runtime/src/config-usage-tracker.ts:5`
- `packages/springkg-runtime/src/config-usage-tracker.ts:22`
- `packages/springkg-runtime/src/config-usage-tracker.ts:39`
- `packages/springkg-runtime/src/config-usage-tracker.ts:87`
- `packages/springkg-runtime/src/config-usage-tracker.ts:114`

Why it matters:

- Uses `kg: any` and `any[]` collections for decorated/config nodes.
- Two empty `catch (e) {}` blocks drop `USED_BY` edge persistence failures.

### 7) Broad `any` usage in runtime middleware inventory

- `packages/springkg-runtime/src/middleware-inventory.ts:5`
- `packages/springkg-runtime/src/middleware-inventory.ts:17`
- `packages/springkg-runtime/src/middleware-inventory.ts:28`

Why it matters:

- The resolver surface is typed as `kg: any`.
- Metadata and config-property arrays use `any`, weakening static guarantees in a data-shaping module.

### 8) Broad `any` usage in YAML/property parsing helpers

- `packages/springkg-runtime/src/internal/yaml-loader.ts:7`
- `packages/springkg-runtime/src/internal/yaml-loader.ts:17`
- `packages/springkg-runtime/src/internal/yaml-loader.ts:18`
- `packages/springkg-runtime/src/internal/yaml-loader.ts:83`
- `packages/springkg-runtime/src/internal/yaml-loader.ts:89`
- `packages/springkg-runtime/src/internal/property-flatten.ts:7`
- `packages/springkg-runtime/src/internal/property-flatten.ts:8`

Why it matters:

- These helpers normalize user configuration data, but they fall back to `any` pervasively rather than narrowing with structured input/output types.

### 9) Broad `any` usage in config resolver

- `packages/springkg-runtime/src/config-resolver.ts:8`
- `packages/springkg-runtime/src/config-resolver.ts:31`

Why it matters:

- Core config-resolution paths still rely on `kg: any` and `value: any`, which weakens contract safety around config ingestion and precedence handling.

### 10) Broad `any` usage in core graph wrapper

- `packages/springkg-core/src/spring-kg.ts:20`

Why it matters:

- `type AnyCodeGraph = any;` sits at the core Team A abstraction boundary, so downstream code loses type guarantees around the peer `CodeGraph` object.

### 11) Root-source boundary violation outside team ownership map

- `src/db/queries.ts`
- `src/extraction/tree-sitter.ts`
- `src/index.ts`
- `src/types.ts`

Why it matters:

- These are modified according to `git status --short` but are outside the springcloud team ownership map provided for package work.
- F1 already flagged this as a blocking upstream-boundary violation.

## Audited clean / acceptable findings

These were reviewed and are **not** called issues in this pass:

- `packages/springkg-core/src/db/spring-db.ts`
  - Correctly stores SpringKg DB at `.codegraph/springkg.db` in both `initialize()` and `open()`.
- `packages/springkg-core/src/node-sqlite.d.ts`
  - Minimal 23-line declaration shim for `node:sqlite`; no behavioral duplication found.
- CLI `console.log(...)` usage in `packages/springkg-cli/src/**`
  - Considered normal for command output, not a code smell by itself.

## Cross-team contamination report

### Confirmed contamination

1. **Team E-owned file contains Team G work**
   - File: `packages/springkg-mcp/src/server.ts`
   - Evidence: startup seeding / seed bundle logic inside MCP server (`seedDatabase`, `insertSeedBundle`, `loadCodeGraphContext`, `buildSeedBundle`)
   - Matches inherited F1 rejection note: Team G self-seeding logic landed in Team E's owned file.

2. **Team A-owned file contains Team F domain work**
   - File: `packages/springkg-core/src/community/summary-generator.ts`
   - Evidence: concrete community summary regeneration logic exists in core instead of `packages/springkg-community/src/`
   - Matches inherited F1 finding that Team F deliverables were effectively implemented in Team A territory.

3. **Unowned upstream root `src/` modified**
   - Files:
     - `src/db/queries.ts`
     - `src/extraction/tree-sitter.ts`
     - `src/index.ts`
     - `src/types.ts`
   - These are outside the provided A/B/C/D/E/F/G ownership map for springcloud package work.

### Ownership-aligned modified files

The following modified package/example files align with their nominal owners based on path:

- Team A: `packages/springkg-core/src/db/migrations.ts`, `packages/springkg-core/src/db/spring-db.ts`, `packages/springkg-installer/src/db/`
- Team B: `packages/springkg-semantic/src/index.ts`
- Team C: `packages/springkg-data/src/annotation-sql-extractor.ts`, `index.ts`, `jpa-entity-resolver.ts`, `mybatis-plus-resolver.ts`, `mybatis-xml-extractor.ts`, `writer.ts`
- Team E: `packages/springkg-mcp/src/server.ts`, `packages/springkg-mcp/src/bin/`
- Team G: `examples/springcloud-demo/**`

No Team D-owned source files were modified in the current `git status --short` output, even though several Team D runtime files have quality debt in the current tree.

## Final assessment

- Build and typecheck are green.
- The mandatory full test suite is red in this Windows environment.
- The repo-root DB location requirement fails because `.codegraph/springkg.db` is missing.
- `packages/springkg-*/src/` contains real code-quality debt concentrated in Team D runtime typing/error handling, Team E's MCP server seeding boundary, and Team A/Team F ownership bleed.

## Final VERDICT

Build PASS | Tests 1712/1749 | Files 51 clean/11 issues | VERDICT: FAIL
