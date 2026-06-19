# Team G 实施计划 — Validation / Test / Docs

## TL;DR

> **Team G**: Test, validation, example demo project, documentation
> **Owns**: `tests/**`, `examples/springcloud-demo/**`, `docs/**`, `CHANGELOG.md`, `README.md` (springkg sections)
> **Worktree**: `team-g-validation` (独立)
> **Critical Path**: G0 docs (Sprint 0) → G1 demo (Sprint 1) → G2 demo 扩展 (Sprint 2-3) → G3 docs (Sprint 4) → F1-F4 终验

---

## Context

Team G 是 7 团队并行模式中的 1 个，负责**验证 + 示例 + 文档**：
- Sprint 0 阶段：阅读 CodeGraph 源码，输出 6 份 source-analysis 文档
- Sprint 1-4 阶段：为每个 sprint 写 demo 扩展 + 集成测试 + 文档
- 终验：F1-F4 由 Team G 主导运行

设计文档参考：§9.7 (Team G: 测试与验证组) 和 §13.7/13.8 (测试相关的提示词模板)。

---

## Work Objectives

### Core Objective

为所有 team 的输出提供：示例 SpringCloud demo、单元/集成测试、5 份文档、CHANGELOG、README。最终通过 F1-F4 final verification。

### Concrete Deliverables

- `examples/springcloud-demo/` — 完整 SpringCloud demo（10+ Java 文件）
- `tests/integration/sprint{1-4}-e2e.test.ts` — 4 个 sprint 的 e2e 测试
- `docs/codegraph-source-analysis.md` — 6 份 source analysis（Sprint 0 文档）
- `docs/architecture.md` — 4 层架构图
- `docs/mcp-tools.md` — 14 个 spring_* 工具 schema + 示例
- `docs/schema.md` — 8 张表 + ER 图
- `docs/validation.md` — MVP 10 条 + V1 10 条验证报告
- `CHANGELOG.md` [Unreleased] — 4 个 sprint 各自的条目
- `README.md` — 新增 springkg 章节

### Definition of Done

- [ ] 6 份 source-analysis 文档（Sprint 0 阶段）
- [ ] 4 个 sprint 集成测试 0 失败
- [ ] demo 项目完整（10+ Java 文件）
- [ ] 5 份文档 + CHANGELOG + README 完整
- [ ] F1-F4 final verification 全部 APPROVE

### Must Have

- 单元测试 + 集成测试 + 端到端测试
- 完整 demo 项目
- 5 份 docs + CHANGELOG + README
- Windows 平台兼容（`it.runIf(process.platform === 'win32')`）

### Must NOT Have (Guardrails)

- ❌ 不修改 `packages/codegraph/`（上游）
- ❌ 不修改 `packages/springkg-*/` 任何代码（只读 + 测试）
- ❌ 不创建新的 MCP 工具或 CLI（只验证其他 team 的输出）
- ❌ 不写业务逻辑（只验证）

---

## Team Interface Contracts

### Owned Files (EXCLUSIVE)

- `tests/**`（包括 `tests/integration/`、`tests/unit/`）
- `examples/springcloud-demo/**`
- `docs/**`（包括 5 份 .md + future docs）
- `CHANGELOG.md`
- `README.md`（**只改 springkg 章节**，不修改其他部分）

### DO NOT WRITE (其他 team 拥有)

- `packages/codegraph/**` (上游)
- `packages/springkg-core/**` (Team A)
- `packages/springkg-shared/**` (Team A)
- `packages/springkg-semantic/**` (Team B)
- `packages/springkg-data/**` (Team C)
- `packages/springkg-runtime/**` (Team D)
- `packages/springkg-mcp/**`, `packages/springkg-cli/**` (Team E)
- `packages/springkg-community/**` (Team F)
- `packages/springkg-installer/**` (Team A)

### Input Contracts (consumed)

| From | What | When |
|------|------|------|
| All teams | springkg.db schema, all resolvers, MCP server, CLI binaries, 14 tools | 持续 |
| Team A | `SpringKg` class API, schema migrations | Phase G1 开始 |
| Team E | MCP server start, 14 tool schemas | 每个 sprint |

### Output Contracts (produced)

- Validated demo project (end-to-end testable)
- 4 个 e2e test 文件
- 5 份文档
- CHANGELOG 条目
- README 更新

---

## Cross-team Sync Points

| Sync | Trigger | What | Who |
|------|---------|------|-----|
| G0 启动 | 即刻（不依赖其他 team） | Sprint 0 文档产出 | G standalone |
| G0 完成 → Team A Phase 1 | G0 docs 完成 | A 启动包脚手架 | G → A |
| G1 启动 | Team A Phase 2 | demo 项目脚手架 | A → G |
| G1 完成 → Team E Phase E1 | demo + e2e 测试通过 | Team E 验证 MCP 工具 | G → E |
| G2 启动 | Team E Phase E2 完成 | MyBatis demo 扩展 | E → G |
| G3 启动 | Team F 完成 | community demo 扩展 + 最终文档 | F → G |
| F1-F4 终验 | G3 完成 | 整体验证 | G 主导 |

---

## Task List (15 total, 4 phases)

### Phase G0: Sprint 0 documentation (Tasks 1-6)

- [x] 1. [G] T1 — 文档 §1: CodeGraph DB schema

  **What to do**:
  - 读 `src/db/schema.sql`（5 张表 + 索引 + FTS5）
  - 读 `src/db/queries.ts`（QueryBuilder 全部方法）
  - 写 `docs/codegraph-source-analysis.md` §1 (Schema)
  - 内容：5 张表（schema_versions, nodes, edges, files, unresolved_refs, project_metadata）、字段、索引、FTS5 触发器、与 springkg 的关联方案（`codegraph_node_id` 存完整 `${kind}:${sha256truncated_32chars}`）

  **Recommended Agent Profile**:
  - Category: `writing` — 文档
  - Skills: 无

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: G0（6 任务全并行）
  - Blocks: Team A Phase 1
  - Blocked By: None（独立启动）

  **Acceptance Criteria**:
  - [ ] §1 包含全部 5 张表的字段、索引、FTS5
  - [ ] 给出 `springkg.codegraph_node_id` 存储方案

  **QA Scenarios**:
  - Scenario: 文档与 schema 一致
    - Tool: Bash
    - Steps: 对比 `grep -c 'CREATE TABLE' src/db/schema.sql`（应为 5）

- [x] 2. [G] T2 — 文档 §2: Java 抽取器

  **What to do**:
  - 读 `src/extraction/languages/java.ts`（AST 节点处理）
  - 读 `src/extraction/tree-sitter.ts`（`extractDecoratorsFor` 函数）
  - 写 `docs/codegraph-source-analysis.md` §2 (Java Extractor)
  - 内容：抽取的 AST 节点类型（class/method/field/interface/annotation）、`decorators` 字段填充逻辑、Spring 注解如何被识别

  **Recommended Agent Profile**:
  - Category: `writing`
  - Skills: 无

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: G0
  - Blocks: Team B (Semantic)
  - Blocked By: None

  **Acceptance Criteria**:
  - [ ] §2 列出 tree-sitter 抽取的所有 Java 节点类型
  - [ ] §2 给出 `extractDecoratorsFor` 的输出契约

  **QA Scenarios**:
  - Scenario: extractDecoratorsFor 引用
    - Tool: Bash
    - Steps: `grep -c extractDecoratorsFor docs/codegraph-source-analysis.md` >= 1

- [x] 3. [G] T3 — 文档 §3: Spring/MyBatis framework resolvers

  **What to do**:
  - 读 `src/resolution/frameworks/java.ts`（Java DI + Spring 路由提取）
  - 读 `src/extraction/mybatis-extractor.ts`（MyBatis XML）
  - **注**：`spring.ts` 和 `mybatis.ts` framework 文件不存在（仅 `java.ts`）— 文档中明确标注
  - 写 `docs/codegraph-source-analysis.md` §3 (Framework Resolvers)
  - 内容：已支持注解（`@Controller`/`@Service`/`@GetMapping` 等）、缺失注解（`@FeignClient`/`@Mapper` 接口绑定/`@Configuration`+`@Bean`）、MyBatis XML 抽取方法

  **Recommended Agent Profile**:
  - Category: `writing`
  - Skills: 无

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: G0
  - Blocks: Team B, Team C
  - Blocked By: None

  **Acceptance Criteria**:
  - [ ] §3 列出已支持注解（精确到 java.ts 方法名）
  - [ ] §3 给出 MyBatis XML 抽取 schema
  - [ ] §3 明确标注 `@FeignClient` 缺失

  **QA Scenarios**:
  - Scenario: 缺失标注
    - Tool: Bash
    - Steps: `grep -c 'FeignClient.*未抽取\|缺失' docs/codegraph-source-analysis.md` >= 1

- [x] 4. [G] T4 — 文档 §4: MCP 架构

  **What to do**:
  - 读 `src/mcp/tools.ts`（`tools[]` 数组 line 415）
  - 读 `src/mcp/server-instructions.ts`（agent-facing）
  - 读 `src/bin/codegraph.ts` 的 `serve --mcp`
  - 写 `docs/codegraph-source-analysis.md` §4 (MCP Architecture)
  - 内容：工具注册位置（line 415）、`CODEGRAPH_MCP_TOOLS` env var 行为、ToolHandler 模式
  - 明确说"无 plugin 机制"，推荐**独立 MCP server 方案**

  **Recommended Agent Profile**:
  - Category: `writing`
  - Skills: 无

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: G0
  - Blocks: Team E
  - Blocked By: None

  **Acceptance Criteria**:
  - [ ] §4 给出添加新工具的完整模式
  - [ ] §4 明确说"无 plugin 机制"

  **QA Scenarios**:
  - Scenario: tools[] 位置
    - Tool: Bash
    - Steps: `grep -n 'export const tools' src/mcp/tools.ts`（应为 415）

- [x] 5. [G] T5 — 文档 §5: Watcher/Sync

  **What to do**:
  - 读 `src/sync/watcher.ts`（`FileWatcher`、`WatchOptions.onSyncComplete`）
  - 读 `src/extraction/index.ts` `sync()`（SyncResult）
  - 读 `src/index.ts` `CodeGraph.watch()` + `getPendingFiles()`（line 611）
  - 写 `docs/codegraph-source-analysis.md` §5 (Watcher/Sync)
  - **关键正确 API**：
    - `onSyncComplete` 回调**只给** `{filesChanged, durationMs}`（不含文件路径）
    - 文件路径必须用 `cg.getPendingFiles()` → `PendingFile[].path`
  - 给出 springkg 集成方案（正确 API）：`cg.watch({ onSyncComplete: async r => { const paths = (await cg.getPendingFiles()).map(p => p.path); await updateSpringKg(paths); } })`

  **Recommended Agent Profile**:
  - Category: `writing`
  - Skills: 无

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: G0
  - Blocks: Team A
  - Blocked By: None

  **Acceptance Criteria**:
  - [ ] §5 完整同步流程图
  - [ ] §5 列出 SyncResult 字段
  - [ ] §5 给出**正确**的 springkg 集成方案（用 `getPendingFiles`）

  **QA Scenarios**:
  - Scenario: getPendingFiles 引用
    - Tool: Bash
    - Steps: `grep -c 'getPendingFiles' docs/codegraph-source-analysis.md` >= 2

- [x] 6. [G] T6 — Sprint 0 Validation Report

  **What to do**:
  - 在临时目录创建小型 Java + Spring Boot + MyBatis demo
  - 跑 `codegraph init` + `codegraph index`
  - 验证 `codegraph search` / `codegraph explore` 能查到：
    - Java class/method
    - `@GetMapping` route
    - MyBatis XML statement
  - 写 `docs/codegraph-source-analysis.md` §6 (Validation Report)
  - 包含实际命令输出（截断到关键部分）

  **Recommended Agent Profile**:
  - Category: `quick` — 跑命令 + 记录
  - Skills: 无

  **Parallelization**:
  - Can Run In Parallel: YES（可与其他 G0 任务并行）
  - Parallel Group: G0
  - Blocks: Team A 启动确认
  - Blocked By: None

  **Acceptance Criteria**:
  - [ ] `codegraph search "Controller"` 返回至少 1 个 `@RestController` 类
  - [ ] `codegraph search "GET /api"` 返回至少 1 个 route
  - [ ] `codegraph explore` 追踪到 MyBatis XML

  **QA Scenarios**:
  - Scenario: 基础能力验证
    - Tool: Bash
    - Steps: 在 /tmp 创建 demo，跑 codegraph init + search

### Phase G1: Sprint 1 demo + e2e + docs (Tasks 22, 23, 24)

- [x] 7. [G] T22 — examples/springcloud-demo 项目

  **What to do**:
  - 创建 `examples/springcloud-demo/`
  - 文件清单：
    - `pom.xml`（Spring Boot 3.2.x + Spring Cloud + MyBatis + OpenFeign + Nacos，Java 17）
    - `src/main/java/com/example/user/UserController.java`（`@RestController` + `@GetMapping("/api/users")` + `@PostMapping`）
    - `src/main/java/com/example/user/UserService.java`（`@Service` + `@Transactional`）
    - `src/main/java/com/example/user/UserMapper.java`（`@Mapper` interface，3 个方法）
    - `src/main/resources/mapper/UserMapper.xml`（3 个 statement：select/insert/update）
    - `src/main/java/com/example/order/OrderClient.java`（`@FeignClient(name="order-service")`）
    - `src/main/java/com/example/user/UserEntity.java`（`@TableName("users")` + `@TableId` + `@TableField`）
    - `src/main/resources/application.yml`（含 datasource、redis、nacos 配置）
  - **关键**：每个文件 5-15 行（demo 规模，不写真实业务）

  **Recommended Agent Profile**:
  - Category: `deep`
  - Skills: 无

  **Parallelization**:
  - Can Run In Parallel: NO
  - Parallel Group: G1（先 T22，T23、T24 等）
  - Blocks: T23, T24
  - Blocked By: Team A Phase 2

  **Acceptance Criteria**:
  - [ ] 8+ Java 文件
  - [ ] 包含 8 种 springkg 关注的注解
  - [ ] 注释说明每种用法

  **QA Scenarios**:
  - Scenario: 完整性
    - Tool: Bash
    - Steps: `find examples/springcloud-demo -name "*.java" | wc -l` >= 8

- [x] 8. [G] T23 — Sprint 1 e2e 测试

  **What to do**:
  - `tests/integration/sprint1-e2e.test.ts`:
    1. `springkg init examples/springcloud-demo`
    2. `springkg index examples/springcloud-demo`
    3. 启动 `springkg-mcp` 子进程
    4. 通过 stdio 调用 4 个 spring_* 工具
    5. 验证返回值与 demo 结构一致
  - 使用 vitest 的 `child_process.spawn` 起 `springkg-mcp`
  - 每个 MCP 工具至少 1 个 case

  **Recommended Agent Profile**:
  - Category: `deep`
  - Skills: 无

  **Parallelization**:
  - Can Run In Parallel: NO
  - Parallel Group: G1
  - Blocks: F1-F4
  - Blocked By: T22, Team E Phase E1

  **Acceptance Criteria**:
  - [ ] 4 个 MCP 工具 case 跑通
  - [ ] 集成测试 < 60 秒

  **QA Scenarios**:
  - Scenario: 端到端
    - Tool: vitest
    - Steps: `npx vitest run tests/integration/sprint1-e2e.test.ts` 0 失败

- [x] 9. [G] T24 — Sprint 1 文档 + CHANGELOG

  **What to do**:
  - `docs/architecture.md`：springkg 4 层架构图 + 包关系
  - `docs/mcp-tools.md`：4 个 spring_* 工具 schema + 示例
  - `docs/schema.md`：8 张表 + ER 图
  - `docs/validation.md`：Sprint 1 MVP 10 条验证报告
  - `CHANGELOG.md` [Unreleased] 加 Sprint 1 条目

  **Recommended Agent Profile**:
  - Category: `writing`
  - Skills: 无

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: G1
  - Blocks: Sprint 2 启动
  - Blocked By: T22, T23

  **Acceptance Criteria**:
  - [ ] 4 份文档全部创建
  - [ ] CHANGELOG 新条目

  **QA Scenarios**:
  - Scenario: 文档完整
    - Tool: Bash
    - Steps: `ls docs/` 看到 architecture + mcp-tools + schema + validation + codegraph-source-analysis

### Phase G2: Sprint 2-3 demo 扩展 + e2e (Tasks 35, 36, 46)

- [x] 10. [G] T35 — demo MyBatis 扩展

  **What to do**:
  - 在 `examples/springcloud-demo/` 中：
    - `UserMapper.java` 加 `@Select("SELECT * FROM users WHERE id = #{id}")` 注解 SQL
    - `UserMapper.xml` 加 3 个 statement
    - `UserEntity.java` 加 `@TableName("users")`/`@TableId`/`@TableField`

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: 无

  **Parallelization**:
  - Can Run In Parallel: NO
  - Parallel Group: G2
  - Blocks: T36
  - Blocked By: T22

  **Acceptance Criteria**:
  - [ ] 3 个 SQL statement
  - [ ] 1 个 Entity 类

  **QA Scenarios**:
  - Scenario: demo 完整
    - Tool: Bash
    - Steps: `ls examples/springcloud-demo/src/main/java/com/example/user/`

- [x] 11. [G] T36 — Sprint 2 e2e + 文档

  **What to do**:
  - `tests/integration/sprint2-e2e.test.ts`：
    - 验证 V1 §1（Endpoint → Mapper → SQL → Table 链路）
    - 调 `spring_trace_flow` 深度 5
  - `docs/mcp-tools.md` 加 spring_find_mapper
  - `docs/validation.md` 加 V1 §1 验证
  - `CHANGELOG.md` 加 Sprint 2 条目

  **Recommended Agent Profile**:
  - Category: `unspecified-low`
  - Skills: 无

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: G2
  - Blocks: Sprint 3
  - Blocked By: T35, Team E Phase E2

  **Acceptance Criteria**:
  - [ ] V1 §1 验证通过
  - [ ] 文档更新

  **QA Scenarios**:
  - Scenario: V1 §1 验证
    - Tool: vitest
    - Steps: 调 spring_trace_flow depth=5 返回 5 层

- [x] 12. [G] T46 — Sprint 3 e2e + 文档

  **What to do**:
  - `tests/integration/sprint3-e2e.test.ts`：
    - 验证 V1 §2 (Feign bridge)、V1 §5 (@Scheduled)、V1 §7 (ConfigProperty 反查)
  - `docs/mcp-tools.md` 加 3 个工具（spring_find_config, spring_nacos_overview, spring_gateway_route）
  - `docs/validation.md` 加 V1 §2/§4/§5/§7
  - `CHANGELOG.md` 加 Sprint 3 条目

  **Recommended Agent Profile**:
  - Category: `unspecified-low`
  - Skills: 无

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: G2
  - Blocks: Sprint 4
  - Blocked By: T36, Team E Phase E2

  **Acceptance Criteria**:
  - [ ] V1 §2/§4/§5/§7 验证
  - [ ] 文档更新

  **QA Scenarios**:
  - Scenario: V1 §2/§5/§7 验证
    - Tool: vitest
    - Steps: 3 个 case 跑通

### Phase G3: Sprint 4 demo 扩展 + 最终文档 (Tasks 57, 58, 67)

- [x] 13. [G] T57 — demo community 扩展 + e2e

  **What to do**:
  - 在 `examples/springcloud-demo/` 中：
    - 加 `OrderController.java`（含 `@Scheduled` method）
    - 加 `OrderService.java`（含 `@Transactional`）
    - 加 `OrderMapper.java`
  - `tests/integration/sprint4-e2e.test.ts`：
    - 完整链路 search_feature → trace_flow → method_impact
    - 验证 V1 §3/§8/§9/§10

  **Recommended Agent Profile**:
  - Category: `deep`
  - Skills: 无

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: G3
  - Blocks: F1-F4
  - Blocked By: Team F + Team E Phase E3

  **Acceptance Criteria**:
  - [ ] e2e 测试 0 失败
  - [ ] V1 §3/§8/§9/§10 验证

  **QA Scenarios**:
  - Scenario: 完整功能检索
    - Tool: vitest
    - Steps: search_feature({query:"订单"}) 返回相关 community

- [x] 14. [G] T58 — Sprint 4 文档 + README + 最终 CHANGELOG

  **What to do**:
  - `docs/mcp-tools.md` 完整（14 个工具）
  - `docs/validation.md` 完整（V1 §1-§10）
  - `README.md` 加 springkg 章节（安装、配置、CLI 用法）
  - `CHANGELOG.md` 完整 Sprint 1-4 条目

  **Recommended Agent Profile**:
  - Category: `unspecified-low`
  - Skills: 无

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: G3
  - Blocks: F1-F4
  - Blocked By: T57

  **Acceptance Criteria**:
  - [ ] 4 份文档全部更新
  - [ ] CHANGELOG 完整

  **QA Scenarios**:
  - Scenario: 文档完整
    - Tool: Bash
    - Steps: `ls docs/` 看到 5 个 .md

- [x] 15. [G] T67 — demo Coverage Matrix

  **What to do**:
  - `examples/springcloud-demo/README.md`：
    - 表格：14 个 MCP 工具 → 触发的 demo 文件/类 → 预期结果
    - 每个 V1 验收标准（§1-§10）映射到具体 demo 文件
    - 每行格式：`spring_find_entry(url) → UserController.getUserById → @GetMapping("/api/users/{id}")`
  - 表格覆盖全部 14 工具

  **Recommended Agent Profile**:
  - Category: `writing`
  - Skills: 无

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: G3
  - Blocks: F1-F4
  - Blocked By: T22, T35, T57

  **Acceptance Criteria**:
  - [ ] 14 个工具各 1 行
  - [ ] 10 个 V1 验收各 1 行

  **QA Scenarios**:
  - Scenario: 文档完整
    - Tool: Bash
    - Steps: `grep -c 'spring_' examples/springcloud-demo/README.md` >= 14

---

## Verification Strategy

- **单测**：在 Team A-G 各自的 `__tests__/` 中
- **集成测试**：`tests/integration/sprint{1-4}-e2e.test.ts`（Team G 写）
- **端到端**：demo 项目 + MCP 工具完整链路
- **最终验证**：F1-F4（由 Team G 主导运行）

---

## Definition of Done (Team G)

- [x] 6 份 source-analysis 文档（Sprint 0）
- [x] 4 个 sprint 集成测试 0 失败
- [x] demo 项目完整（10+ Java 文件）
- [x] 5 份文档完整
- [x] CHANGELOG 4 个 sprint 条目
- [x] README springkg 章节
- [x] V1 §1-§10 全部验证
- [x] F1-F4 final verification 全部 APPROVE
- [x] **不修改** `packages/codegraph/` 或 `packages/springkg-*/` 任何代码

---

## Risks & Mitigations

| 风险 | 缓解 |
|------|------|
| demo 项目太大导致 index 慢 | 限制 10-15 Java 文件，每个 5-15 行 |
| MCP server 启动超时 | 测试中用 10s 超时；启动后等 1s 再发 initialize |
| Windows 路径问题 | `it.runIf(process.platform === 'win32')` 包装 |
| 集成测试 mock 整个 springkg-mcp | 用真实子进程（`child_process.spawn`）更可靠 |
| CHANGELOG 格式不符 CLAUDE.md 要求 | 严格按 CLAUDE.md §"Writing changelog entries" 格式 |

---

## Worktree & Commit Strategy

- Worktree: `../cg-team-g` 分支 `team-g-validation`
- Commit：每个 task 一个 commit，消息 `feat(validation): T1 schema docs` 或 `test(sprint1): e2e test`
- Merge 时机：每个 Phase（G0/G1/G2/G3）完成后 squash merge
- Tag: 跟随主 plan 的 v0.x.0 标签
- **关键**：G 是最持续的 team，从一开始就在跑（Phase G0 与 Team A Phase 1 并行）
