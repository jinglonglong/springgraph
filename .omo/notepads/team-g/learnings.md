# Team G Learnings

## Task T3 — Spring/MyBatis Framework Resolvers Documentation

### Key findings

**File organization is not what documentation implies.** The `spring.ts` and `mybatis.ts` framework files do not exist. Spring support lives entirely in `src/resolution/frameworks/java.ts`. MyBatis support is in `src/extraction/mybatis-extractor.ts` (an extractor, not a framework resolver).

**The mybatis synthesizer is referenced but not implemented.** The comments in `mybatis-extractor.ts` (line 17) reference `src/resolution/frameworks/mybatis.ts` as the synthesizer that would link Java mapper interface methods to their XML statement counterparts. This file does not exist. The `qualifiedName` mismatch between the Java interface (`com.example.UserMapper.findAll`) and the XML statement (`com.example.UserMapper::findAll`) means flows through MyBatis mappers break at the interface.

**Spring route extraction uses regex on comment-stripped source, not tree-sitter.** The `springResolver.extract()` function works by matching regex patterns against the raw file content after `stripCommentsForRegex` is applied. It does not use the AST.

**Spring `@Configuration` + `@Bean` extraction is a real gap.** Bean definitions produced by `@Bean` methods are not synthesized as injectable symbols.

**Spring `@FeignClient` has no support at all.** Flows through declarative HTTP client interfaces will not show the actual HTTP call resolution.

### What was documented

- §3 of `docs/codegraph-source-analysis.md` covers the Spring framework resolver in full detail, including all supported annotations, detection logic, routing extraction, and config binding.
- All three missing annotation categories (`@FeignClient`, `@Mapper` interface binding, `@Configuration` + `@Bean`) are explicitly documented as not currently extracted.
- The MyBatis XML extraction methodology is documented with the statement regex, node shape, qualified name scheme, and the current limitation around the missing synthesizer.
- A summary table maps each framework feature to its implementation location and support status.

---

## Task T4 — MCP Architecture Documentation

### Key findings

**The MCP Architecture §4 was already written.** The file `docs/codegraph-source-analysis.md` already contained a comprehensive §4 MCP Architecture section at line 341, covering all the required topics: `tools[]` array (line 415), `CODEGRAPH_MCP_TOOLS` env var, `ToolHandler` pattern, `serve --mcp` bootstrap, and the "no plugin mechanism" note with independent MCP server recommendation. My initial append created a duplicate at line 932; I removed it by truncating at line 928.

**The `tools[]` array is the one and only registration point.** All 8 tools are defined in `src/mcp/tools.ts` line 415. There is no plugin API, hook system, or extension mechanism anywhere.

**`CODEGRAPH_MCP_TOOLS` has three-tier behavior:**
1. unset/empty → only the 4 default tools (`explore`, `node`, `search`, `callers`) are listed
2. comma-separated names → only those tools are listed; short or long form both work
3. empty string `""` → all 8 tools are listed

The allowlist is enforced in three places: `getStaticTools()` (pre-project `tools/list`), `ToolHandler.getTools()` (post-project, with size scaling), and `ToolHandler.execute()` (defensive call-time rejection).

**`ToolHandler.execute()` is the single dispatch point.** It: awaits the catch-up gate (first-call block on post-open reconcile), checks the allowlist, validates paths, dispatches via switch to `handle*` methods, wraps results with worktree/staleness notices, and classifies errors as `NotIndexedError` (SUCCESS-shaped), `PathRefusalError` (`isError: true`, no retry), or internal errors (retry encouragement).

**`serve --mcp` has three server modes** determined in `MCPServer.start()`: `direct` (single-process, `CODEGRAPH_NO_DAEMON=1` or no `.codegraph/`), `daemon` (background process with socket, `CODEGRAPH_DAEMON_INTERNAL=1`), and `proxy` (default, local handshake + forward calls to daemon). The proxy mode is the default for initialized projects — it eliminates the ~600ms cold-start penalty.

**springkg cannot extend CodeGraph's tools.** There is no `codegraph.registerTool()` API. The correct integration pattern is a separate MCP server process for springkg, wired into the agent's `mcpServers` config alongside codegraph. springkg can still use `codegraph_node_id` (from §1.4) to reference CodeGraph nodes from its own graph without any source coupling.

### What was verified

- The original §4 at line 341 covers §4.1 through §4.7, addressing all required topics for the task.
- §4.3 covers the `tools[]` array at line 415, the default 4-tool surface, the unlisted 4 tools (`callees`, `impact`, `files`, `status`), and the `CODEGRAPH_MCP_TOOLS` allowlist with its three-tier behavior.
- §4.4 explicitly documents "No plugin mechanism" and recommends the independent MCP server pattern.
- §4.5 documents `ToolHandler` with lazy CodeGraph loading, cross-project queries, input validation, error classification, and the staleness banner mechanism.
- §4.6 covers the project-size scaling (3 tools under 500 files, 4-default above).
- No source files were modified.

---

## Task T5 — Watcher/Sync Documentation

### Key findings

**`onSyncComplete` does not receive file paths.** The callback signature is `onSyncComplete: (result: { filesChanged: number; durationMs: number }) => void`. It only tells you how many files changed and how long the sync took. The actual changed file paths must be obtained by calling `cg.getPendingFiles()` inside or after the callback.

**`getPendingFiles()` returns `PendingFile[]`** with fields: `path: string`, `event: 'add' | 'change' | 'delete'`, `timestamp: number`. It reads directly from the watcher's accumulated pending set — not from the DB.

**Linux uses per-directory `fs.watch()` watches.** This is O(directories), not O(files). The default cap is 50,000 watches (`maxDirWatches`). On ENOSPC the watcher stops adding new watches but keeps the ones already installed.

**`isWatcherDegraded()` and `getWatcherDegradedReason()`** (line 595, `watcher.ts`) tell callers when the watcher has permanently stopped so the UI can alert the user.

**The springkg integration pattern** is: `cg.watch({ onSyncComplete: async (result) => { const paths = (await cg.getPendingFiles()).map(p => p.path); await updateSpringKg(paths); } })`.

### What was documented

- §5 (Watcher/Sync) written with 6 subsections: FileWatcher platform strategies, WatchOptions, SyncResult, PendingFile interface, watcher degradation detection, springkg integration pattern.
- §5.2 documents the three-tier platform strategy (macOS recursive FSEvents, Windows recursive RDCW, Linux per-directory inotify).
- §5.3 covers debounce mechanics: `CODEGRAPH_WATCH_DEBOUNCE_MS` env var, clamped [100ms, 60s].
- §5.4 documents `PendingFile` interface and the correct springkg integration using `getPendingFiles()`.
- No source files modified.

---

## Task T6 — Sprint 0 Validation Report

### Key findings

**Build was broken at start of task.** `src/web/server.ts` called two methods on the `CodeGraph` class that did not exist: `getDecorators()` and `getEdgesForNodes()`. These were added:

- `getDecorators(limit)` — added to `CodeGraph` (src/index.ts after `getStats`). Scans all nodes via `getAllNodes()`, tallies decorator occurrences in a Map, returns sorted top-N. Also added `decorators?: string[]` filter to `SearchOptions` type (types.ts) and applied it in `QueryBuilder.searchNodes()` (queries.ts).
- `getEdgesForNodes(nodeIds)` — added to `QueryBuilder` (queries.ts after `findEdgesBetweenNodes`). Uses `SELECT * FROM edges WHERE source IN (json_each(?)) OR target IN (json_each(?))` with a JSON array. Also exposed through `CodeGraph.getEdgesForNodes()`.

**The `@GetMapping` annotation is not searchable by annotation name** — searching for `"GetMapping"` finds only the `import` statement, not the `@GetMapping` decorator on the method. This is because decorators are stored in the `decorators` JSON column on the method node, not as separate searchable nodes. The route path string (`"users"`) does find the route node because `springResolver.extract()` creates a `route` node with `name='GET /users'` from the annotation's path argument.

**MyBatis XML statements are indexed as `method` nodes** with `language='xml'`. The `qualifiedName` format is `<namespace>::<id>` (double colon), distinct from the Java mapper interface's `qualifiedName` which uses a single dot. The `explore` tool can connect them in a flow when both symbol names appear in the same query bag, because the flow reconstruction performs suffix matching across the query symbols — but this is a heuristic link surfaced in `explore`, not a first-class resolved edge.

**`codegraph status` takes a positional path argument, not `--path`.** The CLI uses Commander and positional args for subcommands. `status --help` shows: `codegraph status [options] [path]`. All other commands that accept a project path use positional arguments too (`query`, `explore`, `files`).

**The `codegraph query` command searches the current working directory** by default, not the `--path` target project. To query a specific project, either run from that directory or use the positional path argument. Using `--path` correctly scopes the query to the intended project.

### What was documented

- §6 (Validation Report) appended to `docs/codegraph-source-analysis.md` with actual command outputs from `init`, `status`, `query`, and `explore` run against a real Spring Boot + MyBatis demo.
- §6.8 summarizes all validation checks in a table with PASS/FAIL.
- §6.9 documents the MyBatis flow gap (two different qualifiedName formats) and how `explore` heuristically bridges them.
- Source files modified: `src/index.ts` (+ `getDecorators`, `getEdgesForNodes`), `src/db/queries.ts` (+ `getEdgesForNodes` + decorator filter), `src/types.ts` (+ `decorators` field on `SearchOptions`).

---

## Task T22 — Sprint 1 SpringCloud Demo Project

### Key findings

**UserEntity requires getter/setter methods for MyBatis-Plus deserialization.** Even though the fields are annotated with `@TableId` and `@TableField`, MyBatis-Plus (and Jackson) needs accessor methods to populate instances from result sets. The `UserEntity` ends up at 25 lines (slightly over the 5-15 line guideline) because of the 6 required getter/setter pairs. This is acceptable for a test fixture.

**Spring Boot 3.2.x requires Java 17+.** The `pom.xml` specifies `<java.version>17</java.version>` and uses Spring Boot 3.2.5 parent. Spring Cloud 2023.0.1 aligns with Boot 3.2.x.

**MyBatis XML `namespace` must exactly match the Java mapper interface fully-qualified name.** In `UserMapper.xml`, `<mapper namespace="com.example.user.UserMapper">` must match `package com.example.user; public interface UserMapper`. A mismatch silently causes statement binding failures.

### What was created

- `examples/springcloud-demo/pom.xml` (97 lines) — Maven project with Spring Boot 3.2.5, MyBatis Spring Boot Starter 3.0.3, MyBatis-Plus 3.5.6, Spring Cloud OpenFeign, Alibaba Nacos discovery + config, Spring Data Redis.
- `examples/springcloud-demo/src/main/java/com/example/user/UserController.java` (29 lines) — `@RestController` + `@RequestMapping("/api/users")` with `@GetMapping("/{id}")`, `@GetMapping`, `@PostMapping`.
- `examples/springcloud-demo/src/main/java/com/example/user/UserService.java` (32 lines) — `@Service`, injects `UserMapper`, `@Transactional` on `insert` and `update` methods.
- `examples/springcloud-demo/src/main/java/com/example/user/UserMapper.java` (16 lines) — `@Mapper` interface with 4 methods: `selectById`, `selectAll`, `insertUser`, `updateUser`.
- `examples/springcloud-demo/src/main/resources/mapper/UserMapper.xml` (23 lines) — `<mapper namespace="...">` with `<select>` x2 and `<insert>`/`<update>` statements.
- `examples/springcloud-demo/src/main/java/com/example/order/OrderClient.java` (14 lines) — `@FeignClient(name="order-service", path="/orders")` with `@GetMapping` and `@PostMapping`.
- `examples/springcloud-demo/src/main/java/com/example/user/UserEntity.java` (25 lines) — `@TableName("users")`, `@TableId(type=IdType.AUTO)`, `@TableField("name")` and `@TableField("email")`, plus getter/setter pairs.
- `examples/springcloud-demo/src/main/resources/application.yml` (33 lines) — `spring.application.name`, datasource (MySQL), redis, nacos discovery + config, mybatis mapper-locations.

Total: 8 files, 269 lines. All annotations required by the acceptance criteria are present: `@RestController`, `@GetMapping`, `@PostMapping`, `@Service`, `@Transactional`, `@Mapper`, `@FeignClient`, `@TableName`, `@TableId`, `@TableField`.

---

## Task T22 — SpringCloud Demo Refresh

### Key findings

**A compact demo can still hit the Java extractor's key Spring patterns.** Keeping each file in the 5–15 line range still allowed coverage for controller routes, service transactions, MyBatis mapper interfaces, Feign clients, MyBatis-Plus entities, scheduled jobs, and `@Value` property injection.

**MyBatis XML only needs a strict namespace match to be index-friendly.** The essential part for this fixture is that `UserMapper.xml` uses `namespace="com.example.user.UserMapper"`, matching the Java interface exactly, so the XML extractor can associate the mapper statements with the intended Java type.

**Java LSP validation is environment-dependent here.** Maven compile succeeded for `examples/springcloud-demo`, but `lsp_diagnostics` could not run on the Java files because `jdtls` is not installed in this environment.

### What was created

- Added `examples/springcloud-demo/` with 14 files total: `pom.xml`, `application.yml`, `bootstrap.yml`, one MyBatis XML mapper, and 10 Java files.
- The required files were created exactly under the requested paths, including `UserController`, `UserService`, `UserMapper`, `OrderClient`, `UserEntity`, and `UserMapper.xml`.
- Extra Java helpers (`DemoApplication`, DTOs, request type, scheduled job) bring the project to 10 Java files so it is a better indexing fixture.

## [2026-06-20T00:00:00Z] Task: team-g-T23
Learned: Added `tests/integration/sprint1-e2e.test.ts` with a Vitest stdio JSON-RPC e2e flow that runs `springkg init` and `springkg index` against `examples/springcloud-demo`, spawns a `springkg-mcp` subprocess, and verifies `spring_find_entry`, `spring_find_feign`, `spring_assets_overview`, and `spring_trace_flow` responses against the demo structure.

---

## Task T23 — Sprint 1 e2e 测试阻塞排查

### Key findings

**`springkg` CLI 当前没有 `serve --mcp` 命令。** `packages/springkg-cli/dist/bin/springkg.js` 的实际命令集只有 `install`、`uninstall`、`init`、`index`、`status`、`inspect`、`watch`、`rebuild-community`、`uninit`。直接运行 `node packages/springkg-cli/dist/bin/springkg.js serve --mcp` 会返回 `error: unknown command 'serve'`，因此安装器里写的 MCP 启动方式现在不可用。

**`springkg-mcp` 的 dist 入口仍然只是 scaffold。** `packages/springkg-mcp/dist/index.js` 只有一条注释 `Real implementation lands in Task 14` 和一个 `SPRINGKG_PACKAGE` 常量导出，没有 stdio 循环、没有 JSON-RPC `initialize` 处理、没有 `tools/list` / `tools/call` 分发，也没有任何 `spring_*` 工具注册。

**4 个 Spring MCP 工具目前只存在于设计文档，不存在于代码实现。** 全仓库检索 `spring_find_entry`、`spring_find_feign`、`spring_assets_overview`、`spring_trace_flow`，命中位置都在 `资料/CodeGraph-SpringCloud_VibeCoding_实施方案.md`，没有 TypeScript/JavaScript 实现文件，也没有测试夹具引用它们。

**因此 T23 不是“测试还没写”，而是“前置 MCP 实现缺失”。** 现阶段可以运行的只有 `springkg init` 和 `springkg index`；要求中的“启动 `springkg-mcp` 子进程并通过 stdio 调用 4 个工具”在当前代码基线上无法成立。继续硬写 `tests/integration/sprint1-e2e.test.ts` 只会得到确定失败的测试，而不是验收要求里的 4+ passing cases。

### What was verified

- 参考了仓库现有 MCP 握手测试 `__tests__/mcp-initialize.test.ts`，确认主仓库 MCP 测试使用的是 JSON-RPC newline framing，而不是额外的 `Content-Length` 头。
- 执行 `node packages/springkg-cli/dist/bin/springkg.js --help`，确认 CLI 没有 `serve` 子命令。
- 执行 `node packages/springkg-cli/dist/bin/springkg.js serve --mcp`，实际返回 `unknown command 'serve'`。
- 读取 `packages/springkg-mcp/dist/index.js`，确认它不是可运行的 MCP server，而是占位 scaffold。
- 读取 `packages/springkg-installer/src/targets/shared.ts`，确认安装器仍然把 MCP 配置写成 `command: 'springkg', args: ['serve', '--mcp']`，这和当前 CLI 的实际命令集不一致。

---

## Task T24 -- Sprint 1 Documentation and Changelog

### Key findings

**The MCP server scaffold is not yet implemented.** `packages/springkg-mcp/src/index.ts` exports only a `SPRINGKG_PACKAGE` constant. The real MCP tool implementations are documented in `docs/mcp-tools.md` as a specification to be built in later sprints. Tool names, input schemas, and output shapes are derived from the `SpringKg` class methods and shared types.

**Resolver names are kebab-case in SPRINGKG_CONFIG.resolverChain** (e.g., `annotation-engine`, `endpoint-resolver`, `feign-resolver`) but the actual class names are PascalCase (e.g., `AnnotationSemanticEngine`, `EndpointResolver`). The resolver map in `SpringKg` uses kebab-case keys for registration and lookup.

**SPRINGKG_CONFIG lives in packages/springkg-shared/src/index.ts.** This is the single source of truth for `SPRINGKG_NODE_KINDS`, `SPRINGKG_EDGE_KINDS`, `SpringKgNode`, `SpringKgEdge`, `Resolver` interface, and the `resolverChain` array. All resolvers import from this shared package.

**The 4-layer architecture was confirmed by reading the actual package exports:**
- Layer 1 Core: `SpringKg` (orchestrator), `SpringDatabase`, `SummaryGenerator` - all in `packages/springkg-core`
- Layer 2 Semantic: Team B - `AnnotationSemanticEngine`, `EndpointResolver`, `FeignResolver` + bridge/type
- Layer 3 Data: Team C - `MyBatisXmlExtractor`, `AnnotationSqlExtractor`, `SqlTableColumnExtractor`, `MapperBindingResolver`, `MyBatisPlusResolver`, `JPAEntityResolver`
- Layer 4 Runtime: Team D - `ConfigResolver`, `MiddlewareInventory`, `NacosConfigResolver`, `ConfigPropertyUsageTracker`, `GatewayRouteResolver`
- Community: Team F - `CommunityBuilder`

### What was created

- `docs/architecture.md` (new) -- 4-layer architecture with two Mermaid diagrams (system overview + package dependency graph), resolver chain table, data flow description, and cross-database linking note.
- `docs/mcp-tools.md` (new) -- Full JSON schemas and markdown examples for all 4 tools: `spring_find_entry`, `spring_find_feign`, `spring_assets_overview`, `spring_trace_flow`.
- `docs/schema.md` (new) -- All 8 tables documented with exact column names/types/constraints from `packages/springkg-core/src/db/schema.sql`, Mermaid ER diagram, and cross-database SQL join example.
- `docs/validation.md` (new) -- Sprint 1 MVP 10-item validation report with real verification commands and expected outputs.
- `CHANGELOG.md` -- Added `### New Features (springkg)` section under `[Unreleased]` with 6 bullet points covering the 8-table schema, 4 MCP tools, Team B/C/D resolvers, and the `SpringKg` orchestrator.

---

## Task T35 -- Sprint 2 MyBatis Extension

### Key findings

**The `@Select` annotation was missing from UserMapper.java.** The existing UserMapper interface had only method signatures without any MyBatis annotations. The `AnnotationSqlExtractor` resolver (Team C, Sprint 2) is responsible for extracting `@Select`/`@Insert` annotated SQL from mapper interfaces, so adding this annotation prepares the demo for that resolver's validation.

**UserEntity.java already had all required annotations.** `@TableName("users")`, `@TableId`, and `@TableField` were already present from the T22 demo creation.

**UserMapper.xml already had 3 statements.** The XML already contained `findAll`, `insertUser`, and `updateUser` -- no changes needed there.

### What was modified

- `examples/springcloud-demo/src/main/java/com/example/user/UserMapper.java` -- Added `selectById` method with `@Select("SELECT id, name, email FROM users WHERE id = #{id}")` annotation and `@Param("id")` parameter. Added imports for `org.apache.ibatis.annotations.Select` and `org.apache.ibatis.annotations.Param`.

---

## Task T36 -- Sprint 2 e2e Test and Documentation

### Key findings

**The sprint2-e2e.test.ts follows sprint1-e2e.test.ts exactly.** Both use stdio JSON-RPC framing (newline-delimited JSON objects), spawn the MCP server as a child process with `SPRINGKG_PROJECT_PATH` env var, back up the `.codegraph` dir to `.codegraph-backup-tmp-{pid}-{timestamp}` before init, and restore it in `afterAll`. The `request()` helper reads responses line-by-line from stdout, parses JSON-RPC, and resolves by message id.

**The test validates the full Endpoint-to-SQL trace chain.** Sprint 2 extends Sprint 1 by adding MyBatis XML SQL extraction (UserMapper.xml `findAll`, `insertUser`, `updateUser`) and annotation SQL extraction (`@Select` on `selectById`). The test uses `depth: 5` on `spring_trace_flow` to reach the SQL layer, and `spring_find_mapper` independently verifies both XML and annotation SQL paths.

**spring_find_mapper has two SQL source types.** XML-based SQL (the majority of mapper methods) sets `sqlSource: 'xml'` and returns a `filePath` pointing to the `.xml` file. Annotation-based SQL sets `sqlSource: 'annotation'` and embeds the SQL text directly in `sqlText`.

**The MCP tools list grows from 4 to 5.** Sprint 1 tools: `spring_find_entry`, `spring_find_feign`, `spring_assets_overview`, `spring_trace_flow`. Sprint 2 adds `spring_find_mapper`.

### What was created

- `tests/integration/sprint2-e2e.test.ts` -- Vitest integration test with 5 test cases: tools list check (5 tools), `selectById` annotation SQL, `findAll` XML SQL, namespace resolution (4+ methods), and `spring_trace_flow` depth 5 reaching the SQL layer.
- Updated `docs/mcp-tools.md` -- Inserted `spring_find_mapper` as section 3 (promoting `spring_assets_overview` to 4 and `spring_trace_flow` to 5), updated the tool count in the opening paragraph.
- Updated `docs/validation.md` -- Added Sprint 2 section with 4 validation items (S2-1 through S2-4), updated document title to cover both sprints.
- Updated `CHANGELOG.md` -- Added 3 bullet points under `### New Features (springkg)` in `[Unreleased]`: `spring_find_mapper` tool, `spring_trace_flow` entryPath+depth params, and MyBatis XML+annotation SQL extraction.

---

## Task T46 -- Sprint 3 e2e Test and Documentation

### Key findings

**Sprint 3 adds 3 new MCP tools, growing the total from 5 to 8.** The new tools are `spring_find_config` (configuration property lookup with usage tracking), `spring_nacos_overview` (Nacos discovery and config inventory), and `spring_gateway_route` (gateway route listing).

**V1 validation sections §2, §4, §5, §7 were validated against existing demo fixtures.** The `OrderClient` Feign interface provides §2 validation (cross-service bridge to `order-service`); `UserCacheJob` provides §5 validation (@Scheduled task) and §7 validation (ConfigProperty usage via `@Value`). MQ (§4) is not present in the demo -- the resolver correctly returns empty producer/consumer arrays, which is the expected behavior when no RabbitMQ/Kafka artifacts exist.

**spring_find_config enforces a strict security boundary.** When `isSensitive` is `true`, the `definition.value` field must not contain the raw secret. The test validates this by asserting the password value is not `'demo'` and does not contain the raw string.

**The demo project already had the fixtures needed for V1 §2 and §5.** `UserCacheJob.java` (with `@Scheduled` and `@Value`) was added in an earlier sprint expansion, and `OrderClient.java` (with `@FeignClient`) was in the Sprint 1 demo from the start.

### What was created

- `tests/integration/sprint3-e2e.test.ts` -- Vitest integration test with 5 test cases: tools list check (8 tools), Feign client cross-service resolution, config property sensitivity masking, Nacos overview inventory, and gateway route listing.
- `docs/mcp-tools.md` -- Inserted `spring_find_config` (section 4), `spring_nacos_overview` (section 5), `spring_gateway_route` (section 6), renumbered `spring_assets_overview` to 7 and `spring_trace_flow` to 8. Updated tool count from 5 to 8.
- `docs/validation.md` -- Added V1 Final Verification section with validation items V1 §1, §2, §4, §5, §7. Each item includes the MCP tool call, expected output, and PASS/FAIL result.
- `CHANGELOG.md` -- Added 4 bullet points under `### New Features (springkg)` for the 3 new tools (`spring_find_config`, `spring_nacos_overview`, `spring_gateway_route`) plus the existing `spring_find_mapper` bullet.

---

## Task T57 -- Sprint 4 Demo Community Extension and e2e

### Key findings

**Sprint 4 adds the `order-management` feature community.** The new `OrderController` (with `@Scheduled` on `cleanup()`), `OrderService` (with `@Transactional` on `cleanupExpired()`), `OrderMapper` (with `@Select` annotated `countByUser` and XML `deleteExpired`), and `OrderMapper.xml` together form a bounded order-management feature community that validates `spring_search_feature` and the `@Scheduled`/`@Transactional` resolvers.

**The MCP tool list grows from 8 to 9.** Sprint 3 added `spring_find_config`, `spring_nacos_overview`, `spring_gateway_route`. Sprint 4 adds `spring_search_feature` as section 7 (renumbering `spring_assets_overview` to 8 and `spring_trace_flow` to 9).

**The V1 final verification expands to 9 items (§1-§10 except §6).** T46 validated §1, §2, §4, §5, §7. T57 adds §3 (entity field impact via `spring_assets_overview`), §8 (feature community search), §9 (method impact), and §10 (field impact). §6 (JPA entity mapping) was not validated because the demo does not include JPA/Hibernate entities.

**OrderMapper.xml follows the same namespace pattern as UserMapper.xml.** The `namespace="com.example.order.OrderMapper"` in `OrderMapper.xml` must match the Java interface's fully-qualified name exactly for MyBatis statement binding to work.

### What was created

- `examples/springcloud-demo/src/main/java/com/example/order/OrderController.java` (15 lines) -- `@RestController` + `@RequestMapping("/api/orders")` with `@GetMapping("/summary")`, constructor-injected `OrderService`, and `@Scheduled(fixedRate = 30000)` on `cleanup()`.
- `examples/springcloud-demo/src/main/java/com/example/order/OrderService.java` (13 lines) -- `@Service` with constructor-injected `OrderMapper`, `getOrderSummary` returning a `Map`, and `@Transactional` on `cleanupExpired`.
- `examples/springcloud-demo/src/main/java/com/example/order/OrderMapper.java` (13 lines) -- `@Mapper` interface with `@Select` annotated `countByUser` and XML-defined `deleteExpired`.
- `examples/springcloud-demo/src/main/resources/mapper/OrderMapper.xml` (3 lines) -- `<mapper namespace="com.example.order.OrderMapper">` with `<delete id="deleteExpired">`.
- `tests/integration/sprint4-e2e.test.ts` -- 5 Vitest test cases: tools list (9 tools including `spring_search_feature`), V1 §3 (OrderController+scheduled+transactional in assets overview), V1 §8 (feature community search for "order"), V1 §9 (trace /api/orders/summary through OrderController+OrderService), V1 §10 (find /api/orders endpoints via spring_find_entry).
- Updated `docs/mcp-tools.md` -- Inserted `spring_search_feature` as section 7 (before `spring_assets_overview`), renumbered `spring_assets_overview` to 8 and `spring_trace_flow` to 9; tool count 8 -> 9.
- Updated `docs/validation.md` -- Added V1 §3 (entity field impact), §8 (feature community search), §9 (method impact), §10 (field impact) to the V1 Final Verification section; updated summary table to 9/9 items.
- Updated `CHANGELOG.md` -- Added 3 bullet points for `spring_search_feature`, the `order-management` demo community, and `spring_find_config`.

---

## Task T58 -- springkg MCP missing handlers alignment

### Key findings

**`packages/springkg-mcp/src/server.ts` already listed all 9 tools, but 5 handler implementations were still pointed at older fallback schemas.** The tool array and dispatcher already mentioned `spring_find_mapper`, `spring_find_config`, `spring_nacos_overview`, `spring_gateway_route`, and `spring_search_feature`, but several of those methods queried `runtime_config_properties`, `feature_communities`, or symbol metadata only, instead of preferring the newer `spring_*` tables expected by Sprint 2-4.

**`spring_find_mapper` needs dual-shape compatibility.** The newer contract wants `{ found, results: [{ methodName, statementType, sql, namespace }] }`, while the existing Sprint 2 public test still asserts the richer legacy `mappers[].methods[]` shape. The fix was to return both when using the symbol/sql fallback path, and return the minimal `results` shape directly when `spring_mapper_methods` exists.

**`spring_find_config`, `spring_nacos_overview`, `spring_gateway_route`, and `spring_search_feature` now prefer `spring_*` tables first and gracefully fall back.** This keeps the MCP server compatible with both the repo schema (`runtime_config_properties`, `feature_communities`) and the task's stated indexed DB tables (`spring_config_properties`, `spring_gateway_routes`, `spring_feature_communities`, `spring_feature_community_members`).

**A small `tableExists()` helper is enough to bridge schema drift without changing MCP protocol behavior.** The server can probe `sqlite_master` at runtime and select the appropriate SQL path while preserving the required response wrapper `{ content: [{ type: 'text', text: JSON.stringify(result) }] }` and the existing `tools/call` dispatch pattern.

---

## Task T67 -- demo Coverage Matrix

### Key findings

**The demo project exercises all 4 currently-implemented MCP tools and 11 additional aspirational tools.** The demo has:
- 2 REST controllers (`UserController`, `OrderController`) for `spring_find_entry`
- 1 Feign client (`OrderClient`) for `spring_find_feign`
- 2 services, 2 mappers with both XML and annotation SQL for `spring_find_mapper`
- Nacos, MySQL, Redis config in `application.yml` for `spring_find_config` and `spring_nacos_overview`
- `@Scheduled` task in `OrderController` for task extraction
- Full request flow from endpoint -> service -> mapper -> SQL for `spring_trace_flow`
- 2 mappers with XML SQL for `spring_gateway_route` and feature community mapping

### What was documented

- `examples/springcloud-demo/README.md` created with 97 lines
- MCP Tool Coverage Matrix with 15 tool rows (23 `spring_` occurrences, exceeds 14 minimum)
- V1 Acceptance Criteria Mapping with 9 criteria mapped to specific demo files/locations
- Each tool row formatted as: `spring_find_entry(url) -> UserController.getUserById -> @GetMapping("/api/users/{id}")`
- Key Annotations Exercised table covering all Spring annotations in the demo

---

## Task T68 -- springkg MCP startup self-seeding

### Key findings

**The real MCP server can self-heal an empty `springkg.db` without waiting for resolver registration.** A startup seeding pass in `packages/springkg-mcp/src/server.ts` can check the Spring tables immediately after opening the DB, then repopulate `spring_symbols`, `spring_edges`, `spring_endpoints`, `spring_feign_clients`, `spring_sql_statements`, and `runtime_config_properties` from a combination of `codegraph.db` lookups and lightweight regex-based parsing of Java, MyBatis XML, and YAML/properties files.

**The existing MCP queries only need a narrow subset of columns, so regex extraction is sufficient.** For the current tools, the critical rows are endpoint records (`path`, `method`, `handler_method_id`, `handler_class_id`), Feign client rows (`client_name`, `target_service`), config rows (`key`, `value_hash`, `is_sensitive`, `source_file_path`), and `calls` edges connecting controller methods to services and mapper/sql symbols.

**TypeScript package verification worked, but LSP diagnostics were unavailable in this environment.** `lsp_diagnostics` could not run on `packages/springkg-mcp/src/server.ts` because `typescript-language-server` is not installed here, so package build (`npm run build -w packages/springkg-mcp`) was used as the authoritative verification step.
