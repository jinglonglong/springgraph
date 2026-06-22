# Springgraph MCP — Spring Tools

The `springgraph-mcp` server exposes four Spring-aware tools over stdio (alongside the upstream `springgraph_*` tools exposed by the main `springgraph serve --mcp` server). Each tool accepts a JSON input and returns a structured JSON result. All tools operate on the active SpringKg session (project path resolved from the MCP root URI).

The exposed surface is intentionally narrow: the four tools cover the entry point lookup, project-wide overview, full-stack trace, and pre-change impact analysis that an agent most often needs when working on a Spring Boot codebase. Lower-level lookups (mappers, configs, gateways, communities, Nacos, env diff, runtime dependencies, change surface) still exist as indexable data — the agent can reach them through the upstream `springgraph_search` / `springgraph_explore` / `springgraph_node` tools when needed.

## Tool Reference

### 1. spring_find_entry

Finds Spring Boot controllers and their endpoint methods, optionally filtered by controller name or route path.

**Input schema:**

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Optional search query to filter by controller name or route path."
    },
    "limit": {
      "type": "number",
      "description": "Maximum results (default: 20).",
      "default": 20
    }
  }
}
```

**Output schema:**

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

### 2. spring_method_impact

Analyzes a method's impact across the Spring graph: callers, callees, endpoints, transaction boundaries, exception handlers, and downstream SQL operations. Use this before changing a method to understand what else will be affected.

**Input schema:**

```json
{
  "type": "object",
  "properties": {
    "methodName": {
      "type": "string",
      "description": "Method name or qualified method name to analyze (e.g. 'com.example.user.UserService.findAll')."
    },
    "depth": {
      "type": "number",
      "description": "Traversal depth for upstream/downstream relationships (default: 2).",
      "default": 2
    }
  },
  "required": ["methodName"]
}
```

**Output schema:**

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

### 3. spring_assets_overview

Returns a high-level inventory of all Spring assets indexed in springkg.db: controllers, services, middlewares, and sensitive configuration properties. Takes no parameters.

**Input schema:**

```json
{
  "type": "object",
  "properties": {}
}
```

**Output schema:**

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

**Example response:**

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

---

### 4. spring_trace_flow

Traces the execution path from an HTTP endpoint through its handler method, service layer, data-access layer, and SQL statement. Returns each hop with the file path and source line.

**Input schema:**

```json
{
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "description": "Endpoint URL to trace from, e.g. '/api/users'."
    },
    "depth": {
      "type": "number",
      "description": "Maximum depth to trace (1-5, default: 3).",
      "default": 3
    },
    "direction": {
      "type": "string",
      "enum": ["down", "up", "both"],
      "description": "Trace direction: 'down' (handler to SQL), 'up' (to Feign callers), 'both'.",
      "default": "down"
    }
  },
  "required": ["url"]
}
```

**Output schema:**

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

**Example response:**

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
