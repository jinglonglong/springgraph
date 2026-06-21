# CodeGraph-SpringCloud 实施计划（团队优先并行模式）

## TL;DR

> **Quick Summary**: 基于 CodeGraph 二开 SpringCloud 微服务专项知识图谱，独立 springkg 包，**7 个团队（Team A-G）并行开发**，每个团队独立 worktree。完整实现 Sprint 0-4。
>
> **Deliverables**:
> - **7 个团队独立 plan**：`team-a.md` (Foundation) / `team-b.md` (Semantic) / `team-c.md` (Data) / `team-d.md` (Runtime) / `team-e.md` (MCP) / `team-f.md` (Community) / `team-g.md` (Validation)
> - **8 个 packages**：`packages/springkg-{core,shared,semantic,data,runtime,community,mcp,cli,installer}/`
> - **1 个独立 MCP server**（stdio）：15 个 `spring_*` 工具
> - **8 张表**的 `springkg.db`（在 `.codegraph/springkg.db`）
> - **6 个 CLI 命令**（init/index/status/inspect/watch/rebuild-community/uninit/install）
> - **完整示例项目** `examples/springcloud-demo/`
> - **5 份文档** + CHANGELOG
>
> **Team Structure**: 7 团队并行 + Team G 持续验证
> **Critical Path**: Team A Phase 1 → Teams B/C/D 启动 → Team E 工具 → Team F 社区 → Team G 终验

---

## Context

### Original Request

基于 `资料/CodeGraph-SpringCloud_设计方案.docx` 和 `CodeGraph-SpringCloud_VibeCoding_实施方案.md` 的设计：
- 不重复造 CodeGraph 轮子
- 完整实现 Sprint 0-4
- 独立 springkg 包结构
- 单元测试 + 示例项目验证
- **使用 7 团队并行**（用户最新决策）

### Team Strategy

**7 个团队 + 7 个独立 git worktree**，团队间通过明确定义的**接口契约**协调：

```
Team A (Foundation)  ── produces ──> SpringKg class API + springkg.db schema + WAL config
       │
       ├─ Team B (Semantic)  ── produces ──> AnnotationEngine, EndpointResolver, FeignResolver
       │                                           │
       ├─ Team C (Data)      ── produces ──> MyBatis XML, SQL, Mapper binding ─┤
       │                                           │
       └─ Team D (Runtime)   ── produces ──> ConfigResolver, Nacos, Gateway   ─┤
                                                                           │
                                                              Team E (MCP)  ── consumes all above, produces 15 spring_* tools
                                                                           │
                                                              Team F (Community) ── consumes B+C+D, produces 6 impact tools (in E)
                                                                           │
                                                              Team G (Validation) ── consumes ALL, runs e2e + writes docs
```

### Research Findings（关键架构决策）

- **MCP**：无 plugin 机制 → springkg 独立 MCP server（stdio）
- **SQLite**：`springkg.db` 在 `.codegraph/`（同 `codegraph.db`，被 watcher 自动跳过）
- **Node ID**：`${kind}:${sha256truncated_32chars}`（确定性 hash）
- **增量更新 hook**：`onSyncComplete` 回调**只给 `{filesChanged, durationMs}`** → 用 `cg.getPendingFiles()` 或 `cg.sync()` 返回值
- **CodeGraph 已有能力**：`@Controller`/`@Service`/`@GetMapping` 已抽取 → Team B 复用不重复
- **安全**：`decorators?: string[]` 足够；`value_hash` 必填；敏感值必脱敏

---

## Work Objectives

### Core Objective

构建 SpringCloud 专项知识图谱：识别 Controller/Service/Feign/Mapper/SQL/Nacos/Gateway 实体和关系，支持 Agent 通过 MCP 工具查询入口、调用链、影响面、配置资产和功能模块。

### Concrete Deliverables

| Team | 拥有 | 交付 |
|------|------|------|
| **A** (Foundation) | `packages/springkg-{core,shared,installer}/` | DB schema、SpringKg class、schema migration、confidence column、WAL、版本约束 |
| **B** (Semantic) | `packages/springkg-semantic/` | AnnotationEngine、EndpointResolver、FeignResolver、FeignProviderBridge、add-vs-reuse policy |
| **C** (Data) | `packages/springkg-data/` | MyBatis XML、SQL table/column、Mapper binding、MyBatis-Plus entity |
| **D** (Runtime) | `packages/springkg-runtime/` | ConfigResolver、MiddlewareInventory、NacosConfigResolver、GatewayRouteResolver |
| **E** (MCP) | `packages/springkg-{mcp,cli}/` | 15 spring_* 工具、独立 MCP server、7 个 CLI、server-instructions.ts、springkg-installer |
| **F** (Community) | `packages/springkg-community/` | CommunityBuilder、SummaryGenerator、DirtyQueue |
| **G** (Validation) | `tests/` + `examples/springcloud-demo/` + `docs/` | 示例项目、e2e 测试、单元测试覆盖率、5 份文档、CHANGELOG |

### Definition of Done

- [ ] 7 个 team plan 全部完成
- [ ] Team A 输出 schema API + SpringKg class 稳定（其他 team 依赖）
- [ ] Team B/C/D 各自输出 resolver，append-only 写 `spring_symbols` / `spring_edges`
- [ ] Team E 输出 15 个 MCP 工具 + 独立 server
- [ ] Team F 输出 4 个 community 模块
- [ ] Team G 输出完整 demo + 5 份文档 + 100% 测试通过
- [ ] `npm test` 0 失败
- [ ] 敏感配置（password/secret/token）全部脱敏
- [ ] `springkg.db` 在 `.codegraph/springkg.db`，没有 `.springkg/` 目录
- [ ] `packages/codegraph/`（CodeGraph 上游）未修改
- [ ] 用户明确说"okay"才算完成

### Must Have

- 7 个独立团队 + 独立 worktree
- 独立 springkg 包结构（`packages/springkg-*`）
- 8 张表 schema + migration
- 15 个 MCP 工具
- 完整示例项目 + 单元测试 + 端到端测试
- 5 份文档（architecture/source-analysis/mcp-tools/schema/validation）
- 6 个 CLI 命令
- CHANGELOG.md

### Must NOT Have (Guardrails)

- ❌ 直接修改 CodeGraph 核心代码（`src/index.ts`、`src/db/schema.sql`、`src/extraction/languages/*` 等）
- ❌ 在 CodeGraph 的 `tools[]` 数组里添加 springkg 工具
- ❌ 在项目根创建 `.springkg/` 目录
- ❌ 依赖 Neo4j / Milvus / Nacos OpenAPI
- ❌ 敏感配置明文存储
- ❌ 任何会阻塞主线程的同步操作
- ❌ 重复造 CodeGraph 已有的轮子（FTS5、SQLite、watcher、resolver）
- ❌ AI slop：过度抽象、通用命名、过度注释
- ❌ 跨 team 越权修改其他 team 拥有的文件

### Spec Framework Integration

- **Detected Framework**: None
- N/A — 直接走工作流

---

## Team Structure（7 团队并行）

### Worktree 分配

每个团队一个独立 worktree，分支命名 `team-{a..g}`：

```bash
# Team A 立即启动（其他团队 Blocked By A）
git worktree add -b team-a-foundation ../cg-team-a main

# Team B/C/D 在 Team A Phase 1 完成后启动
git fetch && git worktree add -b team-b-semantic ../cg-team-b main
git fetch && git worktree add -b team-c-data ../cg-team-c main
git fetch && git worktree add -b team-d-runtime ../cg-team-d main

# Team E 在 Team B/C/D 都有 resolver 雏形后启动（需要先有 resolvers 才能做工具）
git fetch && git worktree add -b team-e-mcp ../cg-team-e main

# Team F 在 Team B/C/D 完整后启动
git fetch && git worktree add -b team-f-community ../cg-team-f main

# Team G 从一开始就启动（持续验证）
git fetch && git worktree add -b team-g-validation ../cg-team-g main
```

每个 team merge 时机：
- Team A：Phase 1 完成（schema + SpringKg）→ 其他人开始 → Phase 2 完成（infrastructure） → merge
- Team B/C/D：每个 sprint 完整功能实现后 merge
- Team E：每个工具集（Sprint 1 / Sprint 2-3 / Sprint 4）完成后 merge
- Team F：Community 模块完成后 merge
- Team G：每个 sprint 集成测试完成后 merge

### Team 接口契约

**文件所有权**（关键！禁止跨 team 越权）：

| Team | 拥有 |
|------|------|
| A | `packages/springkg-core/`, `packages/springkg-shared/`, `packages/springkg-installer/`, `package.json` (workspaces), `tsconfig.json` (主) |
| B | `packages/springkg-semantic/src/**` |
| C | `packages/springkg-data/src/**` |
| D | `packages/springkg-runtime/src/**` |
| E | `packages/springkg-mcp/src/**`, `packages/springkg-cli/src/**` |
| F | `packages/springkg-community/src/**` |
| G | `examples/springcloud-demo/`, `tests/integration/`, `docs/`, `CHANGELOG.md`, `README.md` |

**跨 team 共享接口**（通过 `packages/springkg-shared/src/index.ts` 暴露）：

```typescript
// Team A 暴露，Team B/C/D 消费
export interface SpringKgNodeKind { /* controller, service, feign_client, mapper, ... */ }
export interface SpringKgEdgeKind { /* HANDLED_BY, CALLS, EXECUTES_SQL, ... */ }
export interface SpringKgNode { id: string; kind: SpringKgNodeKind; codegraphNodeId: string; name?: string; ... }
export interface SpringKgEdge { id: string; sourceId: string; targetId: string; kind: SpringKgEdgeKind; ... }
export interface SpringKgEnhanceInput { codegraphNodes: CodeGraphNode[]; codegraphEdges: CodeGraphEdge[]; changedFiles: string[]; }
export interface SpringKgEnhanceOutput { symbolsAdded: number; edgesAdded: number; byKind: Record<string, number>; }
export interface Resolver { name: string; enhance(input: SpringKgEnhanceInput): Promise<SpringKgEnhanceOutput>; }
```

**Append-only 写 `springkg.db`**（避免 team 互相覆盖）：

| Team | 写 kind | 写 edge |
|------|---------|---------|
| A | (none — 只维护 schema) | (none) |
| B | `controller`, `service`, `repository`, `component`, `feign_client`, `feign_method`, `endpoint`, `remote_service` | `HANDLED_BY`, `CALLS`, `BELONGS_TO`, `CALLS_FEIGN`, `TARGETS_ENDPOINT` |
| C | `mapper`, `mapper_method`, `sql_statement`, `entity`, `table`, `column` | `EXECUTES_SQL`, `READS_TABLE`, `WRITES_TABLE`, `MAPS_TO_TABLE`, `BIND_TO`, `USES_COLUMN`, `MAPS_FIELD` |
| D | `config_property`, `middleware`, `nacos_cluster`, `nacos_service`, `nacos_config`, `gateway_route` | `CONNECTS_TO`, `LOADS_CONFIG`, `ROUTES_TO`, `MATCHES_PATH`, `USED_BY` |
| E | (none — 只读其他 team 写入的 symbols) | (none) |
| F | `feature_community`, `feature_community_member` | `MEMBER_OF` |
| G | (none) | (none) |

**共享配置**（Team A 拥有，其他 team 引用）：

```typescript
// packages/springkg-shared/src/config.ts
export const SPRINGKG_CONFIG = {
  db: {
    filename: 'springkg.db',
    // 在 .codegraph/ 中
  },
  mcp: {
    name: 'springkg-mcp',
    version: '0.1.0',
  },
  // 敏感 key 模式（Team D 使用）
  sensitiveKeyPatterns: [/password/i, /secret/i, /token/i, /access-key/i, ...],
};
```

---

## Cross-team Sync Points

### Phase 1: Foundation（Team A 单独）

- **产出**：`packages/springkg-shared/src/index.ts` 接口定义
- **产出**：`packages/springkg-core/src/spring-kg.ts` SpringKg class 雏形
- **产出**：`packages/springkg-core/src/db/schema.sql` 8 张表
- **产出**：`packages/springkg-core/src/db/migrations/001_initial_8_tables.sql`
- **完成条件**：`new SpringKg({ projectPath }).init()` 跑通
- **同步会议**：Team A 完成 Phase 1 后，通知 Teams B/C/D 启动

### Phase 2: Resolvers（Teams B/C/D 并行）

- **依赖**：Team A Phase 1
- **产出**：
  - Team B：`packages/springkg-semantic/src/annotation-engine.ts` + tests
  - Team C：`packages/springkg-data/src/mybatis-xml-extractor.ts` + tests
  - Team D：`packages/springkg-runtime/src/config-resolver.ts` + tests
- **完成条件**：每个 team 至少有 1 个 resolver 通过单测

### Phase 3: MCP Tools Sprint 1（Team E + Team G）

- **依赖**：Team B FeignResolver + Team D ConfigResolver
- **产出**：
  - Team E：4 个 spring_* 工具（spring_find_entry, spring_trace_flow, spring_find_feign, spring_assets_overview）
  - Team E：独立 MCP server 启动
  - Team G：examples/springcloud-demo 初始 demo
- **完成条件**：4 个工具对 demo 项目返回真实数据

### Phase 4: Sprint 2（Team C + Team E + Team G）

- **依赖**：Phase 3
- **产出**：MyBatis XML/SQL/Mapper 完整 + spring_find_mapper + trace_flow 扩展

### Phase 5: Sprint 3（Team D + Team E + Team G）

- **产出**：Nacos/Gateway/ConfigProperty + 3 MCP 工具

### Phase 6: Sprint 4（Team F + Team E + Team G）

- **产出**：CommunityBuilder/SummaryGenerator/DirtyQueue + 6 MCP 工具

### Phase 7: Final Verification（Team G 主导）

- 4 个 F 任务运行

---

## V1 Validation Spec（对应设计文档 §14.2）

> V1 = Sprint 2-4 完整验收。

| V1 编号 | 内容 | 验证命令/标准 | 涉及 Team |
|---------|------|---------------|-----------|
| V1 §1 | Endpoint → Mapper → SQL → Table 链路 | `spring_trace_flow(url="/api/x", depth=5)` 输出 5 层 | E (T34), C (T25-30) |
| V1 §2 | FeignClient → Provider endpoint 跨服务 | `spring_find_feign({name:"X"})` 含 `target_endpoint` | E (T19), B (T41) |
| V1 §3 | MapStruct 字段映射 | `spring_field_impact` 返回受影响字段 | E (T52) |
| V1 §4 | MQ producer/consumer | `spring_find_entry({mq:"topic"})` | E (T18), D |
| V1 §5 | @Scheduled 任务入口 | `spring_find_entry({scheduled:"*"})` | E (T18), F (T57) |
| V1 §6 | @Transactional 边界 | `spring_method_impact` 含 transaction | E (T52) |
| V1 §7 | ConfigProperty 反查 | `spring_find_config` 返回 @Value 位置 | E (T44), D (T38) |
| V1 §8 | 功能社区检索 | `spring_search_feature({query:"订单"})` | E (T51), F (T47) |
| V1 §9 | 方法影响分析 | `spring_method_impact` 4+ sections | E (T52) |
| V1 §10 | 字段影响分析 | `spring_field_impact` 2+ sections | E (T52) |

---

## Verification Strategy

### Test Strategy

- **每个 Team 独立 vitest 配置**（不互相依赖）
- **TDD**：先写 RED test，再实现 GREEN
- **Team G 跑端到端**（集成多个 team 输出）
- **每个 MCP 工具单测** + **CLI subprocess 验证**

### QA Policy

- 每个 task 必须有 Agent-Executed QA Scenarios
- 证据保存到 `.omo/evidence/team-{a..g}/task-{N}-{slug}.{ext}`
- F1-F4 final verification 由 Team G 主导

---

## Execution Strategy

### Timeline 概览

```
Time →
├─ Phase 1: A only           [1-2 days]
├─ Phase 2: A | B | C | D | G [3-4 days]   (G runs tests continuously)
├─ Phase 3: A | B | C | D | E | G         [2-3 days]
├─ Phase 4: A | B | C | D | E | G         [2-3 days]  (Sprint 2)
├─ Phase 5: A | B | C | D | E | G         [2-3 days]  (Sprint 3)
├─ Phase 6: A | B | C | D | E | F | G     [3-4 days]  (Sprint 4)
└─ Phase 7: F1-F4 + cleanup [1 day]
```

### 跨 team 协调机制

- **共享文档**：`docs/team-coordination.md`（Team G 维护）记录：
  - 团队当前进度
  - 接口变更通知
  - 集成测试结果
- **每日同步**：每个 team 的 main entry（`.claude/agents/`）有 team lead agent 监听其他 team 状态

### Agent Dispatch Summary

- **Team A**：`deep` category × 1 orchestrator + `quick` × 5（脚手架任务）
- **Team B**：`deep` × 1 + `unspecified-high` × 2
- **Team C**：`deep` × 1 + `unspecified-high` × 2
- **Team D**：`deep` × 1 + `unspecified-high` × 2
- **Team E**：`deep` × 2 + `unspecified-high` × 3（工具实现）
- **Team F**：`deep` × 1 + `unspecified-high` × 1
- **Team G**：`unspecified-high` × 2 + `writing` × 1（文档）

---

## TODOs

> **实现 + 测试 = 同一 task**
> **任务分布在 7 个 team plan**（`.omo/plans/team-{a..g}.md`）
> **主 plan 协调 + 总验证**

---

## Final Verification Wave (MANDATORY — after ALL team plans complete)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read all 8 plan files (主 + 7 team plans). For each Must Have: verify implementation exists. For each Must NOT Have: search codebase for forbidden patterns. Check evidence files exist. Compare 7 team outputs against their plan deliverables.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Teams [7/7] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `npm test` in main. Run `npx tsc --noEmit`. Review all changed files in `packages/springkg-*/`: `as any`/`@ts-ignore`, empty catches, console.log, commented-out code, unused imports. Verify `springkg.db` in `.codegraph/`, not `.springkg/`. Check each team's owned files only contains their work.
  Output: `Build [PASS/FAIL] | Tests [N/N] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high` + Playwright
  Start from clean state. Execute 14 MCP tools against demo project. Test all 10 V1 criteria. Test cross-team integration. Save evidence to `.omo/evidence/final-qa/`.
  Output: `V1 [N/10] | MCP tools [N/14] | Integration [N/N] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each of the **74 tasks** (15 + 6 + 9 + 6 + 20 + 3 + 15 across 7 team plans): read "What to do", read actual diff. Verify 1:1. Check "Must NOT do" per task. Detect cross-team contamination: Team X touching Team Y's files. Flag unaccounted changes in `packages/codegraph/` (must be UNTOUCHED).
  Output: `Tasks [72/72] | Cross-team contamination [CLEAN/N] | CodeGraph core [UNTOUCHED] | VERDICT`

---

## Commit Strategy

每个 team 在自己的 worktree 中按 sprint 边界 commit。Main 分支 squash-merge：

| Team | 分支 | 合并时机 |
|------|------|----------|
| A | `team-a-foundation` | Phase 1（schema + SpringKg）完成 + Phase 2（infrastructure）完成 |
| B | `team-b-semantic` | 每个 sprint 完整 resolver 集 |
| C | `team-c-data` | Sprint 2 完成（数据访问） |
| D | `team-d-runtime` | Sprint 3 完成（运行资产） |
| E | `team-e-mcp` | Sprint 1（4 工具）→ Sprint 2-3（4 工具）→ Sprint 4（6 工具） |
| F | `team-f-community` | Sprint 4 完成（社区） |
| G | `team-g-validation` | 每个 sprint 集成测试 |

**Tag**：
- `v0.1.0-springkg-foundation`（Team A Phase 1 后）
- `v0.2.0-springkg-mvp`（Sprint 1 后）
- `v0.3.0-springkg-data`（Sprint 2 后）
- `v0.4.0-springkg-runtime`（Sprint 3 后）
- `v1.0.0-springkg-v1`（Sprint 4 后）

**Pre-commit**：`npm test` 必须 0 失败 + 跨 team 文件不越权

---

## Success Criteria

### Verification Commands

```bash
# Team A 验证
ls packages/springkg-{core,shared,installer}/package.json
test -f .codegraph/springkg.db
sqlite3 examples/springcloud-demo/.codegraph/springkg.db "SELECT COUNT(*) FROM spring_symbols"

# Team B 验证
npx vitest run packages/springkg-semantic

# Team C 验证
sqlite3 .codegraph/springkg.db "SELECT COUNT(*) FROM spring_sql_statements"

# Team D 验证
sqlite3 .codegraph/springkg.db "SELECT COUNT(*) FROM spring_symbols WHERE kind LIKE 'nacos%'"

# Team E 验证
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | npx springkg-mcp

# Team F 验证
sqlite3 .codegraph/springkg.db "SELECT COUNT(*) FROM feature_communities"

# Team G 验证
npm test  # 所有包
npx vitest run tests/integration/  # 所有 e2e
```

### Final Checklist

- [ ] 7 个 team plan 全部完成
- [ ] 所有 74 实施任务完成
- [ ] F1-F4 final verification 全部 APPROVE
- [ ] `packages/codegraph/`（上游）未修改
- [ ] `springkg.db` 在 `.codegraph/springkg.db`
- [ ] 15 个 MCP 工具全部实现 + 测试
- [ ] 8 张表全部有数据
- [ ] 6 个 CLI 命令全部可用
- [ ] 5 份 docs + CHANGELOG 完整
- [ ] 敏感配置脱敏
- [ ] 用户明确说"okay"才算完成
