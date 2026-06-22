---
title: MCP 服务器
description: Springgraph 通过 MCP 向 AI Agent 暴露的工具。
---

Springgraph 以 [Model Context Protocol](https://modelcontextprotocol.io/) 服务器的形式运行。启动方式:

```bash
springgraph serve --mcp
```

由安装器配置好的 Agent 会自动启动该服务器。当 `.springgraph/` 索引存在时,Agent 就可以使用下列工具。

## 通用工具

| 工具 | 用途 |
|---|---|
| `springgraph_search` | 在整个代码库中按名称查找符号 |
| `springgraph_callers` | 查找调用了某函数的位置 |
| `springgraph_callees` | 查找某函数内部调用了哪些 |
| `springgraph_impact` | 分析改动一个符号会影响哪些代码 |
| `springgraph_node` | 获取某个符号的详细信息(可选带源码) |
| `springgraph_explore` | 一次调用返回若干相关符号按文件分组的源码,以及它们之间的关系图 |
| `springgraph_files` | 获取已索引的文件结构(比直接扫文件系统快) |
| `springgraph_status` | 检查索引健康状况与统计信息 |

## Spring 专用工具

针对 Spring Boot / Spring Cloud 项目,MCP 服务器额外暴露 4 个 Spring 专用工具,服务于"快速拿到答案"的核心诉求:

| 工具 | 用途 |
|---|---|
| `spring_find_entry` | 按 URL / Controller 类名 / Feign 名 / MQ topic / Scheduler 名称查找入口点;返回端点符号、handler 的 file:line,以及调用链头 |
| `spring_assets_overview` | 服务、中间件、敏感配置总览(敏感值不返回) |
| `spring_trace_flow` | 全链路追踪:Endpoint → Controller → Service → Mapper → SQL → Table |
| `spring_method_impact` | 方法影响分析:调用链、事务边界、异常处理、SQL 依赖 |

工具精简的理由:经过 A/B 评估,工具数量超过 4 个会显著增加 Agent 选错工具的概率,所以这里把 Spring 语义层的 MCP 接口收窄到 4 个高频工具。被精简掉的工具(MyBatis mapper 查询、运行配置查询、Nacos/Gateway 概览、功能社区搜索、字段影响、模块摘要、变更影响面、运行时依赖、环境差异对比)在底层数据层仍然存在,可以通过上游 `springgraph_search` / `springgraph_explore` / `springgraph_node` 间接访问。

下面分别说明 4 个 Spring 专用工具的入参和出参。

### 1. spring_find_entry

按名称或 URL 片段查找 Spring Boot 入口点(Controller、Feign 客户端、Scheduler等),并返回端点符号、handler 所在的 file:line,以及调用链头。

**入参:**

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "可选,用于按 Controller 名称或路由路径过滤的搜索关键字。"
    },
    "url": {
      "type": "string",
      "description": "可选,用于查询的端点路径别名(例如 /api/users)。"
    },
    "includeEndpoints": {
      "type": "boolean",
      "description": "是否在响应中包含端点列表。"
    },
    "limit": {
      "type": "number",
      "description": "最大返回条数(默认 20)。",
      "default": 20
    }
  }
}
```

**出参:**

```json
{
  "type": "object",
  "properties": {
    "content": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "type": { "type": "string" },
          "text": { "type": "string" }
        }
      }
    }
  }
}
```

### 2. spring_trace_flow

从一个端点出发,沿 handler 方法、服务层、数据访问层一直追踪到 SQL 语句。每一步都返回文件路径与源码行号。

**入参:**

```json
{
  "type": "object",
  "properties": {
    "entryId": {
      "type": "string",
      "description": "可选,追踪的起点入口 ID(例如端点 ID)。"
    },
    "entryPath": {
      "type": "string",
      "description": "可选,追踪的起点端点路径(例如 /api/users)。"
    },
    "depth": {
      "type": "number",
      "description": "最大追踪深度(默认 5)。",
      "default": 5
    }
  }
}
```

**出参:**

```json
{
  "type": "object",
  "properties": {
    "content": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "type": { "type": "string" },
          "text": { "type": "string" }
        }
      }
    }
  }
}
```

**示例响应:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "## Endpoint GET /api/orders/summary\n- ID: `endpoint:...`\n- Source: OrderController.java:14"
    },
    {
      "type": "text",
      "text": "## Controller `com.example.order.OrderController`\n- ID: `controller:...`\n- Source: OrderController.java:6"
    },
    {
      "type": "text",
      "text": "## Service\n\n- `com.example.order.OrderService` — OrderService.java:8"
    },
    {
      "type": "text",
      "text": "## Mapper\n\n- `com.example.order.OrderMapper` — OrderMapper.java:5"
    }
  ]
}
```

### 3. spring_assets_overview

返回 springkg.db 中所有 Spring 资产的高层清单:Controller、Service、中间件、敏感配置项。无参数。

**入参:**

```json
{
  "type": "object",
  "properties": {}
}
```

**出参:**

```json
{
  "type": "object",
  "properties": {
    "content": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "type": { "type": "string" },
          "text": { "type": "string" }
        }
      }
    }
  }
}
```

**示例响应:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "## Services (3)\n\n- `com.example.user.UserController` — user-service/src/main/java/com/example/user/UserController.java:7"
    },
    {
      "type": "text",
      "text": "## Middlewares (1)\n\n- **Filter** `localhost:8080` — gateway-service/src/main/java/com/example/gateway/MyFilter.java:10"
    },
    {
      "type": "text",
      "text": "## Sensitive Config (2)\n\n- `spring.datasource.password` — common-service/src/main/resources/application.yml:5 — value: `***` (never returned)"
    }
  ]
}
```

### 4. spring_method_impact

分析一个方法在整个 Spring 图中的影响范围:调用方、被调用方、关联端点、事务边界、异常处理、下游 SQL。修改方法前先调用,了解会牵动哪些地方。

**入参:**

```json
{
  "type": "object",
  "properties": {
    "methodName": {
      "type": "string",
      "description": "要分析的方法名或全限定方法名(例如 'com.example.user.UserService.findAll')。"
    },
    "depth": {
      "type": "number",
      "description": "上下游关系的遍历深度(默认 2)。",
      "default": 2
    }
  },
  "required": ["methodName"]
}
```

**出参:**

```json
{
  "type": "object",
  "properties": {
    "content": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "type": { "type": "string" },
          "text": { "type": "string" }
        }
      }
    }
  }
}
```

## Agent 应该如何使用

Springgraph 本身就是一个预先建好的搜索索引。面对 "X 是怎么实现的"、架构、调用链、"X 在哪里" 这一类问题,Agent 应当用几次 Springgraph 调用就直接给出答案并停止——通常**完全不需要 Read 文件**——而不是用 `grep` + `Read` 重新推导。一次直接的 Springgraph 回答只需要几次调用,而 grep/read 式探索往往要几十次。

安装器会自动把上述指引写入每个 Agent 的指令文件。
