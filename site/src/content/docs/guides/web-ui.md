---
title: Web UI 可视化
description: 如何启动和使用 Springgraph 的 Web UI 架构与依赖关系可视化工具。
---

Springgraph 提供了一个基于浏览器的 **Web UI（图形化依赖浏览器）**，用于直观地查看 Spring Boot / Spring Cloud 微服务项目的架构和依赖关系。

该 Web 页面使用 [Cytoscape.js](https://js.cytoscape.org/) 来渲染动态关系图，能够以分层和角色的视角展示代码拓扑。

---

## 启动 Web UI

在已初始化并完成建档的项目根目录下，直接运行以下命令：

```bash
springgraph web
```

运行后，服务会自动在后台启动，并**自动打开浏览器**访问可视化界面。

### 命令行参数

你可以使用以下参数微调启动配置：

| 参数 | 说明 | 默认值 | 示例 |
|---|---|---|---|
| `-p, --port <number>` | 指定 Web UI 运行的端口 | `4000` | `springgraph web -p 8080` |
| `--host <string>` | 指定绑定的主机地址 | `127.0.0.1` | `springgraph web --host 0.0.0.0` |
| `--no-open` | 启动后不自动在浏览器中打开页面 | — | `springgraph web --no-open` |

服务启动成功的输出示例：
```
springgraph info: Web UI server running at http://127.0.0.1:4000/
```

---

## 核心功能与使用方法

### 1. 架构分层展示
画布基于 **架构剖面引擎（Architecture Profile Engine）**，将代码元素自动划分为 6 大层级，并用不同色块进行区分：
* **Entry (入口层)**：带有 `@RestController`、`@Controller` 的控制类及定时任务。
* **Remote (远程调用层)**：`@FeignClient` 声明的远程调用接口。
* **Business (业务层)**：标有 `@Service` 的核心业务实现。
* **Data (数据层)**：标有 `@Mapper` 的数据访问接口。
* **Model (模型层)**：Entity、DTO、VO 等数据模型。
* **Infrastructure (基础设施层)**：系统配置类、拦截器、过滤器。

### 2. 交互式链路追踪
* **高亮关联边**：鼠标悬停在任意节点上，画布会自动高亮其整个调用路径（上游调用者和下游被调用者），其它无关节点会变淡。这能帮助你快速评估“修改这个方法会影响哪些端点或数据库操作”。
* **细节下钻 (Details)**：点击节点可在侧边栏中查看该符号的完整限定名、源码文件及行数、方法签名、关联的 SQL 文本（对 Mapper 节点）或对应的 HTTP 路径。

---

## 架构分析 REST API

Web UI 服务器在启动时，也会在后台暴露一组用于查询架构拓扑的 HTTP API（默认前缀为 `http://127.0.0.1:4000`），供二次开发使用：

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/architecture/nodes` | `GET` | 返回整个知识图谱中被识别为 Spring 符号的节点列表（包含分层和角色属性） |
| `/api/architecture/edges` | `GET` | 返回节点间的调用、依赖、装配关系边列表 |
| `/api/architecture/trace` | `GET` | 传入 `?url=/path` 参数，返回该 HTTP 请求的调用链路拓扑数据 |
| `/api/architecture/overview` | `GET` | 返回系统当前服务、中间件、敏感配置的统计概要（与 `spring_assets_overview` 数据对齐） |
