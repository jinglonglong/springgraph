# SpringKg MCP Tools

The `springkg-mcp` server exposes five tools over stdio. Each tool accepts a JSON input and returns a structured JSON result. All tools operate on the active SpringKg session (project path resolved from the MCP root URI).

## Tool Reference

### 1. spring_find_entry

Finds Spring Boot application entry points (classes with `@SpringBootApplication`) and optionally lists all `@RestController` endpoints discovered in the project.

**Input schema:**

```json
{
  "type": "object",
  "properties": {
    "projectPath": {
      "type": "string",
      "description": "Absolute path to the project. Defaults to MCP server rootUri."
    },
    "includeEndpoints": {
      "type": "boolean",
      "default": false,
      "description": "When true, returns all discovered REST endpoints in addition to entry points."
    }
  }
}
```

**Output schema:**

```json
{
  "type": "object",
  "properties": {
    "entryPoints": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "className": { "type": "string" },
          "filePath": { "type": "string" },
          "startLine": { "type": "integer" }
        }
      }
    },
    "endpoints": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "method": { "type": "string" },
          "path": { "type": "string" },
          "handlerClass": { "type": "string" },
          "handlerMethod": { "type": "string" },
          "filePath": { "type": "string" },
          "sourceLine": { "type": "integer" }
        }
      }
    }
  }
}
```

**Example response:**

```json
{
  "entryPoints": [
    {
      "className": "com.example.demo.DemoApplication",
      "filePath": "src/main/java/com/example/demo/DemoApplication.java",
      "startLine": 8
    }
  ],
  "endpoints": [
    {
      "method": "GET",
      "path": "/api/users",
      "handlerClass": "com.example.user.UserController",
      "handlerMethod": "listUsers",
      "filePath": "src/main/java/com/example/user/UserController.java",
      "sourceLine": 14
    },
    {
      "method": "POST",
      "path": "/api/users",
      "handlerClass": "com.example.user.UserController",
      "handlerMethod": "createUser",
      "filePath": "src/main/java/com/example/user/UserController.java",
      "sourceLine": 19
    }
  ]
}
```

---

### 2. spring_find_feign

Finds all `@FeignClient` interface declarations in the project, listing client name, target service, declared methods, and the DTO types used in request/response bodies.

**Input schema:**

```json
{
  "type": "object",
  "properties": {
    "projectPath": {
      "type": "string",
      "description": "Absolute path to the project."
    },
    "clientName": {
      "type": "string",
      "description": "Filter by exact client name. Omit to return all clients."
    }
  }
}
```

**Output schema:**

```json
{
  "type": "object",
  "properties": {
    "clients": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "clientName": { "type": "string" },
          "targetService": { "type": "string" },
          "targetUrl": { "type": "string" },
          "methods": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "name": { "type": "string" },
                "httpMethod": { "type": "string" },
                "path": { "type": "string" },
                "returnType": { "type": "string" },
                "parameterTypes": { "type": "array", "items": { "type": "string" } }
              }
            }
          },
          "filePath": { "type": "string" },
          "sourceLine": { "type": "integer" }
        }
      }
    }
  }
}
```

**Example response:**

```json
{
  "clients": [
    {
      "clientName": "order-service",
      "targetService": "order-service",
      "targetUrl": null,
      "methods": [
        {
          "name": "getOrderById",
          "httpMethod": "GET",
          "path": "/{id}",
          "returnType": "String",
          "parameterTypes": ["Long"]
        },
        {
          "name": "createOrder",
          "httpMethod": "POST",
          "path": "",
          "returnType": "String",
          "parameterTypes": ["Object"]
        }
      ],
      "filePath": "src/main/java/com/example/order/OrderClient.java",
      "sourceLine": 5
    }
  ]
}
```

---

### 3. spring_find_mapper

Finds MyBatis mapper interfaces and their methods, optionally filtered by namespace or method name. Returns SQL source information indicating whether the SQL is defined in an XML file or as an annotation.

**Input schema:**

```json
{
  "type": "object",
  "properties": {
    "projectPath": {
      "type": "string",
      "description": "Absolute path to the project."
    },
    "namespace": {
      "type": "string",
      "description": "Filter by fully-qualified mapper interface name, e.g. 'com.example.user.UserMapper'. Omit to return all mappers."
    },
    "methodName": {
      "type": "string",
      "description": "Filter by method name. Can be combined with namespace or used alone."
    }
  }
}
```

**Output schema:**

```json
{
  "type": "object",
  "properties": {
    "found": { "type": "boolean" },
    "query": {
      "type": "object",
      "properties": {
        "namespace": { "type": "string" },
        "methodName": { "type": "string" }
      }
    },
    "mappers": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "namespace": { "type": "string" },
          "methods": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "name": { "type": "string" },
                "sqlSource": { "type": "string", "enum": ["xml", "annotation"] },
                "sqlText": { "type": "string" },
                "filePath": { "type": "string" },
                "line": { "type": "integer" }
              }
            }
          }
        }
      }
    }
  }
}
```

**Example response:**

```json
{
  "found": true,
  "query": { "methodName": "selectById" },
  "mappers": [
    {
      "namespace": "com.example.user.UserMapper",
      "methods": [
        {
          "name": "selectById",
          "sqlSource": "annotation",
          "sqlText": "SELECT * FROM users WHERE id = #{id}",
          "filePath": "src/main/java/com/example/user/UserMapper.java",
          "line": 12
        }
      ]
    }
  ]
}
```

**Example response for XML-based SQL:**

```json
{
  "found": true,
  "query": { "methodName": "findAll" },
  "mappers": [
    {
      "namespace": "com.example.user.UserMapper",
      "methods": [
        {
          "name": "findAll",
          "sqlSource": "xml",
          "sqlText": "SELECT * FROM users",
          "filePath": "src/main/resources/mapper/UserMapper.xml",
          "line": 5
        }
      ]
    }
  ]
}
```

---

### 4. spring_assets_overview

Returns a high-level inventory of all Spring assets indexed in springkg.db: controllers, services, repositories, Feign clients, data entities, SQL statements, and configuration properties.

**Input schema:**

```json
{
  "type": "object",
  "properties": {
    "projectPath": {
      "type": "string",
      "description": "Absolute path to the project."
    },
    "filter": {
      "type": "object",
      "description": "Optional filter by asset kind. Keys are node kind names.",
      "additionalProperties": {
        "type": "boolean"
      }
    }
  }
}
```

**Output schema:**

```json
{
  "type": "object",
  "properties": {
    "summary": {
      "type": "object",
      "properties": {
        "totalSymbols": { "type": "integer" },
        "totalEdges": { "type": "integer" },
        "endpoints": { "type": "integer" },
        "feignClients": { "type": "integer" },
        "sqlStatements": { "type": "integer" },
        "configProperties": { "type": "integer" }
      }
    },
    "byKind": {
      "type": "object",
      "additionalProperties": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id": { "type": "string" },
            "name": { "type": "string" },
            "qualifiedName": { "type": "string" },
            "filePath": { "type": "string" },
            "startLine": { "type": "integer" }
          }
        }
      }
    }
  }
}
```

**Example response:**

```json
{
  "summary": {
    "totalSymbols": 47,
    "totalEdges": 128,
    "endpoints": 3,
    "feignClients": 1,
    "sqlStatements": 4,
    "configProperties": 18
  },
  "byKind": {
    "controller": [
      {
        "id": "controller:sha256...abc123",
        "name": "UserController",
        "qualifiedName": "com.example.user.UserController",
        "filePath": "src/main/java/com/example/user/UserController.java",
        "startLine": 6
      }
    ],
    "service": [...],
    "mapper": [...],
    "entity": [...]
  }
}
```

---

### 5. spring_trace_flow

Traces the execution path from an HTTP endpoint through its handler method, service layer, data-access layer, and SQL statement. Returns each hop with the file path and source line.

**Input schema:**

```json
{
  "type": "object",
  "properties": {
    "projectPath": {
      "type": "string",
      "description": "Absolute path to the project."
    },
    "endpoint": {
      "type": "string",
      "description": "Endpoint path to trace from, e.g. 'GET /api/users'."
    },
    "depth": {
      "type": "integer",
      "default": 5,
      "minimum": 1,
      "maximum": 10,
      "description": "Maximum number of hops to trace."
    }
  }
}
```

**Output schema:**

```json
{
  "type": "object",
  "properties": {
    "trace": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "hop": { "type": "integer" },
          "kind": { "type": "string" },
          "name": { "type": "string" },
          "qualifiedName": { "type": "string" },
          "filePath": { "type": "string" },
          "startLine": { "type": "integer" },
          "edgeKind": { "type": "string" }
        }
      }
    },
    "sqlStatements": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "sqlText": { "type": "string" },
          "tables": { "type": "array", "items": { "type": "string" } },
          "sourceFile": { "type": "string" },
          "sourceLine": { "type": "integer" }
        }
      }
    }
  }
}
```

**Example response:**

```json
{
  "trace": [
    {
      "hop": 1,
      "kind": "endpoint",
      "name": "GET /api/users",
      "qualifiedName": null,
      "filePath": "src/main/java/com/example/user/UserController.java",
      "startLine": 14,
      "edgeKind": null
    },
    {
      "hop": 2,
      "kind": "service",
      "name": "UserService",
      "qualifiedName": "com.example.user.UserService",
      "filePath": "src/main/java/com/example/user/UserService.java",
      "startLine": 8,
      "edgeKind": "HANDLED_BY"
    },
    {
      "hop": 3,
      "kind": "mapper_method",
      "name": "selectAll",
      "qualifiedName": "com.example.user.UserMapper.selectAll",
      "filePath": "src/main/java/com/example/user/UserMapper.java",
      "startLine": 10,
      "edgeKind": "CALLS"
    },
    {
      "hop": 4,
      "kind": "sql_statement",
      "name": "selectAll",
      "qualifiedName": "com.example.user.UserMapper::selectAll",
      "filePath": "src/main/resources/mapper/UserMapper.xml",
      "startLine": 9,
      "edgeKind": "EXECUTES_SQL"
    }
  ],
  "sqlStatements": [
    {
      "sqlText": "SELECT name FROM users",
      "tables": ["users"],
      "sourceFile": "src/main/resources/mapper/UserMapper.xml",
      "sourceLine": 9
    }
  ]
}
```
