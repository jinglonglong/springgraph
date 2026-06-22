# SpringKg Database Schema

`springkg.db` lives inside the project's `.springgraph/` directory alongside `springgraph.db`. It is initialized by `SpringDatabase.initialize()` using the migration at `packages/springkg-core/src/db/migrations/001_initial_8_tables.sql`.

## Entity-Relationship Diagram

```mermaid
erDiagram
    SPRING_SYMBOLS {
        text id PK
        text kind
        text springgraph_node_id UK NN
        text name
        text qualified_name
        text file_path
        int start_line
        int end_line
        json metadata
        real confidence
        int created_at
        int updated_at
    }

    SPRING_EDGES {
        text id PK
        text source_id FK NN
        text target_id FK NN
        text kind
        json metadata
        real confidence
        int created_at
    }

    SPRING_ENDPOINTS {
        text id PK
        text method
        text path
        text handler_class_id FK
        text handler_method_id FK
        text source_file_path
        int source_line
    }

    SPRING_FEIGN_CLIENTS {
        text id PK
        text client_name UK NN
        text target_service
        text target_url
        int method_count
    }

    SPRING_SQL_STATEMENTS {
        text id PK
        text mapper_id FK NN
        text sql_hash UK NN
        text sql_text
        int parameter_count
        json tables
        text source_file_path
        int source_line
    }

    RUNTIME_CONFIG_PROPERTIES {
        text id PK
        text key
        text value_hash
        int is_sensitive
        text source_file_path
        int source_line
        text bean_id
    }

    FEATURE_COMMUNITIES {
        text id PK
        text label NN
        text summary
        int member_count
        int dirty
        int last_summarized_at
    }

    FEATURE_COMMUNITY_MEMBERS {
        text id PK
        text community_id FK NN
        text spring_node_id FK NN
        real membership_score
    }

    SPRING_SYMBOLS ||--o{ SPRING_EDGES : "source"
    SPRING_SYMBOLS ||--o{ SPRING_EDGES : "target"
    SPRING_SYMBOLS ||--o{ SPRING_ENDPOINTS : "handler_class"
    SPRING_SYMBOLS ||--o{ SPRING_ENDPOINTS : "handler_method"
    SPRING_SYMBOLS ||--o{ SPRING_SQL_STATEMENTS : "mapper"
    SPRING_SYMBOLS ||--o{ FEATURE_COMMUNITY_MEMBERS : "spring_node"
    FEATURE_COMMUNITIES ||--o{ FEATURE_COMMUNITY_MEMBERS : "members"
```

## Table Specifications

### 1. spring_symbols

The central node table. Stores every Spring semantic symbol emitted by a resolver.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| `id` | TEXT | PRIMARY KEY | Deterministic: `${kind}:${sha256(...).slice(0,32)}` |
| `kind` | TEXT | NOT NULL | One of SPRINGKG_NODE_KINDS |
| `springgraph_node_id` | TEXT | UNIQUE, NOT NULL | FK into Springgraph `nodes.id` |
| `name` | TEXT | - | Short display name |
| `qualified_name` | TEXT | - | Fully-qualified name when available |
| `file_path` | TEXT | - | Source file path |
| `start_line` | INTEGER | - | First line of the symbol definition |
| `end_line` | INTEGER | - | Last line of the symbol definition |
| `metadata` | TEXT | - | JSON object with per-kind extra fields |
| `confidence` | REAL | DEFAULT 1.0 | 0.0 to 1.0; lower values indicate heuristic-only matches |
| `created_at` | INTEGER | NOT NULL | Unix timestamp (ms) of first insertion |
| `updated_at` | INTEGER | NOT NULL | Unix timestamp (ms) of last update |

**Indexes:**
- `idx_spring_symbols_kind` on `kind`
- `idx_spring_symbols_file_path` on `file_path`
- `idx_spring_symbols_confidence` on `confidence`
- `idx_spring_symbols_springgraph_node_id` on `springgraph_node_id`

---

### 2. spring_edges

Directed edges between SpringKg symbols.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| `id` | TEXT | PRIMARY KEY | `${source_id}:${kind}:${target_id}` |
| `source_id` | TEXT | NOT NULL, FK | Source SpringKg symbol id |
| `target_id` | TEXT | NOT NULL, FK | Target SpringKg symbol id |
| `kind` | TEXT | NOT NULL | One of SPRINGKG_EDGE_KINDS |
| `metadata` | TEXT | - | JSON object with edge-level extras |
| `confidence` | REAL | DEFAULT 1.0 | 0.0 to 1.0 |
| `created_at` | INTEGER | NOT NULL | Unix timestamp (ms) |

**Indexes:**
- `idx_spring_edges_source_id` on `source_id`
- `idx_spring_edges_target_id` on `target_id`
- `idx_spring_edges_kind` on `kind`

---

### 3. spring_endpoints

REST endpoint registrations extracted from @GetMapping, @PostMapping, etc.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| `id` | TEXT | PRIMARY KEY | `${method}:${path}` |
| `method` | TEXT | NOT NULL | HTTP verb: GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD, or * |
| `path` | TEXT | NOT NULL | URL path pattern, e.g. `/api/users/{id}` |
| `handler_class_id` | TEXT | FK | SpringKg symbol id of the controller class |
| `handler_method_id` | TEXT | FK | SpringKg symbol id of the handler method |
| `source_file_path` | TEXT | NOT NULL | File where the annotation appears |
| `source_line` | INTEGER | NOT NULL | Line number of the annotation |

**Indexes:**
- `idx_spring_endpoints_method_path` on `(method, path)`

---

### 4. spring_feign_clients

Feign client interface declarations.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| `id` | TEXT | PRIMARY KEY | `${client_name}` |
| `client_name` | TEXT | UNIQUE, NOT NULL | Value of @FeignClient(name="...") |
| `target_service` | TEXT | NOT NULL | Target microservice name |
| `target_url` | TEXT | - | Optional explicit URL from @FeignClient(url="...") |
| `method_count` | INTEGER | NOT NULL, DEFAULT 0 | Number of declared interface methods |

**Indexes:**
- `idx_spring_feign_clients_client_name` on `client_name`

---

### 5. spring_sql_statements

SQL statements extracted from MyBatis XML mappers and @Select/@Insert annotations.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| `id` | TEXT | PRIMARY KEY | `${mapper_id}:${sha256(sql_text)}` |
| `mapper_id` | TEXT | NOT NULL, FK | SpringKg symbol id of the mapper method |
| `sql_hash` | TEXT | UNIQUE, NOT NULL | SHA256 of canonicalized SQL text |
| `sql_text` | TEXT | NOT NULL | Canonicalized SQL (whitespace normalized, literals stripped) |
| `parameter_count` | INTEGER | NOT NULL, DEFAULT 0 | Number of `#{...}` / `?` parameters |
| `tables` | TEXT | - | JSON array of table names extracted from SQL |
| `source_file_path` | TEXT | NOT NULL | Source file containing the statement |
| `source_line` | INTEGER | NOT NULL | Line number of the statement |

**Indexes:**
- `idx_spring_sql_statements_mapper_id` on `mapper_id`
- `idx_spring_sql_statements_sql_hash` on `sql_hash`

---

### 6. runtime_config_properties

Configuration key-value pairs from `application.yml` / `application.properties`.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| `id` | TEXT | PRIMARY KEY | `${source_file_path}:${source_line}:${key}` |
| `key` | TEXT | NOT NULL | Dot-notation config key, e.g. `spring.datasource.url` |
| `value_hash` | TEXT | NOT NULL | SHA256 of the raw value string |
| `is_sensitive` | INTEGER | NOT NULL, DEFAULT 0 | 1 if key matches sensitiveKeyPatterns |
| `source_file_path` | TEXT | NOT NULL | Config file path |
| `source_line` | INTEGER | NOT NULL | Line number of the key |
| `bean_id` | TEXT | - | @ConfigurationProperties prefix when bound to a bean |

**Indexes:**
- `idx_runtime_config_properties_key` on `key`

**Sensitive key detection** matches these patterns (case-insensitive): `password`, `passwd`, `secret`, `token`, `access_key`, `api_key`, `private_key`, `credential`, `auth`.

---

### 7. feature_communities

Clusters of Spring symbols that are strongly interconnected, representing a bounded context or feature module.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| `id` | TEXT | PRIMARY KEY | `${label}:${sha256(...).slice(0,16)}` |
| `label` | TEXT | NOT NULL | Human-readable community name |
| `summary` | TEXT | NOT NULL, DEFAULT '' | Auto-generated or LLM summary of what this community does |
| `member_count` | INTEGER | NOT NULL, DEFAULT 0 | Number of member symbols |
| `dirty` | INTEGER | NOT NULL, DEFAULT 1 | 1 = needs re-summarization; 0 = summary is current |
| `last_summarized_at` | INTEGER | - | Unix timestamp (ms) of last summary generation |

---

### 8. feature_community_members

Membership join table linking SpringKg symbols to communities.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| `id` | TEXT | PRIMARY KEY | `${community_id}:${spring_node_id}` |
| `community_id` | TEXT | NOT NULL, FK | Community id |
| `spring_node_id` | TEXT | NOT NULL, FK | SpringKg symbol id |
| `membership_score` | REAL | NOT NULL, DEFAULT 0.0 | 0.0 to 1.0; strength of association |

**Indexes:**
- `idx_feature_community_members_cid_sid` UNIQUE on `(community_id, spring_node_id)`
- `idx_feature_community_members_spring_node_id` on `spring_node_id`

---

## schema_versions

Tracks which migrations have been applied.

| Column | Type | Constraints |
|--------|------|-------------|
| `version` | INTEGER | PRIMARY KEY |
| `applied_at` | INTEGER | NOT NULL |
| `description` | TEXT | - |

---

## Cross-Database Linking

SpringKg nodes link to Springgraph nodes via the `springgraph_node_id` column in `spring_symbols`. This column stores the exact `id` value from Springgraph's `nodes` table, enabling joins:

```sql
-- Find all Spring endpoints whose handler method maps to a given Springgraph symbol
SELECT se.method, se.path, ss.name, ss.file_path
FROM spring_endpoints se
JOIN spring_symbols ss ON se.handler_method_id = ss.id
WHERE ss.springgraph_node_id = 'method:sha256...abc123';
```

This linkage is the recommended pattern for tools that need to reference Springgraph nodes from SpringKg data.
