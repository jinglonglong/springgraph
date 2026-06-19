# SpringKg MCP Tools

The `springkg-mcp` server exposes four tools over stdio. Each tool accepts a JSON input and returns a structured JSON result. All tools operate on the active SpringKg session (project path resolved from the MCP root URI).

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

### 2. spring_find_feign

Finds Feign client interfaces and their target services, optionally filtered by client name or target service name.

**Input schema:**

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Optional search query to filter by client name or target service."
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
