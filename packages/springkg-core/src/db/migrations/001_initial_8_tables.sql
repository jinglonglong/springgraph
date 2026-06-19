-- Migration 001: Initial 8 tables for springkg.db
-- This file is applied by the migration runner; schema_versions tracks it separately.

-- spring_symbols: unified symbol table mirroring SpringKgNode from shared types
CREATE TABLE spring_symbols (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    codegraph_node_id TEXT UNIQUE,
    name TEXT,
    qualified_name TEXT,
    file_path TEXT,
    start_line INTEGER,
    end_line INTEGER,
    metadata TEXT,                        -- JSON
    confidence REAL DEFAULT 1.0,          -- Metis M fix: 0.0-1.0, default 1.0
    created_at INTEGER,
    updated_at INTEGER
);

-- spring_edges: unified edge table mirroring SpringKgEdge from shared types
CREATE TABLE spring_edges (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    metadata TEXT,                        -- JSON
    confidence REAL DEFAULT 1.0,          -- Metis M fix: 0.0-1.0, default 1.0
    created_at INTEGER
);

-- spring_endpoints: REST endpoint registry (derived from @GetMapping et al.)
CREATE TABLE spring_endpoints (
    id TEXT PRIMARY KEY,
    method TEXT,
    path TEXT,
    handler_class_id TEXT,
    handler_method_id TEXT,
    source_file_path TEXT,
    source_line INTEGER
);

-- spring_feign_clients: Feign client registry (from @FeignClient)
CREATE TABLE spring_feign_clients (
    id TEXT PRIMARY KEY,
    client_name TEXT UNIQUE,
    target_service TEXT,
    target_url TEXT,
    method_count INTEGER
);

-- spring_sql_statements: MyBatis / MyBatis-Plus SQL statements
-- Team C contract: mapper_namespace, statement_id, operation, sql_preview, xml_path
CREATE TABLE spring_sql_statements (
    id TEXT PRIMARY KEY,
    mapper_id TEXT,
    sql_hash TEXT UNIQUE,
    sql_text TEXT,
    parameter_count INTEGER,
    tables TEXT,                         -- JSON array of table names
    source_file_path TEXT,
    source_line INTEGER,
    mapper_namespace TEXT,                -- Team C contract: MyBatis namespace
    statement_id TEXT,                    -- Team C contract: mapped statement id
    operation TEXT,                       -- Team C contract: SELECT|INSERT|UPDATE|DELETE
    sql_preview TEXT,                     -- Team C contract: abbreviated SQL text
    xml_path TEXT                          -- Team C contract: XML mapper file path
);

-- runtime_config_properties: resolved @ConfigurationProperties / @Value entries
CREATE TABLE runtime_config_properties (
    id TEXT PRIMARY KEY,
    key TEXT,
    value_hash TEXT,
    is_sensitive INTEGER,
    source_file_path TEXT,
    source_line INTEGER,
    bean_id TEXT
);

-- feature_communities: community nodes for feature discovery (Team F)
CREATE TABLE feature_communities (
    id TEXT PRIMARY KEY,
    label TEXT,
    summary TEXT,
    member_count INTEGER,
    dirty INTEGER,                       -- 1 = needs summarization
    last_summarized_at INTEGER
);

-- feature_community_members: membership edges for communities (Team F)
CREATE TABLE feature_community_members (
    community_id TEXT,
    spring_node_id TEXT,
    membership_score REAL,
    UNIQUE(community_id, spring_node_id)
);
