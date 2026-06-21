-- springkg.db schema — 8 tables + schema_versions bookkeeping

-- 1. spring_symbols
CREATE TABLE IF NOT EXISTS spring_symbols (
    id TEXT PRIMARY KEY,                          -- deterministic: `${kind}:${sha256(...).slice(0,32)}`
    kind TEXT NOT NULL,
    codegraph_node_id TEXT UNIQUE NOT NULL,       -- FK into CodeGraph's nodes table
    name TEXT,
    qualified_name TEXT,
    file_path TEXT,
    start_line INTEGER,
    end_line INTEGER,
    metadata TEXT,                                 -- JSON
    confidence REAL DEFAULT 1.0,                   -- Metis M fix: 0.0-1.0, default 1.0
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 2. spring_edges
CREATE TABLE IF NOT EXISTS spring_edges (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,                      -- FK to spring_symbols.id
    target_id TEXT NOT NULL,                      -- FK to spring_symbols.id
    kind TEXT NOT NULL,
    metadata TEXT,                                -- JSON
    confidence REAL DEFAULT 1.0,                  -- Metis M fix: 0.0-1.0, default 1.0
    created_at INTEGER NOT NULL
);

-- 3. spring_endpoints
CREATE TABLE IF NOT EXISTS spring_endpoints (
    id TEXT PRIMARY KEY,
    method TEXT NOT NULL,                        -- GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD|*
    path TEXT NOT NULL,
    handler_class_id TEXT,                       -- FK to spring_symbols.id
    handler_method_id TEXT,                      -- FK to spring_symbols.id
    source_file_path TEXT NOT NULL,
    source_line INTEGER NOT NULL
);

-- 4. spring_feign_clients
CREATE TABLE IF NOT EXISTS spring_feign_clients (
    id TEXT PRIMARY KEY,
    client_name TEXT UNIQUE NOT NULL,
    target_service TEXT NOT NULL,
    target_url TEXT,
    method_count INTEGER NOT NULL DEFAULT 0
);

-- 5. spring_sql_statements
CREATE TABLE IF NOT EXISTS spring_sql_statements (
    id TEXT PRIMARY KEY,
    mapper_id TEXT NOT NULL,                     -- FK to spring_symbols.id
    sql_hash TEXT UNIQUE NOT NULL,
    sql_text TEXT NOT NULL,
    parameter_count INTEGER NOT NULL DEFAULT 0,
    tables TEXT,                                 -- JSON array
    source_file_path TEXT NOT NULL,
    source_line INTEGER NOT NULL
);

-- 6. runtime_config_properties
CREATE TABLE IF NOT EXISTS runtime_config_properties (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL,
    value_hash TEXT NOT NULL,
    is_sensitive INTEGER NOT NULL DEFAULT 0,     -- boolean
    source_file_path TEXT NOT NULL,
    source_line INTEGER NOT NULL,
    bean_id TEXT                                 -- @ConfigurationProperties prefix
);

-- 7. feature_communities
CREATE TABLE IF NOT EXISTS feature_communities (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    member_count INTEGER NOT NULL DEFAULT 0,
    dirty INTEGER NOT NULL DEFAULT 1,             -- 1=dirty until SummaryGenerator runs
    last_summarized_at INTEGER
);

-- 8. feature_community_members
CREATE TABLE IF NOT EXISTS feature_community_members (
    id TEXT PRIMARY KEY,
    community_id TEXT NOT NULL,
    spring_node_id TEXT NOT NULL,
    membership_score REAL NOT NULL DEFAULT 0.0
);

-- Bookkeeping
CREATE TABLE IF NOT EXISTS schema_versions (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL,
    description TEXT
);

-- INDEXES (required per plan):
CREATE INDEX IF NOT EXISTS idx_spring_symbols_kind ON spring_symbols(kind);
CREATE INDEX IF NOT EXISTS idx_spring_symbols_file_path ON spring_symbols(file_path);
CREATE INDEX IF NOT EXISTS idx_spring_symbols_confidence ON spring_symbols(confidence);
CREATE INDEX IF NOT EXISTS idx_spring_symbols_codegraph_node_id ON spring_symbols(codegraph_node_id);

CREATE INDEX IF NOT EXISTS idx_spring_edges_source_id ON spring_edges(source_id);
CREATE INDEX IF NOT EXISTS idx_spring_edges_target_id ON spring_edges(target_id);
CREATE INDEX IF NOT EXISTS idx_spring_edges_kind ON spring_edges(kind);

CREATE INDEX IF NOT EXISTS idx_spring_endpoints_method_path ON spring_endpoints(method, path);

CREATE INDEX IF NOT EXISTS idx_spring_feign_clients_client_name ON spring_feign_clients(client_name);

CREATE INDEX IF NOT EXISTS idx_spring_sql_statements_mapper_id ON spring_sql_statements(mapper_id);
CREATE INDEX IF NOT EXISTS idx_spring_sql_statements_sql_hash ON spring_sql_statements(sql_hash);

CREATE INDEX IF NOT EXISTS idx_runtime_config_properties_key ON runtime_config_properties(key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_feature_community_members_cid_sid ON feature_community_members(community_id, spring_node_id);
CREATE INDEX IF NOT EXISTS idx_feature_community_members_spring_node_id ON feature_community_members(spring_node_id);
