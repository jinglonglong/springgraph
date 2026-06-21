# CodeGraph V2 架构感知图谱执行计划

## 1. 背景与目标

当前讨论已经敲定一个核心方向：

> **模板/Profile 不是核心图谱本身，而是对通用图谱的解释层。真正的核心是准确存储类、方法、字段、配置、SQL、接口、模块之间的通用关系，并基于这些关系准确进行调用链路追踪和改动影响评估。**

因此 V2 的目标不是单纯做一个 SpringCloud 可视化页面，而是建设一套 **架构感知的代码图谱引擎**：

```text
源码 / 配置 / XML
  ↓
Extractor / Resolver
  ↓
通用节点与边图谱
  ↓
Facet 检测与 Profile 解释
  ↓
Trace / Impact / Overview API
  ↓
WebUI 动态分组、链路追踪、影响评估
```

V2 第一阶段聚焦 Spring Cloud / Spring MVC / RuoYi 类 Java 项目，重点满足两项核心使用场景：

1. **调用链路追踪**：从接口、定时任务、事件监听、Feign 调用等入口，追踪到 Service、Mapper、XML SQL、配置、字段。
2. **改动影响评估**：从 class / method / field / config key / mapper method / XML statement 出发，计算受影响的入口、业务方法、数据访问、SQL、字段和建议回归范围。

---

## 2. 当前项目现状

### 2.1 已具备的底层能力

当前 CodeGraph 已经有通用图谱能力：

- `nodes`：存储 class、method、field、route、module、component 等节点。
- `edges`：存储 calls、references、contains、implements、overrides、imports、instantiates 等关系。
- `files`：存储文件索引信息。
- `GraphTraverser` 已支持：
  - `getCallers(nodeId)`
  - `getCallees(nodeId)`
  - `getImpactRadius(nodeId)`
  - `findPath(fromId, toId)`
  - `getCallGraph(nodeId)`

相关文件：

```text
src/db/schema.sql
src/types.ts
src/graph/traversal.ts
src/index.ts
```

### 2.2 已有 SpringCloud WebUI 原型

当前 WebUI 已经有 SpringCloud 模式原型，但逻辑偏硬编码：

```text
src/web/server.ts
src/web/public/app.js
src/web/public/index.html
src/web/public/style.css
```

现有能力包括：

- `classifySpringRole()`：在 `server.ts` 内部根据命名、路径、kind 粗略识别 Controller / Service / Mapper 等角色。
- `SC_ROLE_TIER`：硬编码 SpringCloud 分层权重。
- `/api/modules`：返回模块统计。
- `/api/overview?mode=modules`：模块图。
- `/api/overview?mode=layered`：分层图。
- `/api/overview?mode=springcloud`：SpringCloud 角色视图。
- 前端已有：
  - SpringCloud role chips
  - edge type filter
  - detail panel
  - members tab
  - call stack tab
  - module filter

### 2.3 当前主要问题

1. SpringCloud 角色识别硬编码在 `server.ts` 和 `app.js` 中。
2. 前端也存在一套 `classifySpringRole()`，导致前后端语义重复。
3. Profile / Facet 还不是正式模型。
4. WebUI 仍是 `generic` / `springcloud` 两种模式，而不是动态 profile-driven。
5. Trace / Impact 还没有业务化 API。
6. Spring DI、MyBatis XML、字段影响、配置影响等边完整性仍需补强。

---

## 3. 核心设计原则

### 3.1 通用图谱优先

模板/Profile 不应该污染底层图谱。底层图谱只表达通用事实：

```text
class / method / field / route / config / sql
calls / references / contains / implements / overrides / imports / instantiates
```

所有调用链路追踪和影响评估，本质上都依赖这些通用边是否准确。

### 3.2 Profile 负责解释，不负责替代图谱

Profile 负责把通用节点解释成架构语义：

```text
Controller    → 入口层
ServiceImpl   → 业务层
Mapper        → 数据访问层
Entity        → 模型层
FeignClient   → 外部服务边界
Scheduler     → 定时入口
```

### 3.3 Facet 是可组合检测器

不要让一个项目只能属于一个模板。实际项目往往同时具备：

- Spring MVC
- Spring Cloud
- MyBatis
- Feign
- Scheduler
- Event Listener
- Config Properties
- 多 Maven module

因此应采用：

```text
Facet = 一个可组合检测器
Profile = 多个 Facet 的组合 + 分层规则 + 角色规则
```

### 3.4 WebUI 不重新推断架构语义

WebUI 只消费后端返回的 facet/profile 结果，不再自己通过路径和命名猜 Controller / Service / Mapper。

### 3.5 不确定就标记，不要误连

所有启发式关系都必须带：

```json
{
  "provenance": "heuristic",
  "metadata": {
    "synthesizedBy": "...",
    "confidence": 0.9,
    "evidence": []
  }
}
```

遇到多实现、歧义、无法确认的情况，默认标记 warning 或 ambiguous，不要为了链路完整而乱连。

### 3.6 兼容 CodeGraph 基础能力

V2 的 Profile / Facet / WebUI 改造必须作为 CodeGraph 现有能力的增强层，不能破坏已有公共 API 和增量索引机制。

必须保持兼容的基础能力包括：

```text
indexAll()          全量索引
sync()              增量索引
watch() / unwatch() 文件监听与自动同步
searchNodes()       符号搜索
getCallers()        调用方查询
getCallees()        被调用查询
getImpactRadius()   影响半径
findPath()          路径查找
buildContext()      AI 上下文构建
codegraph affected  变更文件影响测试选择
MCP tools           explore / node / search / callers 等现有工具
CLI commands        index / sync / query / context / impact / affected 等现有命令
```

设计约束：

1. Profile / Facet 不改变 `NodeKind`、`EdgeKind` 的既有语义。
2. Profile / Facet 只增加可选解释信息和启发式边，不替代现有 graph traversal。
3. 增量索引后，受影响文件对应的 facet/profile 结果也必须同步更新。
4. 未启用或未匹配 profile 的项目必须退回现有 generic 行为。
5. MCP / CLI / library API 的现有输出不能因为 WebUI V2 改造而出现破坏性变化。
6. 新增 profile 信息如果要暴露给 MCP/CLI，应作为附加字段或新工具/新命令，不修改旧字段含义。

---

## 4. 目标架构

### 4.1 分层结构

```text
src/architecture/
  types.ts
  profile-registry.ts
  facet-engine.ts
  profile-detector.ts
  role-assignment.ts
  annotation-adapters.ts
  trace.ts
  impact.ts
  adapters/
    mapstruct.ts
    lombok.ts
    spring-annotations.ts
    registry.ts
  profiles/
    spring-cloud.ts

src/web/
  server.ts
  architecture-api.ts
  graph-response.ts

src/web/public/
  app.js
  index.html
  style.css
```

### 4.2 Architecture Profile

Profile 是一组规则，用于描述某类架构如何解释通用图谱。

建议类型：

```ts
export interface ArchitectureProfile {
  id: string;
  name: string;
  description: string;
  facetIds: string[];
  layers: ArchitectureLayer[];
  roles: ArchitectureRole[];
  detect(signals: ArchitectureSignal[]): ArchitectureProfileMatch;
}
```

### 4.3 Architecture Facet

Facet 是一个检测器，负责产生证据和节点解释。

```ts
export interface ArchitectureFacet {
  id: string;
  name: string;
  detect(context: ArchitectureContext): ArchitectureSignal[];
}
```

### 4.4 Architecture Signal

Signal 是检测证据。

```ts
export interface ArchitectureSignal {
  facetId: string;
  scope: 'project' | 'module' | 'file' | 'node';
  nodeId?: string;
  filePath?: string;
  module?: string;
  score: number;
  evidence: Record<string, unknown>;
}
```

### 4.5 NodeArchitectureFacet

节点最终被解释后的结果。

```ts
export interface NodeArchitectureFacet {
  nodeId: string;
  profileId: string;
  roleId?: string;
  layerId?: string;
  service?: string;
  module?: string;
  packageName?: string;
  isEntrypoint: boolean;
  confidence: number;
  evidence: ArchitectureSignal[];
}
```

### 4.6 Annotation / Codegen Adapter

MapStruct、Lombok、Spring 注解、Jakarta 注解、MyBatis 注解等都不应该散落在 extractor / resolver / WebUI 的 if/else 中，而应该通过可注册适配器统一处理。

适配器目标：

1. 把注解和代码生成框架转换成通用 facts。
2. 为 resolver/profile 提供稳定输入。
3. 新增支持时只添加 adapter 或 adapter rule，不改核心流程。

建议类型：

```ts
export interface AnnotationAdapter {
  id: string;
  framework: string;
  supports(node: CodeNode, context: ArchitectureContext): boolean;
  collectFacts(node: CodeNode, context: ArchitectureContext): AnnotationFact[];
  synthesizeEdges?(fact: AnnotationFact, context: ArchitectureContext): SynthesizedEdge[];
  assignFacet?(fact: AnnotationFact, context: ArchitectureContext): Partial<NodeArchitectureFacet>[];
}

export interface AnnotationFact {
  adapterId: string;
  nodeId: string;
  kind:
    | 'bean'
    | 'injection'
    | 'mapping'
    | 'generated-method'
    | 'generated-property'
    | 'lifecycle'
    | 'sql-statement'
    | 'config-binding';
  name: string;
  targetNodeId?: string;
  metadata: Record<string, unknown>;
  confidence: number;
  evidence: ArchitectureSignal[];
}
```

注册方式：

```ts
const registry = new AnnotationAdapterRegistry();
registry.register(new SpringAnnotationAdapter());
registry.register(new MapStructAdapter());
registry.register(new LombokAdapter());
```

新增适配器流程：

```text
1. 在 adapters/ 下新增 adapter 文件
2. 声明支持的注解 / 框架值
3. 输出 AnnotationFact
4. 如有必要输出 SynthesizedEdge
5. 增加 adapter contract test
6. 不修改 WebUI 和 profile 主流程
```

适配器输出仍然遵守两个边界：

- 源码中真实存在的 annotation/signature/type 信息放 `nodes.metadata`。
- adapter 派生出的 role/layer/generated mapping/隐式方法放 facet 或 synthesized edge。

---

## 5. SpringCloud Profile 第一版定义

### 5.1 Layers

```ts
layers: [
  { id: 'entry', label: '入口层', tier: 1 },
  { id: 'remote', label: '远程调用层', tier: 1 },
  { id: 'business', label: '业务层', tier: 2 },
  { id: 'data', label: '数据访问层', tier: 3 },
  { id: 'model', label: '模型层', tier: 4 },
  { id: 'infra', label: '基础设施层', tier: 5 }
]
```

### 5.2 Roles

```ts
roles: [
  { id: 'controller', label: 'Controller', layerId: 'entry', entrypoint: true },
  { id: 'controller-advice', label: 'ControllerAdvice', layerId: 'entry' },
  { id: 'scheduler', label: 'Scheduler', layerId: 'entry', entrypoint: true },
  { id: 'event-listener', label: 'EventListener', layerId: 'entry', entrypoint: true },
  { id: 'filter', label: 'Filter', layerId: 'entry', entrypoint: true },
  { id: 'websocket', label: 'WebSocket', layerId: 'entry', entrypoint: true },
  { id: 'feign-client', label: 'FeignClient', layerId: 'remote', entrypoint: true },
  { id: 'service', label: 'Service', layerId: 'business' },
  { id: 'service-impl', label: 'ServiceImpl', layerId: 'business' },
  { id: 'mapper', label: 'Mapper', layerId: 'data' },
  { id: 'repository', label: 'Repository', layerId: 'data' },
  { id: 'entity', label: 'Entity', layerId: 'model' },
  { id: 'config', label: 'Config', layerId: 'infra' },
  { id: 'component', label: 'Component', layerId: 'infra' },
  { id: 'app', label: 'Application', layerId: 'infra' }
]
```

### 5.3 SpringCloud Facets

第一版建议实现这些 facet：

| Facet | 目标 |
|---|---|
| `spring-annotation` | 识别 `@RestController`、`@Service`、`@Repository`、`@Mapper`、`@FeignClient` 等 |
| `spring-naming` | 基于 `*Controller`、`*ServiceImpl`、`*Mapper`、`*Entity` 等命名补充识别 |
| `maven-module` | 识别 Maven/Gradle 多模块边界 |
| `spring-bean-wiring` | 补强 `@Autowired`、`@Resource`、构造器注入、`@Bean` |
| `spring-entrypoint` | 识别 Controller、Scheduler、EventListener、Filter、WebSocket 等入口 |
| `mybatis-xml` | 连接 Java Mapper method 与 XML statement |
| `java-field-impact` | 字段、getter/setter、Lombok、XML column 的影响关系 |
| `spring-config-binding` | `@Value`、`@ConfigurationProperties` 与配置项关系 |

---

## 6. 实施阶段

## Phase 0：锁定现状与测试基线

### 目标

在重构前固定当前 SpringCloud WebUI 行为，避免功能回退。

### 任务

1. 记录当前 API：
   - `/api/modules`
   - `/api/overview?mode=springcloud`
   - `/api/overview?mode=modules`
   - `/api/overview?mode=layered`
2. 记录当前 dzjc/RuoYi 项目的模块和角色统计。
3. 新增 Web API 基线测试。
4. 确认现有 GraphTraverser API 可用。
5. 清理工作区，只保留本次 V2 相关改动，避免把运行产物、截图、备份目录、历史资料删除混进实现提交。
6. 对当前已存在但不属于 V2 的失败点做隔离记录，不在 V2 计划中顺手修无关问题。

### 产出

```text
docs/design/architecture-profile-webui-baseline.md
__tests__/web-architecture-profile.test.ts
```

### 前置清理清单

实现前必须先检查：

```bash
git status --short
git diff
git diff --cached
```

重点避免以下内容进入 V2 变更：

```text
.codegraph_bak/
.omo/.omo.bak/
.omo/evidence/
.playwright-mcp/page-*.yml
examples/**/target/
webui-*.png
临时截图、临时日志、临时导出文件
```

如果发现已有资料文件被删除，必须先确认是否为用户明确要求；否则恢复，避免计划文档提交时夹带资料删除。

---

## Phase 1：建立 Profile / Facet 抽象

### 目标

引入架构解释层，但先不改变 UI 行为。

### 新增文件

```text
src/architecture/types.ts
src/architecture/profile-registry.ts
src/architecture/facet-engine.ts
src/architecture/profile-detector.ts
src/architecture/role-assignment.ts
src/architecture/profiles/spring-cloud.ts
```

### 任务

1. 定义 ArchitectureProfile / ArchitectureFacet / ArchitectureSignal / NodeArchitectureFacet。
2. 建立 Profile Registry。
3. 建立 Facet Engine。
4. 实现 `spring-cloud` profile 的角色、层级和命名规则。
5. 暂不改数据库，先运行时计算 facets。

### 验收标准

- 可以从 CodeGraph 实例中得到 active profile。
- 可以对 class/interface 节点生成 role/layer/module 信息。
- 不影响现有 WebUI。

---

## Phase 2：迁移 SpringCloud 硬编码逻辑

### 目标

把 `src/web/server.ts` 中的 `classifySpringRole()` 和 `SC_ROLE_TIER` 移到 `spring-cloud` profile 中。

### 修改文件

```text
src/web/server.ts
src/architecture/profiles/spring-cloud.ts
src/architecture/role-assignment.ts
```

### 任务

1. 从 `server.ts` 移除 Spring role 类型定义。
2. 从 `server.ts` 移除 `SC_ROLE_TIER`。
3. 将 `classifySpringRole()` 迁移为 profile 内部规则。
4. `buildOverviewGraph()` 和 `buildLayeredGraph()` 改为读取 node facets。
5. `/api/overview` 返回 `facets` 字段。

### 新响应结构

```json
{
  "activeProfile": "spring-cloud",
  "profileConfidence": 0.93,
  "nodes": [],
  "edges": [],
  "facets": {
    "node-id": {
      "role": "controller",
      "layer": "entry",
      "module": "ruoyi-admin",
      "isEntrypoint": true,
      "confidence": 0.95
    }
  },
  "roleBreakdown": {},
  "layerBreakdown": {},
  "moduleBreakdown": {}
}
```

### 验收标准

- `/api/overview?mode=springcloud` 行为与之前一致。
- 角色统计不明显变化。
- `server.ts` 不再直接硬编码 Spring role/tier。

---

## Phase 3：关系补强

这是 V2 准确性的核心阶段。

## 3.0 增量索引适配

### 目标

确保全量索引、增量索引、文件监听自动同步都能正确维护 Profile / Facet 解释结果。

### 当前基础能力

当前 CodeGraph 已有：

```text
CodeGraph.indexAll()
CodeGraph.sync()
CodeGraph.watch()
FileWatcher
MCP catch-up sync
staleness banner
```

V2 不应该重写这些机制，而应该挂接在现有索引流程之后。

### 实现策略

第一版建议采用“运行时派生 + 缓存”策略：

1. `indexAll()` 后重新计算 project-level signals。
2. `sync()` 后只重算变更文件相关 signals。
3. 如果变更文件影响全局规则，例如 `pom.xml`、`build.gradle`、`application.yml`，则触发 project-level profile 重新检测。
4. WebUI 请求 overview / trace / impact 时读取最新 facet cache。
5. 如果 cache 缺失，允许按需懒计算，但必须受锁保护，避免并发重复计算。

### 需要追踪的变更类型

| 变更文件 | 影响 |
|---|---|
| `.java` | 节点角色、DI、调用链、字段影响 |
| Mapper XML | Mapper/XML statement、SQL、字段影响 |
| `application.yml` / `.properties` | config binding、配置影响 |
| `pom.xml` / `build.gradle` | module/service/profile detection |
| package/class rename | role/layer/module 重新判定 |
| annotation adapter rule | MapStruct/Lombok/Spring derived facts |

### 验收标准

- 新增 Controller 文件后，不重启 WebUI 即可在 profile 视图中出现。
- 修改 ServiceImpl 名称或路径后，role/layer 会随 `sync()` 更新。
- 修改 Mapper XML 后，trace / impact 使用新 SQL statement。
- 修改配置文件后，config impact 使用新 key。
- 删除文件后，相关 facet cache 不残留旧节点。

### 测试

新增或扩展：

```text
__tests__/architecture-incremental-sync.test.ts
__tests__/watcher.test.ts
__tests__/mcp-catchup-gate.test.ts
```

覆盖：

1. `indexAll()` 后 profile/facet 可用。
2. `sync()` 新增文件后 facet 更新。
3. `sync()` 修改文件后 facet 更新。
4. `sync()` 删除文件后 facet 清理。
5. `watch()` 自动触发同步后 WebUI API 能看到新 facet。
6. MCP 首次连接 catch-up sync 后不会返回过期 facet。

## 3.1 Annotation / Codegen Adapter 体系

### 目标

支持主流 Java 注解和代码生成框架，并提供可扩展适配器机制：

```text
Spring annotations
Jakarta / JSR annotations
MapStruct
Lombok
MyBatis annotations
Validation annotations
OpenAPI / Swagger annotations
```

### 设计原则

1. Java extractor 只抽取 annotation 名称、参数、方法签名、字段类型等源码事实。
2. Adapter 将 annotation/codegen 语义转换为 `AnnotationFact`。
3. Resolver / Profile 只消费 facts，不直接解析具体框架注解。
4. 新增框架时只添加 adapter 或 adapter rule。
5. 所有 adapter 输出必须带 `adapterId`、`confidence`、`evidence`。

### 第一批 Adapter

| Adapter | 识别内容 | 输出 |
|---|---|---|
| `spring-annotations` | `@Component`、`@Service`、`@Repository`、`@Controller`、`@RestController`、`@Configuration`、`@Bean`、`@Autowired`、`@Qualifier`、`@Resource`、`@Value`、`@ConfigurationProperties` | bean、injection、config-binding、role facet |
| `spring-web` | `@RequestMapping`、`@GetMapping`、`@PostMapping`、`@PutMapping`、`@DeleteMapping`、`@PatchMapping` | endpoint entrypoint、route metadata |
| `spring-schedule-event` | `@Scheduled`、`@EventListener`、`ApplicationListener` | scheduled/event entrypoint |
| `mapstruct` | `@Mapper`、`@Mapping`、`@Mappings`、`@BeanMapping`、`@IterableMapping`、`uses`、`componentModel` | mapper role、DTO/entity mapping facts、generated mapping edges |
| `lombok` | `@Getter`、`@Setter`、`@Data`、`@Builder`、`@NoArgsConstructor`、`@AllArgsConstructor`、`@RequiredArgsConstructor`、`@Slf4j`、`@Accessors` | generated-method/generated-property facts、constructor injection facts、logger field fact |
| `mybatis-annotations` | `@Select`、`@Insert`、`@Update`、`@Delete`、`@Param`、`@Results`、`@Result` | SQL statement、parameter binding、mapper role |
| `validation` | `@NotNull`、`@NotBlank`、`@Valid`、`@Validated`、`@Size`、`@Pattern` | validation constraint facts |
| `openapi` | `@Operation`、`@Tag`、`@ApiOperation`、`@ApiModelProperty` | endpoint docs/tags metadata |

### MapStruct 适配

必须支持：

```java
@Mapper(componentModel = "spring", uses = {RoleMapper.class})
public interface UserMapper {
    UserDto toDto(User entity);

    @Mapping(source = "dept.name", target = "deptName")
    UserDto toDtoWithDept(User entity);
}
```

输出 facts：

```json
{
  "adapterId": "mapstruct",
  "kind": "mapping",
  "name": "UserMapper.toDto",
  "metadata": {
    "sourceType": "User",
    "targetType": "UserDto",
    "componentModel": "spring",
    "uses": ["RoleMapper"],
    "fieldMappings": [
      { "source": "dept.name", "target": "deptName" }
    ]
  },
  "confidence": 0.95
}
```

输出边：

```text
UserMapper.toDto references User
UserMapper.toDto references UserDto
UserMapper.toDto references RoleMapper   // uses
```

当 `componentModel = "spring"` 时：

```text
UserMapper role = mapper
layer = data 或 model-transform，具体由 profile 决定
参与 Spring bean wiring
```

### Lombok 适配

必须支持：

```java
@RequiredArgsConstructor
@Service
public class UserServiceImpl implements UserService {
    private final UserMapper userMapper;
}
```

输出 facts：

```json
{
  "adapterId": "lombok",
  "kind": "generated-method",
  "name": "UserServiceImpl.<constructor>",
  "metadata": {
    "generatedBy": "@RequiredArgsConstructor",
    "parameters": [
      { "name": "userMapper", "type": "UserMapper" }
    ]
  },
  "confidence": 0.9
}
```

并让 Spring DI resolver 能识别：

```text
@RequiredArgsConstructor + final field
  → constructor injection
  → UserServiceImpl references UserMapper
```

其他 Lombok 行为：

| 注解 | 输出 |
|---|---|
| `@Getter` / `@Setter` | generated getter/setter facts，不默认膨胀成真实 method node |
| `@Data` | getter/setter/toString/equals/hashCode facts |
| `@Builder` | builder factory/build facts，可用于对象构造 trace |
| `@Slf4j` | generated logger field fact |
| `@Accessors(chain = true)` | setter return style metadata |

默认不把 Lombok 生成方法全部物化成 `method` 节点，避免节点爆炸。只有当 trace/impact 需要穿透时，才通过 synthesized edge 表达隐式关系。

### 通用注解规则适配

除专用 adapter 外，需要支持 rule-based adapter，方便后续只新增值即可适配。

示例配置：

```ts
registerAnnotationRule({
  adapterId: 'custom-annotations',
  annotation: 'com.company.arch.ReadModel',
  produces: {
    role: 'read-model',
    layer: 'query',
    tags: ['cqrs']
  }
});
```

适用场景：

```text
公司自定义 @DomainService
自定义 @RpcClient
自定义 @TenantScoped
自定义 @SensitiveField
```

### 测试

新增：

```text
__tests__/annotation-adapters.test.ts
__tests__/mapstruct-adapter.test.ts
__tests__/lombok-adapter.test.ts
__tests__/spring-annotation-adapter.test.ts
```

覆盖：

- adapter registry 注册顺序稳定。
- 未知注解不会报错。
- 新增 rule 不需要改 resolver/profile 主流程。
- MapStruct source/target type 识别。
- MapStruct `uses` 产生 references edge。
- Lombok `@RequiredArgsConstructor` 参与 constructor injection。
- Lombok generated getter/setter 不导致节点爆炸。
- Spring annotations 输出 bean/injection/endpoint facts。

## 3.2 Spring DI 补强

### 目标

支持：

```text
Controller
  → Service interface
  → ServiceImpl
  → Mapper
```

### 覆盖场景

```java
@Autowired
private SysUserService userService;
```

```java
@Resource(name = "sysUserServiceImpl")
private SysUserService userService;
```

```java
private final SysUserService userService;

public UserController(SysUserService userService) {
  this.userService = userService;
}
```

```java
@RequiredArgsConstructor
private final SysUserService userService;
```

### 输出边

```text
references
```

metadata：

```json
{
  "synthesizedBy": "spring-bean-wiring",
  "injection": "field",
  "annotation": "@Autowired",
  "confidence": 0.9
}
```

### 测试

```text
__tests__/spring-bean-wiring.test.ts
```

覆盖：

- field injection
- constructor injection
- `@Resource(name=...)`
- `@Qualifier`
- interface → implementation
- 多实现时不误连

---

## 3.3 Interface → Implementation 补强

### 目标

保证接口链路不断：

```text
Controller.call(IService.method)
  → ServiceImpl.method
```

### 任务

1. 检查已有 Java interface override synthesizer。
2. 验证 overloaded method。
3. 验证 generic interface。
4. 验证多实现选择。
5. ambiguous 时不参与默认 trace。

### 边

```text
overrides
```

metadata：

```json
{
  "synthesizedBy": "java-interface-impl-dispatch",
  "confidence": 0.9
}
```

---

## 3.4 MyBatis Mapper XML 补强

### 目标

支持：

```text
Controller.method
  → ServiceImpl.method
  → SysUserMapper.selectUserList
  → SysUserMapper.xml::selectUserList
  → table sys_user
  → column user_name
```

### 任务

1. XML `<mapper namespace="...">` 生成 mapper file node。
2. `<select|insert|update|delete id="...">` 生成 statement node。
3. Java Mapper method → XML statement 建边。
4. XML SQL → table/column 轻量提取。
5. table/column → Entity field 通过 `@TableField` 或命名规则关联。

### 可能文件

```text
src/extraction/mybatis-extractor.ts
src/resolution/frameworks/mybatis.ts
```

### 测试

```text
__tests__/mybatis-xml-impact.test.ts
```

---

## 3.5 Field Impact 补强

### 目标

改字段时能准确知道影响范围。

例如：

```java
private String email;
```

影响：

```text
getter/setter
DTO mapping
Mapper XML SQL
Service methods
Controller endpoints
```

### 覆盖场景

- direct field access
- getter/setter
- Lombok `@Data` / `@Getter` / `@Setter`
- MapStruct source/target field mapping
- MyBatis XML column
- `@TableField`
- `@JsonProperty`

### 边

```text
references
```

metadata：

```json
{
  "synthesizedBy": "java-field-impact",
  "fieldRef": true,
  "via": "getter"
}
```

### 测试

```text
__tests__/java-field-impact.test.ts
```

---

## 3.6 Config Impact 补强

### 目标

配置变更能追踪到 Java 使用点。

支持：

```java
@Value("${ruoyi.name}")
private String name;
```

```java
@ConfigurationProperties(prefix = "ruoyi")
class RuoYiProperties {
  private String name;
}
```

### 第一版范围

做：

- `application.yml`
- `application.yaml`
- `application.properties`
- `@Value("${key}")`
- `@ConfigurationProperties(prefix="x")`

不做：

- Spring Cloud Config
- Nacos / Apollo / Consul
- external `@PropertySource`
- 多 profile 配置合并

### 测试

```text
__tests__/spring-config-impact.test.ts
```

---

## Phase 4：Trace / Impact API

## 4.1 Profile API

### Endpoint

```http
GET /api/architecture/profiles
```

返回：

```json
{
  "activeProfile": "spring-cloud",
  "detectedProfiles": [
    {
      "id": "spring-cloud",
      "name": "Spring Cloud",
      "confidence": 0.93,
      "evidence": [
        "@RestController x 23",
        "@Service x 38",
        "pom.xml modules x 7"
      ]
    }
  ],
  "availableProfiles": [
    { "id": "spring-cloud", "name": "Spring Cloud" },
    { "id": "generic", "name": "Generic" }
  ]
}
```

## 4.2 Architecture Overview API

### Endpoint

```http
GET /api/architecture/overview?profile=auto&groupBy=module&colorBy=layer
```

参数：

| 参数 | 含义 |
|---|---|
| `profile` | `auto` / `spring-cloud` / `generic` |
| `groupBy` | `module` / `layer` / `service` / `package` |
| `colorBy` | `role` / `layer` / `module` |
| `module` | 模块过滤 |
| `limit` | 节点上限 |

## 4.3 Trace API

### Endpoint

```http
GET /api/architecture/trace?from=<nodeId>&to=<nodeId>
```

或：

```http
GET /api/architecture/trace?query=SysUserController.list
```

返回：

```json
{
  "query": "SysUserController.list",
  "entrypoint": {
    "route": "GET /system/user/list",
    "nodeId": "..."
  },
  "paths": [
    {
      "confidence": 0.92,
      "nodes": [],
      "edges": []
    }
  ],
  "warnings": []
}
```

实现基础：

```ts
cg.findPath()
cg.getCallees()
cg.getCallers()
```

新增：

```text
src/architecture/trace.ts
```

## 4.4 Impact API

### Endpoint

```http
GET /api/architecture/impact?nodeId=<nodeId>&depth=3
```

或：

```http
GET /api/architecture/impact?query=SysUser.email
```

返回：

```json
{
  "target": {},
  "summary": {
    "entrypoints": 3,
    "services": 5,
    "mappers": 2,
    "sqlStatements": 4,
    "configKeys": 0,
    "risk": "medium"
  },
  "affected": {
    "entrypoints": [],
    "services": [],
    "data": [],
    "models": [],
    "config": []
  },
  "graph": {
    "nodes": [],
    "edges": []
  },
  "recommendedTests": []
}
```

实现基础：

```ts
cg.getImpactRadius(nodeId, depth)
```

新增：

```text
src/architecture/impact.ts
```

---

## Phase 5：WebUI 动态适配

## 5.1 顶部 Profile 区

当前：

```text
Generic | SpringCloud
```

改为：

```text
Profile: Auto detected: Spring Cloud 93%
[Generic] [Spring Cloud]
```

新增元素：

```html
<select id="profile-select"></select>
<span id="profile-confidence"></span>
<button id="btn-profile-evidence">检测依据</button>
```

## 5.2 前端 State 改造

当前：

```js
state.mode = 'generic' | 'springcloud'
```

改为：

```js
state.profileId = 'auto'
state.activeProfile = null
state.profileConfidence = null
state.facets = {}
state.groupBy = 'module'
state.colorBy = 'layer'
state.activeRoleFilters = new Set()
state.activeLayerFilters = new Set()
state.selectedTrace = null
state.selectedImpact = null
```

## 5.3 Sidebar 动态 sections

从固定 SpringCloud role section 改为：

```text
节点类型
架构角色
架构层级
模块
入口类型
边类型
```

函数改造：

```js
renderSpringRoleChips() → renderRoleChips(profile.roles)
classifySpringRole()    → getNodeFacet(nodeId)
SC_ROLES                → profile.roles / profile.layers
```

## 5.4 Cytoscape 节点渲染

节点 data 增加：

```js
{
  id,
  label,
  kind,
  role,
  layer,
  module,
  service,
  confidence,
  isEntrypoint
}
```

颜色策略：

```js
if (state.colorBy === 'role') color = roleColor(facet.role)
if (state.colorBy === 'layer') color = layerColor(facet.layer)
if (state.colorBy === 'module') color = moduleColor(facet.module)
```

## 5.5 边渲染

边 data 增加：

```js
{
  id,
  source,
  target,
  kind,
  provenance,
  synthesizedBy,
  confidence
}
```

样式建议：

| 边类型 | 样式 |
|---|---|
| tree-sitter calls | 实线 |
| heuristic synthesized | 虚线 |
| references | 点线 |
| imports | 淡色 |
| overrides / implements | 蓝色 |
| config / field impact | 紫色或橙色 |

## 5.6 右侧详情面板

当前 tab：

```text
源码 / 成员 / 调用堆栈 / 调用方 / 被调用
```

建议改为：

```text
源码 / 架构 / 成员 / 调用链 / 影响 / 调用方 / 被调用
```

### 架构 tab

显示：

```text
Profile: Spring Cloud
Role: ServiceImpl
Layer: Business
Module: ruoyi-system
Package: com.ruoyi.system.service.impl
Entrypoint: false
Confidence: 0.92

Evidence:
- name matches /ServiceImpl$/
- path contains /service/impl/
- implements ISysUserService
```

### 调用链 tab

调用：

```http
/api/architecture/trace?query=<node>
```

显示：

```text
GET /system/user/list
  → SysUserController.list
  → ISysUserService.selectUserList
  → SysUserServiceImpl.selectUserList
  → SysUserMapper.selectUserList
  → SysUserMapper.xml::selectUserList
```

### 影响 tab

调用：

```http
/api/architecture/impact?nodeId=<nodeId>
```

显示：

```text
影响入口
影响业务方法
影响 Mapper/SQL
影响字段/配置
建议回归
```

## 5.7 视图按钮与交互闭环

WebUI 中每个新增按钮都必须接入真实行为，禁止出现“按钮可点但只是重新加载同一个视图”的空交互。

新增视图按钮时必须同时完成：

1. `state` 中有对应字段。
2. 点击事件会更新字段。
3. `loadArchitectureOverview()` 或对应 loader 会读取该字段。
4. 后端 API 会根据字段返回不同数据或过滤策略。
5. UI 有可观察变化。
6. 测试或手动 QA 覆盖点击行为。

例如：

```text
默认 / 端点 / 调用链 / 服务依赖 / 数据模型
```

这些按钮如果暂时没有后端数据支撑，应先隐藏或禁用，不要提前展示。

## 5.8 Cytoscape 布局插件接入

如果 layered / module 视图依赖 `cytoscape-dagre`，必须确认插件真实注册并生效。

实现要求：

1. `index.html` 加载插件脚本。
2. `app.js` 初始化时调用插件注册，例如：

```js
if (window.cytoscapeDagre) {
  cytoscape.use(window.cytoscapeDagre);
}
```

3. 不要用 `typeof cytoscape.layout !== 'undefined'` 判断插件是否可用，因为 Cytoscape 的 layout 是实例方法 `cy.layout(...)`，不是全局 `cytoscape.layout`。
4. layered 视图优先尝试 `name: 'dagre'`，失败时 fallback 到 `breadthfirst`。
5. 手动 QA 必须确认 layered 视图不是 fallback 布局。

## 5.9 CSS 新增

```css
.profile-pill
.profile-confidence
.arch-section
.arch-role-chip
.arch-layer-chip
.trace-path
.trace-node
.trace-edge
.impact-summary
.impact-risk-low
.impact-risk-medium
.impact-risk-high
.evidence-list
```

保留并确认：

```css
[hidden] { display: none !important }
```

---

## Phase 6：后端 Web API 整理

当前 `src/web/server.ts` 已经承担过多职责。建议逐步拆分。

### 第一阶段拆分

新增：

```text
src/web/architecture-api.ts
```

导出：

```ts
handleArchitectureProfiles()
handleArchitectureOverview()
handleArchitectureTrace()
handleArchitectureImpact()
```

`server.ts` 只负责路由分发。

### 第二阶段拆分

新增：

```text
src/web/graph-response.ts
```

职责：

```ts
serializeNodeWithFacet()
serializeEdgeWithMetadata()
buildBreakdowns()
```

---

## Phase 7：测试计划

### 7.1 Profile / Facet 测试

新增：

```text
__tests__/architecture-profile.test.ts
__tests__/spring-cloud-profile.test.ts
__tests__/architecture-facets.test.ts
```

覆盖：

- Spring 项目识别
- 非 Spring 项目降级 generic
- 多模块 Maven 项目识别
- role assignment
- layer assignment
- confidence / evidence
- conflict priority

### 7.2 关系补强测试

新增：

```text
__tests__/spring-bean-wiring.test.ts
__tests__/spring-interface-impl.test.ts
__tests__/mybatis-xml-impact.test.ts
__tests__/java-field-impact.test.ts
__tests__/spring-config-impact.test.ts
```

### 7.3 Annotation / Codegen Adapter 测试

新增：

```text
__tests__/annotation-adapters.test.ts
__tests__/mapstruct-adapter.test.ts
__tests__/lombok-adapter.test.ts
__tests__/spring-annotation-adapter.test.ts
__tests__/custom-annotation-rules.test.ts
```

覆盖：

- adapter registry 注册顺序稳定。
- adapter 只能输出 facts / synthesized edges / facets，不能直接改 WebUI 状态。
- 未知注解成功忽略，不返回错误。
- 新增 annotation rule 后不需要改 Spring resolver / profile / WebUI 主流程。
- MapStruct `@Mapper(componentModel="spring")` 被识别为 Spring bean。
- MapStruct `uses` 产生 `references` 边。
- MapStruct source/target DTO/entity 类型可用于 field impact。
- Lombok `@RequiredArgsConstructor` 生成 constructor injection fact。
- Lombok `@Getter` / `@Setter` / `@Data` 不默认物化为大量 method node。
- Lombok generated facts 可被 field impact 使用。
- Spring annotations 输出 bean/injection/endpoint facts。

### 7.4 基础能力回归测试

V2 每个里程碑都必须跑基础能力回归，避免架构解释层破坏 CodeGraph 原有功能。

必须覆盖：

```text
__tests__/sync.test.ts
__tests__/watcher.test.ts
__tests__/graph.test.ts
__tests__/integration/full-pipeline.test.ts
__tests__/mcp-catchup-gate.test.ts
__tests__/mcp-staleness-banner.test.ts
```

重点验证：

- `indexAll()` 全量索引结果不变。
- `sync()` 新增 / 修改 / 删除文件都能更新节点和 facet。
- `watch()` 自动同步后 WebUI/API/MCP 看到一致结果。
- `searchNodes()` 不因 profile 过滤改变默认结果。
- `getCallers()` / `getCallees()` / `getImpactRadius()` 原有语义不变。
- `buildContext()` 不被 WebUI 专用字段污染输出。
- `codegraph affected` 仍然只基于依赖图选择测试，不被 UI 分组干扰。

### 7.5 Web API 测试

新增：

```text
__tests__/web-architecture-api.test.ts
```

覆盖：

- `/api/architecture/profiles`
- `/api/architecture/overview`
- `/api/architecture/trace`
- `/api/architecture/impact`

### 7.6 Facet 与搜索过滤一致性测试

如果 WebUI 增加 annotation/decorator/facet chips，必须保证后端搜索过滤真实生效，不能只在 UI 层显示。

需要覆盖：

```text
GET /api/search?q=xxx&decorator=NoSuchDecorator
GET /api/search?q=xxx&role=controller
GET /api/search?q=xxx&layer=entry
GET /api/search?q=xxx&module=ruoyi-system
```

验收标准：

- 不存在的 decorator/role/layer/module 返回空结果。
- 存在的过滤条件只返回匹配节点。
- 后端过滤逻辑和 UI chips 使用同一套 facet/profile 数据。
- 不允许出现“UI 可筛选，但 API 忽略过滤参数”的情况。

### 7.7 WebUI 手动 QA

必须浏览器验证：

1. 打开 WebUI。
2. profile 自动识别为 Spring Cloud。
3. 切换 overview / module / layer / trace / impact。
4. 点击 Controller，看到 role/layer/module/evidence。
5. 点击 ServiceImpl，看到 callers/callees/impact。
6. 输入 endpoint，看到完整链路。
7. 输入 field，看到影响范围。
8. 浏览器 console 无错误。
9. 每个可见视图按钮都有实际视觉变化或数据变化。
10. layered 视图确认使用 dagre 或明确显示 fallback 状态。

### 7.8 异步初始化与首个请求测试

如果未来将 profile/facet 结果物化到数据库，或者引入独立 MCP/服务进程，必须测试“服务启动后第一次请求”的行为。

覆盖场景：

1. 数据库为空或需要 seed。
2. 服务刚启动。
3. 客户端立即请求 profiles / overview / trace / impact。

验收标准：

- 首次请求不会读到空数据或旧数据。
- 如果需要 seed/index，handler 必须等待对应 promise 完成，或明确返回 pending 状态。
- 不能出现第一次请求返回 `found:false`，数秒后同样请求才有结果的竞态。

---

## Phase 8：真实项目验证

### 8.1 验证项目

至少三个：

| 项目 | 类型 | 目的 |
|---|---|---|
| dzjc / RuoYi | 多模块 SpringCloud / Monolith | 当前主目标 |
| mall / mall-tiny | SpringBoot + MyBatis | 验证 Controller → Service → Mapper → XML |
| halo / realworld Spring | 更复杂 Spring 项目 | 验证 DI / interface / route |

### 8.2 验证问题集

调用链问题：

1. 某个 HTTP 接口如何走到 Mapper？
2. 某个 Controller 方法调用哪些 Service？
3. 某个 FeignClient 被哪些业务入口使用？
4. 某个 Scheduler 最终更新哪些表？
5. 某个 Mapper XML statement 被哪些接口触发？

影响评估问题：

1. 改一个 Entity field 影响哪些接口？
2. 改一个 ServiceImpl method 影响哪些入口？
3. 改一个 Mapper method 影响哪些业务？
4. 改一个 config key 影响哪些类？
5. 改一个 DTO field 影响哪些 Controller / Service？

### 8.3 通过标准

最低标准：

- SpringCloud profile 自动识别正确。
- 主要模块识别正确。
- Controller / Service / Mapper / Entity role 识别准确率 > 90%。
- Controller → Service → Mapper 主链路不断。
- Field impact 至少覆盖 MyBatis XML + getter/setter。
- WebUI 无 JS error。
- impact 结果不爆炸，不出现大量无意义节点。

理想标准：

- 一个接口 trace 在 1 次 API 调用内返回完整链路。
- 一个字段 impact 能给出 affected entrypoints。
- 用户无需 grep/read 即可判断“改哪里、测哪里”。

---

## 9. 推荐实现顺序

严格按以下顺序推进：

1. 抽 `src/architecture/types.ts`。
2. 抽 `src/architecture/profiles/spring-cloud.ts`。
3. 把 `server.ts` 的 `classifySpringRole()` 和 `SC_ROLE_TIER` 迁移出去。
4. 让 `/api/overview` 返回 `facets`。
5. 前端 `app.js` 改成读后端 facets，不再自己分类。
6. 新增 `/api/architecture/profiles`。
7. 新增 `/api/architecture/impact` 第一版，只包装 `getImpactRadius()` 并按 role/layer 聚合。
8. 新增 `/api/architecture/trace` 第一版，只做 Controller → Service → Mapper 主链路。
9. 补 Spring DI。
10. 补 Mapper XML。
11. 补 Field Impact。
12. 补 Config Impact。
13. 做真实项目验证。

---

## 10. 文件级任务清单

### Backend 新增

```text
src/architecture/types.ts
src/architecture/profile-registry.ts
src/architecture/facet-engine.ts
src/architecture/profile-detector.ts
src/architecture/role-assignment.ts
src/architecture/trace.ts
src/architecture/impact.ts
src/architecture/profiles/spring-cloud.ts
src/web/architecture-api.ts
```

### Backend 修改

```text
src/web/server.ts
src/index.ts
src/types.ts
src/resolution/index.ts
src/resolution/frameworks/spring.ts
src/extraction/tree-sitter.ts
src/extraction/languages/java.ts
```

### Backend 可能新增

```text
src/resolution/spring-bean-wiring.ts
src/resolution/frameworks/mybatis.ts
src/extraction/mybatis-extractor.ts
src/extraction/config-extractor.ts
```

### Frontend 修改

```text
src/web/public/app.js
src/web/public/index.html
src/web/public/style.css
```

### Tests 新增

```text
__tests__/architecture-profile.test.ts
__tests__/spring-cloud-profile.test.ts
__tests__/architecture-facets.test.ts
__tests__/web-architecture-api.test.ts
__tests__/spring-bean-wiring.test.ts
__tests__/mybatis-xml-impact.test.ts
__tests__/java-field-impact.test.ts
__tests__/spring-config-impact.test.ts
```

---

## 11. 关键风险与规避

### 风险 1：边不准确，UI 变成“漂亮幻觉”

规避：

- 所有 heuristic edge 必须带 provenance。
- 所有 facet assignment 必须带 confidence。
- UI 明确显示推断边。
- 不确定就不连。

### 风险 2：Spring DI 多实现误连

规避：

- 有 `@Qualifier` / `@Resource(name)` 时才高置信。
- 无 qualifier 且多实现时标记 ambiguous。
- ambiguous 不参与默认 trace，但在 UI warning 显示。

### 风险 3：Impact 爆炸

规避：

- depth 默认 3。
- 排除 `contains` 反向爆炸。
- 限制 file/import/package-level edges 权重。
- UI 分组聚合，不直接展示所有节点。

### 风险 4：WebUI 逻辑继续膨胀

规避：

- 后端返回 facets。
- 前端只渲染，不推断架构语义。
- 逐步删除 `app.js` 中的 `classifySpringRole()`。

### 风险 5：过早支持太多 profile

规避：

- MVP 只做 `spring-cloud`。
- 其他 profile 只保留接口，不实现完整规则。
- 等 SpringCloud 跑通后再加 DDD / three-layer。

### 风险 6：UI 展示了未完成能力

规避：

- 每个新增按钮、chip、tab 必须有对应后端数据和可观察行为。
- 未实现的视图先隐藏或禁用，并显示“暂未开放”。
- 手动 QA 必须逐个点击所有可见控件。

### 风险 7：异步初始化导致首次查询错误

规避：

- 如果 profile/facet 计算需要异步 seed/index，所有依赖数据的 handler 必须等待初始化完成。
- 服务启动后第一轮 API 请求必须纳入测试。
- 对 pending 状态返回明确提示，不返回误导性的空结果。

### 风险 8：过滤参数与后端查询脱节

规避：

- UI chips 和 API search/overview 必须共用同一份 facet/profile 数据。
- 每新增一个过滤参数，都必须有“存在值”和“不存在值”两类测试。
- 不允许只在前端过滤局部结果而后端仍返回全量结果。

### 风险 9：Profile / Facet 与增量索引不同步

规避：

- `indexAll()`、`sync()`、`watch()` 后都必须更新或失效相关 facet cache。
- 变更 `pom.xml`、`build.gradle`、`application.yml` 等全局文件时，触发 profile 重新检测。
- 删除文件时必须清理该文件关联的 node facets 和 synthesized edges。
- 增量同步测试必须覆盖新增、修改、删除三类变更。

### 风险 10：V2 破坏 CodeGraph 既有公共 API

规避：

- Profile / Facet 作为附加层，不改变 `searchNodes()`、`getCallers()`、`getCallees()`、`getImpactRadius()` 默认行为。
- WebUI 专用字段不进入 `buildContext()` 默认输出，除非明确请求。
- MCP 工具列表和既有工具输出保持向后兼容。
- 每个里程碑必须跑基础能力回归测试。

### 风险 11：注解适配器过度物化导致节点爆炸

规避：

- Lombok getter/setter/builder 默认输出 generated facts，不默认生成真实 method node。
- 只有 trace/impact 需要跨越隐式方法时，才通过 synthesized edge 表达关系。
- 每个 adapter 测试必须检查节点数量不会随字段数成倍膨胀。
- generated facts 必须带 `adapterId` 和 `generatedBy`，UI 明确显示为派生信息。

### 风险 12：新增注解值需要改多处核心代码

规避：

- 所有框架注解走 `AnnotationAdapterRegistry`。
- 公司自定义注解优先通过 rule-based adapter 增加。
- Resolver/Profile 只消费 `AnnotationFact`，不直接解析具体注解字符串。
- 新增 adapter/rule 必须有 contract test，证明无需改 WebUI 和主流程。

---

## 12. 里程碑

### Milestone 1：Profile 抽象落地

完成标准：

- `spring-cloud` profile 存在。
- `server.ts` 不再硬编码 Spring role/tier。
- `/api/overview?mode=springcloud` 行为不变。
- 测试通过。

### Milestone 2：WebUI Profile-driven

完成标准：

- 前端从 API 读取 role/layer/facet。
- role chips 动态生成。
- layer chips 动态生成。
- 节点颜色按 layer/role 切换。
- 当前 dzjc WebUI 正常展示。

### Milestone 3：Trace API 可用

完成标准：

- 给定 Controller method 可返回 Controller → Service → Mapper 链路。
- WebUI 展示 trace path。
- heuristic 边有标识。

### Milestone 3.5：Annotation / Codegen Adapter 可用

完成标准：

- Spring annotation adapter 输出 bean/injection/endpoint facts。
- MapStruct adapter 输出 mapper/mapping facts，并接入 Spring bean wiring。
- Lombok adapter 输出 constructor/generated-property facts，并接入 DI / field impact。
- rule-based adapter 可通过新增 annotation rule 支持自定义注解。
- 新增 adapter 不需要修改 WebUI 和 Spring profile 主流程。

### Milestone 4：Impact API 可用

完成标准：

- 给定 method 可返回 affected callers / entrypoints。
- 给定 field 可返回 affected mapper / service / controller。
- WebUI 展示 impact summary。

### Milestone 5：Spring DI / MyBatis / Field Impact 补强

完成标准：

- field injection 链路不断。
- interface → impl 链路不断。
- Mapper Java → XML 链路不断。
- Entity field → XML SQL impact 可见。

### Milestone 6：真实项目验证

完成标准：

- dzjc / RuoYi 主链路可追踪。
- 至少 5 个真实问题能通过 WebUI 回答。
- 无明显误连。
- build/test 通过。

---

## 13. 最小可交付版本定义

第一版不要求支持所有架构，只要求：

```text
SpringCloud / Spring MVC 项目中：

1. 自动识别项目架构 profile。
2. 按模块、层级、角色展示项目结构。
3. 从接口追踪到 Service / Mapper / XML。
4. 从方法 / 字段评估影响入口。
5. WebUI 可以交互查看这些结果。
6. MapStruct / Lombok / Spring 常用注解不会造成主链路断裂。
7. 新增常用注解或公司自定义注解时，可以通过 adapter/rule 扩展。
```

如果这 7 点成立，就已经满足当前核心目标。

---

## 14. 最终建议

V2 应该坚定聚焦：

```text
通用图谱准确性
  > 架构 Profile 解释
  > Trace / Impact API
  > WebUI 动态展示
```

也就是说，实施优先级是：

1. **先把关系存准**：method calls、field references、interface→impl、Spring DI、MapStruct、Lombok、Mapper XML、config usage。
2. **再把语义解释清楚**：Controller / Service / Mapper / Entity、module、service、layer、entrypoint。
3. **最后把 WebUI 做漂亮**：模块图、分层图、调用链图、影响范围图。

如果第一层不准，后两层再漂亮也只是“好看的幻觉”。
