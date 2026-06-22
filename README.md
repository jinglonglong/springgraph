<div align="center">

# Codegraph-SpringCloud

## Spring Cloud 语义知识图谱工具

**基于 Codegraph/Springgraph 二次开发，专注 Spring Boot / Spring Cloud 微服务架构**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Fork of Springgraph](https://img.shields.io/badge/Fork%20of-Springgraph-blue.svg)](https://github.com/colbymchenry/springgraph)
[![Node](https://img.shields.io/badge/Node.js-18%2B-brightgreen.svg)](https://nodejs.org/)

</div>

> **本项目基于 [Springgraph (Codegraph)](https://github.com/colbymchenry/springgraph) 二次开发。**
> 上游提供了 20+ 语言的 tree-sitter 抽取、SQLite + FTS5 知识图谱、原生文件监听与自动同步、MCP 服务器与多 Agent 接入能力。本仓库在此之上新增了面向 Spring Boot / Spring Cloud 微服务架构的语义层（**SpringKg**）与架构剖面引擎。

**联系方式**: xyjnglong@163.com

---

## 目录

- [二开新增能力](#二开新增能力)
- [SpringKg: Spring Cloud 语义知识图谱](#springkg--spring-cloud-语义知识图谱)
- [Spring MCP 工具 (4 个)](#spring-mcp-工具-4-个)
- [架构剖面引擎](#架构剖面引擎-architecture-profile-engine)
- [Spring Bean 自动装配解析](#spring-bean-自动装配解析)
- [Web UI 可视化](#web-ui-可视化)
- [Monorepo 包结构](#monorepo-包结构)
- [快速开始](#快速开始)
- [整体架构](#整体架构)
- [支持的编程语言](#支持的编程语言)
- [保留的上游能力](#保留的上游能力)
- [开发与构建](#开发与构建)
- [项目结构](#项目结构)
- [致谢与许可](#致谢与许可)

---

## 二开新增能力

本仓库相对上游 [colbymchenry/springgraph](https://github.com/colbymchenry/springgraph) 的核心增量：

| 模块 | 路径 | 作用 |
|---|---|---|
| **SpringKg 知识图谱** | `packages/springkg-*` | 专为 Spring Boot / Spring Cloud 构建的语义层 |
| **SpringKg MCP Server** | `packages/springkg-mcp` | 暴露 4 个 Spring 专用 MCP 工具 |
| **架构剖面引擎** | `src/architecture/` | 6 层 + 15 角色 + 多 Facet 检测 |
| **Spring Bean 装配解析** | `src/resolution/` | `@Autowired`、`@Resource`、构造注入、接口派发、MyBatis XML 链路 |
| **Web UI 可视化** | `src/web/` | Cytoscape.js 图浏览器, REST API `/api/architecture/*` |
| **Spring Cloud Demo** | `examples/springcloud-demo/` | 用于本地验证的演示工程 |

下面逐项展开。

---

## SpringKg: Spring Cloud 语义知识图谱

SpringKg 在 Springgraph 的 Java 抽取之上构建,专门针对 Spring Boot / Spring Cloud 微服务项目建立语义知识图谱,连接 HTTP 端点 → 服务层 → 数据访问层 → 运行时配置。

**抽取覆盖**:

- `@RestController` 端点方法(基于 `@RequestMapping` / `@GetMapping` / `@PostMapping` 等)
- `@Service` 业务层及其方法
- `@Mapper` 数据访问接口
- OpenFeign 客户端接口及目标服务
- MyBatis XML mapper 中的 SQL 语句
- `@Value` / `@ConfigurationProperties` 绑定的运行时配置

**存储**:

- 数据库文件: `.springgraph/springkg.db`(与基础 springgraph 索引独立)
- 核心表:
  - `spring_symbols`: Spring 符号
  - `spring_edges`: 符号间关系边
  - `spring_endpoints`: HTTP 端点
  - `spring_feign_clients`: Feign 客户端
  - `spring_sql_statements`: SQL 语句
  - `runtime_config_properties`: 运行时配置属性

---

## Spring MCP 工具 (4 个)

通过 `springgraph serve --mcp` 启动的 MCP 服务器对外暴露 **4 个** Spring 专用 MCP 工具,服务于 vibe coding 场景下"快速拿到答案"的核心诉求:

| 工具 | 用途 |
|---|---|
| `spring_find_entry` | 按 URL/Controller 类/Feign 名/MQ topic/Scheduler 名称查找入口点;返回端点符号、handler 的 file:line,以及调用链头 |
| `spring_assets_overview` | 服务、中间件、敏感配置总览(敏感值不返回) |
| `spring_trace_flow` | 全链路追踪:Endpoint → Controller → Service → Mapper → SQL → Table |
| `spring_method_impact` | 方法影响分析:调用链、事务边界、异常处理、SQL 依赖 |

**工具精简的理由**:经过 A/B 评估,工具数量超过 4 个会显著增加 agent 选错工具的概率,所以这里把 SpringKg 的 MCP 接口收窄到 4 个高频工具。被精简掉的工具(MyBatis mapper 查询、运行配置查询、Nacos/Gateway 概览、功能社区搜索、字段影响、模块摘要、变更影响面、运行时依赖、环境差异对比)在底层数据层仍然存在,可以通过上游 `springgraph_search` / `springgraph_explore` / `springgraph_node` 间接访问。

每个工具的入参/出参字段定义见 [`docs/mcp-tools.md`](docs/mcp-tools.md)。

---

## 架构剖面引擎 (Architecture Profile Engine)

位于 `src/architecture/`,是二开的核心增量之一。Spring Cloud 项目的 Java 类按 6 层逻辑划分 + 15 个架构角色进行标记,让 Agent 拿到的不只是"一个类",而是它在系统里扮演的"角色"。

### 6 个逻辑层

| 层 | 典型成员 |
|---|---|
| **Entry 层** (入口层) | `@RestController`、`@Controller`、Scheduler、Job |
| **Remote 层** (远程调用层) | `@FeignClient` 接口 |
| **Business 层** (业务层) | `@Service` 业务实现 |
| **Data 层** (数据层) | `@Mapper`、`@Repository` |
| **Model 层** (模型层) | Entity、DTO、VO |
| **Infrastructure 层** (基础设施层) | `@Configuration`、`Filter`、拦截器、配置类 |

### 15 个架构角色

具体角色清单见 `src/architecture/profiles/spring-cloud.ts`,包括但不限于:`Controller`、`RestController`、`FeignClient`、`Service`、`Mapper`、`Repository`、`Entity`、`DTO`、`VO`、`Config`、`Filter`、`Interceptor`、`Component`、`Job`、`Scheduler` 等。

### 注解适配器

`src/architecture/adapters/` 提供多源适配器,识别项目里用到的常见注解和工具:

- Spring 注解(`@RestController`、`@Service`、`@Mapper`、`@FeignClient` 等)
- Lombok(`@Data`、`@Builder`、`@RequiredArgsConstructor` 等)
- MapStruct(`@Mapper`、`@Mapping`)
- MyBatis 注解(`@Select`、`@Insert`、`@Update`、`@Delete`)
- OpenAPI / Swagger(`@Api`、`@ApiOperation`)
- 参数校验(`@Valid`、`@NotNull`、`@NotBlank`)

### Facet 检测

每个类通过多个 Facet 描述自身特性,便于工具查询:

- `spring-naming`: 基于命名约定识别(如 `*Controller`、`*Service`、`*Mapper`)
- `spring-annotation`: 基于注解识别
- `maven-module`: 基于 Maven 模块路径识别
- `spring-entrypoint`: 基于入口特征识别(如带 `@RequestMapping` 的方法)

### 衍生能力

- **架构 Trace**:基于角色做全链路调用流分析
- **架构 Impact**:基于角色做变更影响面分析
- **架构 Web UI**:通过 Cytoscape.js 可视化展示层级、角色、调用流

---

## Spring Bean 自动装配解析

位于 `src/resolution/`,用于解析 Spring 容器内 Bean 之间的依赖关系。覆盖:

- `@Autowired` / `@Resource` 字段注入
- 构造器注入(包括 Lombok `@RequiredArgsConstructor` 生成的构造器)
- 接口 → 实现的派发(按 Bean 类型/名称匹配)
- MyBatis XML mapper ↔ Java Mapper 接口的链路
- `@Value` / `@ConfigurationProperties` 配置绑定

这些边让 Agent 能回答"这个 Controller 调用了哪个 Service 实现"、"这个 Service 用了哪个 Mapper"、"这条 SQL 是哪个方法触发的"等问题。

---

## Web UI 可视化

位于 `src/web/`,提供基于 Cytoscape.js 的图浏览器,对外暴露架构相关的 REST API(`/api/architecture/*`)。可以直观浏览:

- Spring 各层的类和接口
- 角色与层级的归属关系
- Controller → Service → Mapper → SQL 的完整调用流
- 配置属性与类的绑定关系

启动方式见下方快速开始。

---

## Monorepo 包结构

`packages/` 下放置 9 个 SpringKg 专用包,沿用 monorepo 风格组织:

| 包 | 职责 |
|---|---|
| `springkg-shared` | 跨包共享类型与工具 |
| `springkg-core` | 核心抽取与图谱构建 |
| `springkg-data` | 数据访问层与持久化 |
| `springkg-semantic` | 语义层(角色、Facet、注解适配器) |
| `springkg-runtime` | 运行时配置抽取与绑定分析 |
| `springkg-community` | 功能社区与服务画像 |
| `springkg-installer` | SpringKg 工具的安装器 |
| `springkg-mcp` | 暴露 4 个 Spring 专用 MCP 工具(通过 `springgraph serve --mcp` 统一启动) |
| `springkg-cli` | SpringKg 内部模块(CLI 统一使用 `springgraph` 命令) |

---

## 快速开始

```bash
# 1. 克隆本仓库
git clone https://github.com/jinglonglong/codegraph-springcloud.git
cd codegraph-springcloud

# 2. 安装依赖
npm install

# 3. 构建
npm run build
```

**对 Spring Cloud 项目建索引**:

```bash
# 初始化并建索引
springgraph init
springgraph index
```

**启动 MCP 服务器**（供 AI Agent 调用 4 个 `spring_*` 工具）:

```bash
springgraph serve --mcp --path /path/to/springcloud-project
```

**启动 Web UI 可视化**:

```bash
npx tsx start-webui.ts
```

启动后按终端输出的地址访问,即可在浏览器里浏览架构图。

---

## 整体架构

```
┌─────────────────────────────────────┐
│         AI Agent (MCP Client)       │
└──────────────┬──────────────────────┘
               │
               ▼
     ┌───────────────────┐
     │   Springgraph MCP │
     │      Server       │
     │ (springgraph serve│
     │    --mcp)         │
     └────────┬──────────┘
              │
       ┌──────┴───────┐
       ▼              ▼
┌──────────────┐  ┌────────────────┐
│  springgraph │  │   springkg.db  │
│     .db      │  │ (Spring 语义层) │
│ (通用代码图)  │  │                │
└──────────────┘  └────────────────┘
```

两个数据库并存:上游 `springgraph.db` 保留通用代码图,本仓库的 `springkg.db` 承载 Spring 语义层。统一通过 `springgraph serve --mcp` 启动,Agent 通过同一个 MCP 服务器访问全部工具。

---

## 支持的编程语言

来自上游 Springgraph 的能力,本仓库完整保留。语言支持由文件扩展名自动识别,无需配置。

| 语言 | 扩展名 |
|---|---|
| TypeScript / JavaScript | `.ts` `.tsx` `.js` `.jsx` `.mjs` |
| Python | `.py` |
| Go | `.go` |
| Rust | `.rs` |
| **Java** | `.java` |
| C# | `.cs` |
| PHP | `.php` |
| Ruby | `.rb` |
| C / C++ | `.c` `.h` `.cpp` `.hpp` `.cc` |
| Objective-C | `.m` `.mm` `.h` |
| Swift | `.swift` |
| Kotlin | `.kt` `.kts` |
| Scala | `.scala` `.sc` |
| Dart | `.dart` |
| Svelte / Vue / Astro / Liquid | 见上游文档 |
| Lua / Luau / R | 见上游文档 |
| Pascal / Delphi | `.pas` `.dpr` `.dpk` `.lpr` |

---

## 保留的上游能力

本仓库在上游基础上做增量开发,上游核心能力全部保留:

- **20+ 语言** 的 tree-sitter AST 抽取
- **SQLite + FTS5** 全文本检索的知识图谱
- **17 框架** 的路由识别(Express、FastAPI、Flask、Spring、Django、Rails、Laravel、NestJS、Vue/Nuxt、SvelteKit、Astro 等)
- **原生文件监听**(FSEvents / inotify / ReadDirectoryChangesW)+ 防抖自动同步
- **100% 本地**运行,不外传任何代码或符号
- **MCP 协议**接入 Claude Code、Cursor、Codex、opencode 等 Agent
- **完整 CLI**(`springgraph init` / `index` / `sync` / `query` / `explore` / `node` / `callers` / `callees` / `impact` 等)

---

## 开发与构建

```bash
# 基础
npm run build              # 构建全部(含 tsc + copy 资源)
npm run dev                # tsc --watch
npm test                   # 运行 vitest 全量测试
npm run clean              # 删除 dist/

# SpringKg 相关
npm run build:springkg     # 构建 SpringKg 包
npm run test:springkg      # 运行 SpringKg 相关测试

# 按文件/模式跑测试
npx vitest run __tests__/extraction.test.ts
npx vitest run __tests__/extraction.test.ts -t "Java"
```

构建产物在 `dist/`,其中 `src/db/schema.sql` 与 `src/extraction/wasm/*.wasm` 会通过 `copy-assets` 复制到 `dist/` 一起发布。新增 SQL 或 wasm 语法文件必须保证被复制,否则运行时找不到。

---

## 项目结构

```
codegraph-springcloud/
├── src/                          # Springgraph 上游核心(保留)
│   ├── architecture/             # 二开新增:架构剖面引擎
│   │   ├── adapters/             #   注解适配器(Spring/Lombok/MapStruct/MyBatis/OpenAPI/Validation)
│   │   └── profiles/             #   Spring Cloud profile:6 层 + 15 角色
│   ├── web/                      # 二开新增:Web UI 与架构 REST API
│   ├── resolution/               # 二开增强:Spring Bean 装配解析
│   ├── extraction/               # 上游:tree-sitter 抽取
│   ├── db/                       # 上游:SQLite + FTS5
│   ├── mcp/                      # 上游:MCP 服务器
│   ├── sync/                     # 上游:文件监听与自动同步
│   └── ...
│
├── packages/                     # 二开新增:SpringKg monorepo
│   ├── springkg-shared/
│   ├── springkg-core/
│   ├── springkg-data/
│   ├── springkg-semantic/
│   ├── springkg-runtime/
│   ├── springkg-community/
│   ├── springkg-installer/
│   ├── springkg-mcp/             #   4 个 spring_* MCP 工具
│   └── springkg-cli/
│
├── examples/
│   └── springcloud-demo/         # 二开:用于本地验证的 Spring Cloud 演示项目
│
├── docs/                         # 文档
├── scripts/                      # 脚本
├── __tests__/                    # 测试
└── ...
```

---

## 致谢与许可

- **上游项目**: [colbymchenry/springgraph](https://github.com/colbymchenry/springgraph),提供了完整的代码知识图谱基础设施
- **本仓库**: 在 Springgraph 基础上新增了面向 Spring Boot / Spring Cloud 的 SpringKg 语义层与架构剖面引擎
- **许可**: MIT(与上游一致)
- **联系方式**: xyjnglong@163.com

---

<div align="center">

**Codegraph-SpringCloud / SpringKg**

为 Spring Cloud 微服务架构量身打造的语义知识图谱

</div>