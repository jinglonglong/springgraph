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
