# Team F 实施计划 — Community / Impact Analysis

## TL;DR

> **Team F**: Feature community detection, summary generation, dirty queue
> **Owns**: `packages/springkg-community/src/**` + `__tests__/**`
> **Worktree**: `team-f-community` (独立)
> **Critical Path**: T47 → T48 → T49 → 同步给 Team E Phase E3

---

## Context

Team F 是 7 团队并行模式中的 1 个，负责**功能社区层**（Feature Community Layer）：
- 接收 Teams B/C/D 写入的 `spring_symbols` + `spring_edges`
- 聚类成功能社区
- 生成社区摘要
- 提供给 Team E 的 6 个 community/impact MCP 工具（T51-T56）

设计文档参考：§4.4 "第四层：Feature Community Layer 功能社区摘要层" 和 §6.2 P1 §5 "功能社区初版"。

---

## Work Objectives

### Core Objective

实现功能社区发现、摘要生成、增量更新机制。社区 = 一组协同完成某业务功能的代码节点。

### Concrete Deliverables

- `packages/springkg-community/src/community-builder.ts` — CommunityBuilder
- `packages/springkg-community/src/summary-generator.ts` — SummaryGenerator
- `packages/springkg-community/src/dirty-queue.ts` — DirtyQueue
- 单元测试覆盖

### Definition of Done

- [ ] CommunityBuilder 单测覆盖连通子图、包路径加权、黑名单
- [ ] SummaryGenerator 生成含 7 个 section 的摘要
- [ ] DirtyQueue 节流 60s，支持手动触发
- [ ] demo 项目触发后 feature_communities 至少 1 个

### Must Have

- 3 个核心模块 + 单测
- 写 `feature_communities` + `feature_community_members` 表（append-only）
- 用 `cg.getPendingFiles()` 拿变更文件路径

### Must NOT Have (Guardrails)

- ❌ 不修改 `packages/codegraph/` 或 `packages/springkg-{core,semantic,data,runtime,mcp,cli}/`
- ❌ 不写其他 team 的 `spring_symbols` kind
- ❌ 同步阻塞操作

---

## Team Interface Contracts

### Owned Files (EXCLUSIVE)

- `packages/springkg-community/src/**`
- `packages/springkg-community/__tests__/**`

### DO NOT WRITE (其他 team 拥有)

- `packages/springkg-core/**` (Team A)
- `packages/springkg-semantic/**` (Team B)
- `packages/springkg-data/**` (Team C)
- `packages/springkg-runtime/**` (Team D)
- `packages/springkg-mcp/**`, `packages/springkg-cli/**` (Team E)
- `examples/springcloud-demo/**`, `tests/integration/**`, `docs/**` (Team G)

### Input Contracts (consumed)

| From | What | When |
|------|------|------|
| Team A | `feature_communities` + `feature_community_members` table schema | 启动前 |
| Team A | `SpringKg` class + `enhanceOnSync` 调度点 | T49 集成时 |
| All teams | `spring_symbols` + `spring_edges` (read-only) | 运行时 |

### Output Contracts (produced)

| What | Consumed by |
|------|-------------|
| `CommunityBuilder` class | Team E T51 (`search_feature`) |
| `SummaryGenerator` class | Team E T51, T53 (`module_summary`) |
| `feature_communities` table rows | Team E 全部 community 工具 |
| `feature_community_members` table rows | Team E 全部 community 工具 |

### Writes to `springkg.db` (append-only)

- **Node kinds**: `feature_community`, `feature_community_member`
- **Edge kinds**: `MEMBER_OF`

---

## Cross-team Sync Points

| Sync | Trigger | What | Who |
|------|---------|------|-----|
| T47 启动 | Team A Phase 1 完成 | SpringKg class + schema | A → F |
| T48 启动 | T47 完成 | CommunityBuilder outputs | F internal |
| T49 启动 | T48 完成 | 接入 enhanceOnSync | F internal |
| T49 完成 → Team E Phase E3 | T49 单测通过 | 6 个 community/impact 工具可工作 | F → E |
| Team G e2e 验证 | T49 完成 | demo 触发后社区数据存在 | F → G |

---

## Task List

- [ ] 1. [F] T47 — CommunityBuilder

  **What to do**:
  - `packages/springkg-community/src/community-builder.ts`
  - 类 `CommunityBuilder`
  - 方法 `build(symbols: Node[], edges: Edge[]): { communities: Community[]; members: Member[] }`
  - 聚类算法：
    - Step 1: 按连通子图（connected subgraph）划分基础社区
    - Step 2: 业务包路径加权（`com.example.order.*` 优先聚类，权重 ×2）
    - Step 3: 黑名单过滤：`Result`, `CommonResult`, `StringUtils`, `DateUtils`, `Page`, `PageInfo`
  - 输出：
    - `feature_communities` 表：id, name (auto-generated from dominant package, e.g. `com.example.order` → "order"), summary="" (placeholder, 由 T48 填充), keywords=null, dirty=1
    - `feature_community_members` 表：community_id, member_node_id (即 codegraph_node_id)
  - 命名：`autoName(dominantPackage: string): string` → `com.example.order.cancel` → "order-cancel"

  **Recommended Agent Profile**:
  - Category: `deep` — 算法实现
  - Skills: 无

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: F 内部 W1（与 T48 并行 - 写测试不冲突）
  - Blocks: T48, T49
  - Blocked By: Team A Phase 1（SpringKg class 雏形 + `feature_communities` schema）

  **Acceptance Criteria**:
  - [ ] 3 个 case：连通子图、package 权重、黑名单
  - [ ] 输入 5 个同包类 + 3 个跨包类 → 至少 2 个 community
  - [ ] 含 `CommonResult` 的边不聚合为 community 节点
  - [ ] community.name 不含 `com.example.` 前缀（截断到最有意义的 segment）

  **QA Scenarios**:
  - Scenario: 连通子图
    - Tool: vitest
    - Steps: 输入 5 个互连节点 + 3 个独立节点 → 输出 4 个 community
  - Scenario: 包路径加权
    - Tool: vitest
    - Steps: 输入 5 个 `com.example.order.*` + 2 个 `com.example.user.*` + 5 个跨包边 → order 优先聚合
  - Scenario: 黑名单
    - Tool: vitest
    - Steps: 输入含 `StringUtils` 节点 → 不出现在任何 community

- [ ] 2. [F] T48 — SummaryGenerator

  **What to do**:
  - `packages/springkg-community/src/summary-generator.ts`
  - 类 `SummaryGenerator`
  - 方法 `generate(community: Community, members: Node[], edges: Edge[]): string`
  - 摘要结构（7 sections，markdown 格式）：
    1. **模块名称**（community.name）
    2. **业务关键词**（top-5，从 members 类名/方法名 + docstring 提取，过滤停用词）
    3. **主要入口**（community 内 `kind=route` 的节点）
    4. **核心 Controller/Service/Mapper**（按 kind 分组列前 5 个）
    5. **涉及表**（`READS_TABLE` / `WRITES_TABLE` 边指向的表）
    6. **涉及 FeignClient**（community 内 `kind=feign_client` 节点）
    7. **关键配置**（`USED_BY` 边指向的 ConfigProperty）
  - 写回 `feature_communities.summary` + `feature_communities.keywords`（top-5 数组 JSON）
  - 关键词提取：简单的分词 + 词频统计（不需要 LLM），过滤常见词（`class`, `method`, `string`, `int` 等）

  **Recommended Agent Profile**:
  - Category: `deep`
  - Skills: 无

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: F W1（与 T47 写测试并行）
  - Blocks: T49
  - Blocked By: T47（需要 CommunityBuilder 输出）

  **Acceptance Criteria**:
  - [ ] 摘要含全部 7 个 markdown section
  - [ ] 关键词最多 5 个
  - [ ] 关键配置项 is_sensitive=1 时**不输出 value**

  **QA Scenarios**:
  - Scenario: 7 sections 完整
    - Tool: vitest
    - Steps: 输入 1 community + 10 members + 20 edges → 输出摘要含 7 个 `## ` 标题
  - Scenario: 敏感配置脱敏
    - Tool: vitest
    - Steps: 输入 community 含 `USED_BY` 边指向 `datasource.password` (is_sensitive=1) → 摘要不含 value

- [ ] 3. [F] T49 — DirtyQueue

  **What to do**:
  - `packages/springkg-community/src/dirty-queue.ts`
  - 类 `DirtyQueue`
  - 数据结构：`Set<communityId>` 内存集合
  - 方法：
    - `markDirty(communityId: string): void` — 添加到 dirty set
    - `markByFiles(filePaths: string[], allCommunities: Community[], members: Member[]): void` — 反查：哪些 community 包含这些 filePaths 下的成员节点
    - `startTimer(intervalMs: number, callback: () => Promise<void>): void` — 60s 定时器，到点后调 callback（callback 重新跑 CommunityBuilder + SummaryGenerator）
    - `triggerNow(callback: () => Promise<void>): Promise<void>` — 手动触发（`springkg rebuild-community` CLI）
  - 节流：如果定时器触发时上次的 rebuild 还没完成，**跳过**本次（避免重叠）
  - 集成到 `SpringKg.enhanceOnSync`：在 enhanceOnSync 末尾调 `dirtyQueue.markByFiles(paths, communities, members)`

  **Recommended Agent Profile**:
  - Category: `deep`
  - Skills: 无

  **Parallelization**:
  - Can Run In Parallel: NO
  - Parallel Group: F W2 末尾
  - Blocks: Team E Phase E3（T51-T56）
  - Blocked By: T47, T48

  **Acceptance Criteria**:
  - [ ] 3 个 case：dirty 标记、节流、手动触发
  - [ ] 60s 定时器可启动 + 关闭
  - [ ] markByFiles 反查正确
  - [ ] 文件变更后 60s 内 community 摘要更新

  **QA Scenarios**:
  - Scenario: 节流
    - Tool: vitest
    - Steps: 5 次快速 markDirty + 启动 timer → 实际 rebuild 只跑 1 次
  - Scenario: 反查
    - Tool: vitest
    - Steps: 改文件 X，X 的 codegraph_node 在 community A → A 被 mark dirty
  - Scenario: 手动触发
    - Tool: vitest
    - Steps: 调 `triggerNow` → 立即 rebuild

---

## Verification Strategy

- **单测**：每个 task 至少 3 个 case
- **集成测**：`tests/integration/sprint4-community-e2e.test.ts`（由 Team G 写）
  - 创建 demo 项目 → springkg index → 触发 CommunityBuilder → 验证 feature_communities 行数 >= 1
  - 改 demo 一个文件 → 等 60s → 验证 dirty community 摘要更新
- **端到端**：Team E 调 `spring_search_feature({query:"订单"})` → 返回相关 community

---

## Definition of Done (Team F)

- [ ] T47/T48/T49 全部完成
- [ ] `npm test` 在 `packages/springkg-community/` 0 失败
- [ ] demo 项目触发后 `feature_communities` 行数 >= 1
- [ ] `feature_communities.summary` 非空且含 7 sections
- [ ] 敏感配置在摘要中脱敏
- [ ] 60s 节流验证通过
- [ ] **不修改** `packages/codegraph/` 或 `packages/springkg-{core,semantic,data,runtime,mcp,cli}/`

---

## Risks & Mitigations

| 风险 | 缓解 |
|------|------|
| CommunityBuilder 算法太简单导致 community 颗粒度太大/小 | T47 单测覆盖连通子图、包加权、黑名单 3 case；e2e 由 Team G 跑 demo 验证 |
| SummaryGenerator 用简单分词不准确 | 不需要 LLM（设计文档明确说第一版可简单）；用户可手动 rebuild-community 触发更新 |
| DirtyQueue 60s 定时器在测试中需要 mock timer | 用 vitest fake timers（`vi.useFakeTimers()`） |

---

## Worktree & Commit Strategy

- Worktree: `../cg-team-f` 分支 `team-f-community`
- Commit：每个 task 一个 commit，消息格式 `feat(community): T47 CommunityBuilder`
- Merge 时机：T47+T48+T49 全部单测通过后 squash merge 到 main
- Tag: 跟随主 plan 的 v0.x.0 标签
