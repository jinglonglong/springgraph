---
title: MCP 服务器
description: Springgraph 通过 MCP 向 AI Agent 暴露的 4 个 Spring 专用工具。
---

Springgraph 的 Spring 语义层以 [Model Context Protocol](https://modelcontextprotocol.io/) 服务器的形式运行。

由安装器配置好的 Agent 会自动启动该服务器。当项目成功建档且 `.springgraph/springkg.db` 索引存在时，Agent 就可以使用下列工具。

## Spring 专用工具 (共 4 个)

为了最大程度降低 AI Agent 选错工具的概率，并节省上下文窗口，本项目的 MCP 服务器**精简且仅暴露了 4 个**高频核心工具：

| 工具 | 用途 |
|---|---|
| `spring_find_entry` | 按 URL / Controller 类名 / Feign 名 / MQ topic / Scheduler 名称查找入口点；返回端点符号、handler 所在的 file:line，以及调用链头 |
| `spring_assets_overview` | 系统服务画像与敏感配置总览（服务、中间件、敏感配置项，敏感值会被遮蔽） |
| `spring_trace_flow` | 全链路追踪：从 Endpoint / Controller / Service / Repository 深入追踪到 Mapper 和 SQL |
| `spring_method_impact` | 方法影响分析：分析方法变更涉及的调用链、事务边界、异常处理及 SQL 依赖 |

---

## 工具接口详解

### 1. spring_find_entry

按名称或 URL 片段查找 Spring Boot 入口点，并返回端点符号、handler 所在的 file:line，以及调用链头。

**入参:**

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "可选，用于按 Controller 名称或路由路径过滤的搜索关键字。"
    },
    "url": {
      "type": "string",
      "description": "可选，用于查询的端点路径别名（例如 /api/users）。"
    },
    "includeEndpoints": {
      "type": "boolean",
      "description": "是否在响应中包含端点列表。"
    },
    "limit": {
      "type": "number",
      "description": "最大返回条数（默认 20）。",
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

从一个端点出发，沿 handler 方法、服务层、数据访问层一直追踪到 SQL 语句。每一步都返回文件路径与源码行号。

**入参:**

```json
{
  "type": "object",
  "properties": {
    "entryId": {
      "type": "string",
      "description": "可选，追踪的起点入口 ID（例如端点 ID）。"
    },
    "entryPath": {
      "type": "string",
      "description": "可选，追踪的起点端点路径（例如 /api/users）。"
    },
    "depth": {
      "type": "number",
      "description": "最大追踪深度（默认 5）。",
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

返回 `springkg.db` 中所有 Spring 资产的高层清单：Controller、Service、中间件、敏感配置项。无参数。

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

分析一个方法在整个 Spring 图中的影响范围：调用方、被调用方、关联端点、事务边界、异常处理、下游 SQL。

**入参:**

```json
{
  "type": "object",
  "properties": {
    "methodName": {
      "type": "string",
      "description": "要分析的方法名或全限定方法名（例如 'com.example.user.UserService.findAll'）。"
    },
    "depth": {
      "type": "number",
      "description": "上下游关系的遍历深度（默认 2）。",
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

---

## Agent 应该如何使用

面对 “X 是怎么实现的”、微服务接口调用链等问题，Agent 应当调用上述专属工具直接获取图谱分析结果，**完全不需要执行低效的 Grep 或 Read 文件搜索**。这能大幅降低 Token 消耗并提升决策效率。
