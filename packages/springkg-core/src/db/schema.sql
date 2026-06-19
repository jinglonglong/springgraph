-- springkg SQLite Schema
-- Version 1
-- Confidence column (Metis M fix): both spring_symbols and spring_edges carry a
-- confidence REAL DEFAULT 1.0 so that heuristic/synthesized edges from
-- Teams B/C/D/F can be down-weighted without schema changes.

-- =============================================================================
-- Bookkeeping
-- =============================================================================

CREATE TABLE IF NOT EXISTS schema_versions (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL,
    description TEXT
);

-- Insert initial version
INSERT INTO schema_versions (version, applied_at, description)
VALUES (1, strftime('%s', 'now') * 1000, 'Initial schema');

-- =============================================================================
-- Core Tables
-- =============================================================================

-- spring_symbols: unified symbol table mirroring SpringKgNode from shared types
CREATE TABLE IF NOT EXISTS spring_symbols (
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
CREATE TABLE IF NOT EXISTS spring_edges (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    metadata TEXT,                        -- JSON
    confidence REAL DEFAULT 1.0,          -- Metis M fix: 0.0-1.0, default 1.0
    created_at INTEGER
);

-- spring_endpoints: REST endpoint registry (derived from @GetMapping et al.)
CREATE TABLE IF NOT EXISTS spring_endpoints (
    id TEXT PRIMARY KEY,
    method TEXT,
    path TEXT,
    handler_class_id TEXT,
    handler_method_id TEXT,
    source_file_path TEXT,
    source_line INTEGER
);

-- spring_feign_clients: Feign client registry (from @FeignClient)
CREATE TABLE IF NOT EXISTS spring_feign_clients (
    id TEXT PRIMARY KEY,
    client_name TEXT UNIQUE,
    target_service TEXT,
    target_url TEXT,
    method_count INTEGER
);

-- spring_sql_statements: MyBatis / MyBatis-Plus SQL statements
-- Team C contract: mapper_namespace, statement_id, operation, sql_preview, xml_path
CREATE TABLE IF NOT EXISTS spring_sql_statements (
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
CREATE TABLE IF NOT EXISTS runtime_config_properties (
    id TEXT PRIMARY KEY,
    key TEXT,
    value_hash TEXT,
    is_sensitive INTEGER,
    source_file_path TEXT,
    source_line INTEGER,
    bean_id TEXT
);

-- feature_communities: community nodes for feature discovery (Team F)
CREATE TABLE IF NOT EXISTS feature_communities (
    id TEXT PRIMARY KEY,
    label TEXT,
    summary TEXT,
    member_count INTEGER,
    dirty INTEGER,                       -- 1 = needs summarization
    last_summarized_at INTEGER
);

-- feature_community_members: membership edges for communities (Team F)
CREATE TABLE IF NOT EXISTS feature_community_members (
    community_id TEXT,
    spring_node_id TEXT,
    membership_score REAL,
    UNIQUE(community_id, spring_node_id)
);

-- =============================================================================
-- Indexes
-- =============================================================================

-- spring_symbols indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_spring_symbols_codegraph_node_id
    ON spring_symbols(codegraph_node_id);
CREATE INDEX IF NOT EXISTS idx_spring_symbols_kind
    ON spring_symbols(kind);
CREATE INDEX IF NOT EXISTS idx_spring_symbols_file_path
    ON spring_symbols(file_path);
CREATE INDEX IF NOT EXISTS idx_spring_symbols_confidence
    ON spring_symbols(confidence);

-- spring_edges indexes
CREATE INDEX IF NOT EXISTS idx_spring_edges_source_id
    ON spring_edges(source_id);
CREATE INDEX IF NOT EXISTS idx_spring_edges_target_id
    ON spring_edges(target_id);
CREATE INDEX IF NOT EXISTS idx_spring_edges_kind
    ON spring_edges(kind);

-- spring_endpoints indexes
CREATE INDEX IF NOT EXISTS idx_spring_endpoints_method_path
    ON spring_endpoints(method, path);

-- spring_feign_clients indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_spring_feign_clients_client_name
    ON spring_feign_clients(client_name);

-- spring_sql_statements indexes
CREATE INDEX IF NOT EXISTS idx_spring_sql_statements_mapper_id
    ON spring_sql_statements(mapper_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_spring_sql_statements_sql_hash
    ON spring_sql_statements(sql_hash);

-- runtime_config_properties indexes
CREATE INDEX IF NOT EXISTS idx_runtime_config_properties_key
    ON runtime_config_properties(key);

-- feature_community_members indexes
CREATE INDEX IF NOT EXISTS idx_feature_community_members_community_id
    ON feature_community_members(community_id);
CREATE INDEX IF NOT EXISTS idx_feature_community_members_spring_node_id
    ON feature_community_members(spring_node_id);
