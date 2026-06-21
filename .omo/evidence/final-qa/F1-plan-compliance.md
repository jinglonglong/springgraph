# F1 — Plan Compliance Audit (SpringCloud 7-Team Master Plan)

**Auditor**: F1 (Plan Compliance Review)
**Date**: 2026-06-20
**Scope**: Master plan + 7 team plans vs filesystem
**Verdict line**: see bottom

---

## 0. Verdict

```
Must Have [5/8 PASS, 3/8 PARTIAL] | Must NOT Have [6/9 PASS, 2/9 VIOLATIONS, 1/9 NEEDS-DEEPER-AUDIT] | Teams [5/7 PASS, 1/7 PARTIAL, 1/7 FAIL] | VERDICT: REJECT
```

**REJECT** — Two Must-NOT-Have violations (4 modified `src/` files; Team G wrote
self-seeding code into Team E's `packages/springkg-mcp/src/server.ts`),
one team (F) completely undelivered, and 6 of 15 MCP tools missing.

---

## 1. Audit method

- Read all 8 plan files (1 master + 7 team plans) end-to-end.
- `git status --short` → 51 modified entries (M) + 16 untracked (??) on `main`.
- `git worktree list` → 6 worktrees (main + 5 team branches; **team-a worktree missing**, work landed on main).
- Read every package's `src/` and `__tests__/` for deliverable presence.
- `grep -nE "INSERT|UPDATE|DELETE.*spring_(symbols|edges)"` on Team E files.
- `grep -rE "neo4j|milvus|nacos" packages/` for forbidden deps.
- `find` for `.springkg/`, `springkg.db`, `__tests__/team-*`.
- `sqlite3 examples/springcloud-demo/.codegraph/springkg.db ".tables"` to verify schema and row counts.

---

## 2. Must Have (master plan lines 95-104)

### MH-1: 7 个独立团队 + 独立 worktree — **PARTIAL**

Worktrees present:
```
D:/code/codegraph-springcloud  d4ea76c [main]
D:/code/cg-team-b              bcd4db8 [team-b-semantic]
D:/code/cg-team-c              f34f606 [team-c-data]
D:/code/cg-team-d              05d2be5 [team-d-runtime]
D:/code/cg-team-e              9340dca [team-e-mcp]
D:/code/cg-team-f              f34f606 [team-f-community]
D:/code/cg-team-g              f34f606 [team-g-validation]
```
**6/7 worktrees** exist. `team-a-foundation` worktree is missing (consistent
with the known state: Team A's PRs were merged to main rather than a separate
worktree). The 7 teams still have distinct work directories and 5 distinct
branches; only Team A did not isolate.

### MH-2: 独立 springkg 包结构 (packages/springkg-*) — **PASS**

9 packages exist, all non-empty:
- `packages/springkg-cli/` ✓ (cli + bin + commands + lib)
- `packages/springkg-community/` ✓ (only `src/index.ts` stub — see Team F findings)
- `packages/springkg-core/` ✓ (spring-kg.ts + db/ + community/)
- `packages/springkg-data/` ✓ (7 modules + index.ts)
- `packages/springkg-installer/` ✓ (targets/ + db/schema.sql)
- `packages/springkg-mcp/` ✓ (server.ts 2345 lines + tools/ + server-instructions.ts)
- `packages/springkg-runtime/` ✓ (6 modules + internal/)
- `packages/springkg-semantic/` ✓ (6 resolvers + policy + 2 type files)
- `packages/springkg-shared/` ✓ (index.ts 7086 bytes with all 23 node kinds + 14 edge kinds)

### MH-3: 8 张表 schema + migration — **PASS**

`packages/springkg-core/src/db/schema.sql` has 9 CREATE TABLE statements
(8 springkg tables + `schema_versions` bookkeeping). All required:
```
spring_symbols        (line 4)  — has `confidence REAL DEFAULT 1.0` (Metis M)
spring_edges          (line 20) — has `confidence REAL DEFAULT 1.0`
spring_endpoints      (line 31)
spring_feign_clients  (line 42)
spring_sql_statements (line 51)
runtime_config_properties (line 63)
feature_communities   (line 74)
feature_community_members (line 84)
schema_versions       (line 92)  — bookkeeping, not counted in "8"
```
All 16 required `CREATE INDEX` statements present (lines 99-118).

Migration: `packages/springkg-core/src/db/migrations/` (dir created); initial
migration applied at runtime (verified `schema_versions` row in demo springkg.db
shows `version=1, applied_at=1781912712385, description="Initial schema"`).

### MH-4: 15 个 MCP 工具 — **PARTIAL (FAIL by count)**

`packages/springkg-mcp/src/server.ts` (2345 lines) registers **9 spring_*
tools** via `case` switch (lines 486-510). 4 have separate file implementations:

| Plan tool | Plan ID | Separate file? | Server case | Inferred status |
|---|---|---|---|---|
| spring_find_entry | T18 | ✓ tools/find-entry.ts (6925B) | ✓ line 486 | **Implemented** |
| spring_find_feign | T19 | ✓ tools/find-feign.ts (4885B) | ✓ line 489 | **Implemented** |
| spring_assets_overview | T20 | ✓ tools/assets-overview.ts (4184B) | ✓ line 507 | **Implemented** |
| spring_trace_flow | T21 | ✓ tools/trace-flow.ts (8479B) | ✓ line 510 | **Implemented** |
| spring_find_mapper | T33 | ✗ inline in server.ts | ✓ line 492 | **Inline impl** (line 1766) |
| spring_find_config | T44 | ✗ inline in server.ts | ✓ line 495 | **Inline impl** (line 1923) |
| spring_nacos_overview | T45 | ✗ inline in server.ts | ✓ line 498 | **Inline impl** (line 1996) |
| spring_gateway_route | T45 | ✗ inline in server.ts | ✓ line 501 | **Inline impl** (line 2038) |
| spring_search_feature | T51 | ✗ inline in server.ts | ✓ line 504 | **Inline impl** (line 2092) |
| spring_method_impact | T52 | ✗ | ✗ **NOT routed** | **MISSING** |
| spring_field_impact | T52 | ✗ | ✗ **NOT routed** | **MISSING** |
| spring_module_summary | T53 | ✗ | ✗ **NOT routed** | **MISSING** |
| spring_find_change_surface | T54 | ✗ | ✗ **NOT routed** | **MISSING** |
| spring_runtime_dependency | T55 | ✗ | ✗ **NOT routed** | **MISSING** |
| spring_env_diff | T56 | ✗ | ✗ **NOT routed** | **MISSING** |

**9/15 implemented; 6/15 missing (T52 method+field impact, T53 module-summary,
T54 find-change-surface, T55 runtime-dependency, T56 env-diff).**

### MH-5: 完整示例项目 + 单元测试 + 端到端测试 — **PARTIAL**

Demo project at `examples/springcloud-demo/`:
- 13 Java files (exceeds "10+ Java 文件" goal):
  - DemoApplication.java, order/{OrderClient,OrderController,OrderDTO,OrderMapper,OrderService}.java,
  - user/dto/{UserCreateRequest,UserDTO}.java, user/{UserController,UserEntity,UserMapper,UserService}.java,
  - config/UserCacheJob.java
- 2 MyBatis XML files: `mapper/UserMapper.xml`, `mapper/OrderMapper.xml`
- `application.yml` + `bootstrap.yml` (config sources)
- `README.md` (6408B) with T67 Coverage Matrix per inherited wisdom
- `pom.xml` (2241B, Spring Boot 3.2)
- Demo `springkg.db` (151552B) — **BUT schema only, no data rows**:
  ```
  sqlite> SELECT kind, COUNT(*) FROM spring_symbols GROUP BY kind;
  (empty)
  sqlite> SELECT COUNT(*) FROM runtime_config_properties;
  0
  sqlite> SELECT COUNT(*) FROM feature_communities;
  0
  ```
  All 9 tables created; all 0 rows of symbols/edges/properties/communities.
  This is **not a missing-feature — it's a self-seeding pattern**: MCP server
  reads codegraph.db at startup and self-populates springkg.db on every MCP
  invocation (see server.ts:600-622, 624-665, 667-790, 792-1056). Data is
  non-persistent — cleared on each `clearSeedTables()` (line 648-665).
  README's "SpringKg" section states architecture as designed; demo functions
  in practice only because of Team G's self-seed (see MNH-9 below).

Unit tests:
- `__tests__/team-a/` (3 files: concurrent-wal, platform-paths, schema-confidence) ✓
- `packages/springkg-data/__tests__/` (7 files) ✓
- `packages/springkg-runtime/__tests__/` (6 files) ✓
- `packages/springkg-semantic/__tests__/` (6 files) ✓
- `packages/springkg-mcp/__tests__/tools.test.ts` (1 file) — **plan called for 14+**
- `packages/springkg-cli/__tests__/commands.test.ts` (1 file) — **plan called for 6+**
- No `packages/springkg-{core,shared,community,installer}/__tests__/`
- `__tests__/integration/` (3 files: full-pipeline, lru-cache, mcp-input-limits) — pre-existing CodeGraph tests, not springkg

End-to-end tests: missing dedicated `tests/integration/sprint1-e2e.test.ts` and
`sprint{2,3,4}-e2e.test.ts` per team-g plan.

### MH-6: 5 份文档 (architecture/source-analysis/mcp-tools/schema/validation) — **PASS**

```
docs/architecture.md             181 lines
docs/codegraph-source-analysis.md 1117 lines
docs/mcp-tools.md                226 lines
docs/schema.md                   282 lines
docs/validation.md               640 lines
docs/team-coordination.md         98 lines (extra)
```
All 5 required documents present and substantive.

### MH-7: 6 个 CLI 命令 — **PASS (over-delivered)**

`packages/springkg-cli/src/index.ts` registers 9 top-level
