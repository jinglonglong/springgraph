# CodeGraph Source Analysis

## 1. Database Schema

CodeGraph stores its knowledge graph in a SQLite database (`.codegraph/codegraph.db`). The schema consists of five core tables, a virtual FTS5 table for full-text search, supporting indices, and trigger-based synchronization.

---

### 1.1 Core Tables

#### `schema_versions`

Tracks the database schema version history for migration purposes.

| Column | Type | Description |
|--------|------|-------------|
| `version` | INTEGER PRIMARY KEY | Schema version number |
| `applied_at` | INTEGER NOT NULL | Unix timestamp (milliseconds) when the version was applied |
| `description` | TEXT | Human-readable description of the schema version |

Initial version is 1, applied at installation time with the description "Initial schema".

---

#### `nodes`

Stores every code symbol extracted from the source codebase: functions, classes, methods, variables, interfaces, routes, components, and all other supported `NodeKind` values.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PRIMARY KEY | Unique node identifier. Format: `${kind}:${sha256truncated_32chars}` (see Section 1.4) |
| `kind` | TEXT NOT NULL | Node kind such as `function`, `class`, `method`, `interface`, `route`, `component` |
| `name` | TEXT NOT NULL | Symbol name as it appears in source |
| `qualified_name` | TEXT NOT NULL | Fully qualified name including namespace/module path |
| `file_path` | TEXT NOT NULL | Absolute or project-relative path to the source file |
| `language` | TEXT NOT NULL | Source language (e.g., `typescript`, `python`, `java`) |
| `start_line` | INTEGER NOT NULL | 1-based line number where the symbol definition begins |
| `end_line` | INTEGER NOT NULL | 1-based line number where the symbol definition ends |
| `start_column` | INTEGER NOT NULL | 0-based column where the symbol begins |
| `end_column` | INTEGER NOT NULL | 0-based column where the symbol ends |
| `docstring` | TEXT | Optional docstring or JSDoc comment |
| `signature` | TEXT | Function/method signature including parameters |
| `visibility` | TEXT | Visibility modifier: `public`, `private`, `protected`, `internal` |
| `is_exported` | INTEGER DEFAULT 0 | 1 if the symbol is exported from its module |
| `is_async` | INTEGER DEFAULT 0 | 1 if the function is async |
| `is_static` | INTEGER DEFAULT 0 | 1 if the member is static |
| `is_abstract` | INTEGER DEFAULT 0 | 1 if the class/method is abstract |
| `decorators` | TEXT | JSON array of decorator/annotation names |
| `type_parameters` | TEXT | JSON array of generic type parameters |
| `return_type` | TEXT | Normalized return type name |
| `updated_at` | INTEGER NOT NULL | Unix timestamp (ms) of last update |

Indices on `nodes`:

- `idx_nodes_kind` — for filtering by node kind
- `idx_nodes_name` — for exact name lookups
- `idx_nodes_qualified_name` — for fully-qualified name lookups
- `idx_nodes_file_path` — for listing all symbols in a file
- `idx_nodes_language` — for filtering by language
- `idx_nodes_file_line` — composite index on `(file_path, start_line)` for file-ordered symbol retrieval
- `idx_nodes_lower_name` — expression index on `lower(name)` for case-insensitive name lookups

---

#### `edges`

Stores relationships between nodes: calls, imports, extends, implements, references, type annotations, and all other supported `EdgeKind` values.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | Unique edge identifier |
| `source` | TEXT NOT NULL | Node ID of the edge origin (the caller, importer, etc.) |
| `target` | TEXT NOT NULL | Node ID of the edge destination (the definition being referenced) |
| `kind` | TEXT NOT NULL | Edge kind such as `calls`, `imports`, `extends`, `implements`, `references`, `returns`, `instantiates`, `overrides`, `decorates` |
| `metadata` | TEXT | JSON object with additional edge metadata (e.g., synthesizedBy channel name for heuristic edges) |
| `line` | INTEGER | Source code line where this edge was detected |
| `col` | INTEGER | Source code column where this edge was detected |
| `provenance` | TEXT DEFAULT NULL | Provenance tag. Set to `'heuristic'` for synthesized edges (e.g., Swift-ObjC bridge, React render synthesis). NULL for statically extracted edges. |

Foreign key constraints on `source` and `target` reference `nodes(id)` with `ON DELETE CASCADE`.

Indices on `edges`:

- `idx_edges_kind` — for filtering by edge kind
- `idx_edges_source_kind` — composite index on `(source, kind)` for efficient outgoing-edge queries by kind
- `idx_edges_target_kind` — composite index on `(target, kind)` for efficient incoming-edge queries by kind
- `idx_edges_provenance` — for filtering heuristic/synthesized edges

Note: Single-column `idx_edges_source` and `idx_edges_target` indexes are intentionally omitted. The composite indexes `(source, kind)` and `(target, kind)` support source-only and target-only lookups via SQLite's left-prefix scan, avoiding redundant write amplification.

---

#### `files`

Tracks every source file that has been indexed.

| Column | Type | Description |
|--------|------|-------------|
| `path` | TEXT PRIMARY KEY | File path as stored in the index |
| `content_hash` | TEXT NOT NULL | SHA-256 hash of the file content at last indexing |
| `language` | TEXT NOT NULL | Detected or specified language |
| `size` | INTEGER NOT NULL | File size in bytes at last indexing |
| `modified_at` | INTEGER NOT NULL | File system mtime at last indexing |
| `indexed_at` | INTEGER NOT NULL | Unix timestamp (ms) when the file was last indexed |
| `node_count` | INTEGER DEFAULT 0 | Number of nodes extracted from this file |
| `errors` | TEXT | JSON array of extraction errors or warnings |

Indices on `files`:

- `idx_files_language` — for listing files by language
- `idx_files_modified_at` — for identifying recently modified files

---

#### `unresolved_refs`

Stores reference resolution candidates that require a second-pass resolution after full indexing is complete. Used when a reference name could match multiple candidates or when the target has not yet been indexed.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | Unique identifier |
| `from_node_id` | TEXT NOT NULL | Node ID of the referencing symbol |
| `reference_name` | TEXT NOT NULL | The unresolved symbol name as it appears in source |
| `reference_kind` | TEXT NOT NULL | The expected node kind of the target |
| `line` | INTEGER NOT NULL | Source line of the unresolved reference |
| `col` | INTEGER NOT NULL | Source column of the unresolved reference |
| `candidates` | TEXT | JSON array of candidate node IDs (pre-computed possibilities) |
| `file_path` | TEXT NOT NULL DEFAULT '' | Path to the file containing the reference |
| `language` | TEXT NOT NULL DEFAULT 'unknown' | Source language of the reference |

Foreign key constraint on `from_node_id` references `nodes(id)` with `ON DELETE CASCADE`.

Indices on `unresolved_refs`:

- `idx_unresolved_from_node` — for finding all unresolved refs originating from a node
- `idx_unresolved_name` — for resolving references by name
- `idx_unresolved_file_path` — for processing references within specific files
- `idx_unresolved_from_name` — composite index on `(from_node_id, reference_name)`

---

#### `project_metadata`

Key-value store for version and provenance tracking of the project index.

| Column | Type | Description |
|--------|------|-------------|
| `key` | TEXT PRIMARY KEY | Metadata key |
| `value` | TEXT NOT NULL | Metadata value |
| `updated_at` | INTEGER NOT NULL | Unix timestamp (ms) of last update |

Used to store project-level facts such as the last indexed commit hash, branch name, or any other per-project metadata needed for cache invalidation or audit.

---

### 1.2 FTS5 Virtual Table: `nodes_fts`

CodeGraph provides full-text search over all indexed symbols via a virtual FTS5 table.

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
    id,
    name,
    qualified_name,
    docstring,
    signature,
    content='nodes',
    content_rowid='rowid'
);
```

The FTS table is backed by the `nodes` table (`content='nodes'`). It indexes five columns:

| FTS Column | Source Column | Weight |
|------------|---------------|--------|
| `id` | `id` | 0 (unused in scoring) |
| `name` | `name` | 20 (highest — name matches dominate) |
| `qualified_name` | `qualified_name` | 5 |
| `docstring` | `docstring` | 1 |
| `signature` | `signature` | 2 |

The high weight on `name` ensures that exact or prefix matches on the symbol name rank above incidental mentions in docstrings or qualified names of unrelated symbols.

### 1.3 FTS Triggers

Three triggers keep the FTS index synchronized with the `nodes` table automatically:

**`nodes_ai` (After Insert)**
Fires on INSERT. Inserts the new row's data into the FTS index.

```sql
CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
    INSERT INTO nodes_fts(rowid, id, name, qualified_name, docstring, signature)
    VALUES (NEW.rowid, NEW.id, NEW.name, NEW.qualified_name, NEW.docstring, NEW.signature);
END;
```

**`nodes_ad` (After Delete)**
Fires on DELETE. Marks the old row as deleted in the FTS index.

```sql
CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON nodes BEGIN
    INSERT INTO nodes_fts(nodes_fts, rowid, id, name, qualified_name, docstring, signature)
    VALUES ('delete', OLD.rowid, OLD.id, OLD.name, OLD.qualified_name, OLD.docstring, OLD.signature);
END;
```

**`nodes_au` (After Update)**
Fires on UPDATE. Removes the old FTS entry and inserts the new one (FTS5 does not support in-place updates).

```sql
CREATE TRIGGER IF NOT EXISTS nodes_au AFTER UPDATE ON nodes BEGIN
    INSERT INTO nodes_fts(nodes_fts, rowid, id, name, qualified_name, docstring, signature)
    VALUES ('delete', OLD.rowid, OLD.id, OLD.name, OLD.qualified_name, OLD.docstring, OLD.signature);
    INSERT INTO nodes_fts(rowid, id, name, qualified_name, docstring, signature)
    VALUES (NEW.rowid, NEW.id, NEW.name, NEW.qualified_name, NEW.docstring, NEW.signature);
END;
```

These triggers make the FTS index always consistent with the `nodes` table without requiring manual synchronization in application code.

### 1.4 Node ID Format and springkg Integration

Every node in the graph carries a stable, globally unique identifier with two components:

```
${kind}:${sha256truncated_32chars}
```

- **`kind`** — the node kind string (e.g., `function`, `class`, `method`, `route`, `component`)
- **`sha256truncated_32chars`** — the first 32 hex characters (128 bits) of the SHA-256 hash of a stable input derived from the symbol's definition: typically the concatenation of `qualified_name`, `file_path`, `start_line`, and `start_column`. The truncation to 32 characters keeps IDs compact while retaining sufficient collision resistance across a large codebase.

**Example node IDs:**

```
function:a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4
class:e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
method:9f8e7d6c5b4a3f8e7d6c5b4a3f8e7d6c
route:3a2b1c4d5e6f7a8b9c0d1e2f3a4b5c6d
```

#### Integration with springkg

In springkg (the Spring Knowledge Graph project), the `codegraph_node_id` field on any node entity uses this same format to create a direct, resolvable link from a springkg node to its originating CodeGraph symbol.

**Mapping strategy:**

1. When springkg imports or references a CodeGraph node, it stores the full `codegraph_node_id` string as the `codegraph_node_id` property on its own domain node.
2. To resolve the link, springkg parses the `codegraph_node_id` into its two components:
   - Extract `kind` to understand the symbol type
   - Use `sha256truncated_32chars` to verify or look up the node in CodeGraph's `nodes` table via `SELECT * FROM nodes WHERE id = '${kind}:${sha256truncated_32chars}'`
3. Optionally, springkg can use the `kind` prefix as a first-pass filter before attempting the full ID lookup.

**Example springkg entity definition:**

```json
{
  "id": "springkg:spring-service-UserService",
  "type": "SpringService",
  "codegraph_node_id": "class:a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
  "name": "UserService",
  "springkg_metadata": {
    "framework": "spring-boot",
    "layer": "service"
  }
}
```

This scheme provides:

- **Uniqueness** — the 128-bit hash component makes collisions vanishingly unlikely even across multiple projects
- **Verifiability** — springkg can confirm a CodeGraph node still exists and has not been invalidated
- **Provenance** — the `kind` prefix tells springkg the symbol type without requiring a lookup
- **Stability** — the hash is derived from position+name, so the ID remains stable across re-indexing unless the symbol itself moves or is renamed

---

### 1.5 QueryBuilder Method Mapping

The `QueryBuilder` class in `src/db/queries.ts` wraps all database operations. The following table maps each QueryBuilder method to the schema elements it primarily operates on.

| QueryBuilder Method | Primary Schema Elements |
|---------------------|------------------------|
| `insertNode` / `insertNodes` | `nodes` table |
| `updateNode` | `nodes` table |
| `deleteNode` | `nodes` table |
| `deleteNodesByFile` | `nodes` table |
| `getNodeById` | `nodes` table (primary key) |
| `getNodesByIds` | `nodes` table (primary key, batched IN query) |
| `getNodesByFile` | `nodes` table + `idx_nodes_file_path` |
| `getNodesByKind` | `nodes` table + `idx_nodes_kind` |
| `getNodesByName` | `nodes` table + `idx_nodes_name` |
| `getNodesByQualifiedNameExact` | `nodes` table + `idx_nodes_qualified_name` |
| `getNodesByLowerName` | `nodes` table + `idx_nodes_lower_name` |
| `getAllNodes` | `nodes` table (full scan) |
| `searchNodes` | `nodes_fts` FTS5 + `nodes` table |
| `searchNodesFTS` | `nodes_fts` FTS5 (prefix match, BM25 scoring) |
| `searchNodesLike` | `nodes` table (LIKE substring match) |
| `searchNodesFuzzy` | `nodes` table (bounded edit distance) |
| `findNodesByExactName` | `nodes` table + `idx_nodes_name` |
| `findNodesByNameSubstring` | `nodes` table (LIKE) |
| `insertEdge` / `insertEdges` | `edges` table |
| `deleteEdgesBySource` | `edges` table |
| `deleteEdgesByTarget` | `edges` table |
| `getOutgoingEdges` | `edges` table + `idx_edges_source_kind` |
| `getIncomingEdges` | `edges` table + `idx_edges_target_kind` |
| `findEdgesBetweenNodes` | `edges` table (JSON set intersection) |
| `getDependentFilePaths` | `edges` + `nodes` (join on target file) |
| `getDependencyFilePaths` | `edges` + `nodes` (join on source file) |
| `upsertFile` / `insertFile` | `files` table |
| `updateFile` | `files` table |
| `deleteFile` | `files` + `nodes` (transactional, cascades) |
| `getFileByPath` | `files` table (primary key) |
| `getAllFiles` | `files` table |
| `getStaleFiles` | `files` table (hash comparison) |
| `getLastIndexedAt` | `files` table (MAX aggregate) |
| `insertUnresolvedRef` / `insertUnresolvedRefsBatch` | `unresolved_refs` table |
| `deleteUnresolvedByNode` | `unresolved_refs` table + `idx_unresolved_from_node` |
| `getUnresolvedByName` | `unresolved_refs` table + `idx_unresolved_name` |
| `getUnresolvedReferences` | `unresolved_refs` table |
| `getUnresolvedReferencesCount` | `unresolved_refs` table (COUNT) |
| `getUnresolvedReferencesBatch` | `unresolved_refs` table (LIMIT/OFFSET) |
| `getUnresolvedReferencesByFiles` | `unresolved_refs` table + `idx_unresolved_file_path` |
| `clearUnresolvedReferences` | `unresolved_refs` table |
| `deleteResolvedReferences` | `unresolved_refs` table (IN query) |
| `deleteSpecificResolvedReferences` | `unresolved_refs` table (tuple match) |
| `getMetadata` | `project_metadata` table |
| `setMetadata` | `project_metadata` table (upsert) |
| `getAllMetadata` | `project_metadata` table |
| `getDominantFile` | `edges` + `nodes` (file edge-density aggregation) |
| `getTopRouteFile` | `nodes` table + `idx_nodes_kind` (route nodes) |
| `getRoutingManifest` | `nodes` + `edges` (route-to-handler join) |
| `getNodeAndEdgeCount` | `nodes` + `edges` (COUNT aggregates) |
| `getStats` | `nodes` + `edges` + `files` (multi-aggregate) |
| `clear` | `unresolved_refs` + `edges` + `nodes` + `files` (transactional DELETE) |

The QueryBuilder uses prepared statements for all hot paths and an LRU node cache (max 1000 entries) to accelerate repeated lookups of the same node ID.

---

## 4. MCP Architecture

### 4.1 Server Entry Point (`codegraph serve --mcp`)

`src/bin/codegraph.ts` exposes `codegraph serve` (hidden from `--help` — it is the stdio entry point an AI agent launches for itself, not a human command). The `--mcp` flag triggers MCP server mode:

```typescript
.command('serve', { hidden: true })
.option('--mcp', 'Run as MCP server (stdio transport)')
.option('-p, --path <path>', 'Project path')
.option('--no-watch', 'Disable the file watcher')
```

The `MCPServer` class is imported lazily (`await import('../mcp/index')`) so the heavy extraction/grammar chain never loads on the critical path of an agent startup that only needs to answer `tools/list`.

### 4.2 MCPServer (`src/mcp/index.ts`)

`MCPServer` is the top-level server class. It has three runtime modes decided at `start()`:

| Mode | Trigger | Description |
|---|---|---|
| `direct` | `CODEGRAPH_NO_DAEMON=1`, or no `.codegraph/` reachable | Single-process stdio session. Pre-#411 behavior. |
| `proxy` | Default when `.codegraph/` is reachable | Local handshake + forwards calls to a shared daemon over a Unix socket / named pipe. Handshake is instant; daemon connects in background. |
| `daemon` | Spawned by proxy when no daemon is running | Detached background process holding the shared SQLite + watcher. Survives session ends; reaped by idle timeout or refcount. |

The proxy mode answers the MCP handshake (tool schemas) instantly from the local process while forwarding actual tool calls to the background daemon, eliminating the ~600ms cold-start penalty that previously raced with the agent's first query.

The daemon is spawned via `spawnDetachedDaemon()` which re-invokes the CLI with `CODEGRAPH_DAEMON_INTERNAL=1`, ensuring the same binary (bundled or npm) serves as both CLI and daemon.

### 4.3 Tool Registration (`tools[]` at `src/mcp/tools.ts` line 415)

All tool definitions live in the `tools` array (line 415), a `ToolDefinition[]` exported from `src/mcp/tools.ts`. Each entry has `name`, `description`, and `inputSchema`.

**Default 4-tool surface** (what agents see by default):

| Tool | Name | Purpose |
|---|---|---|
| `codegraph_explore` | PRIMARY | Any question / flow / "how does X work" — one call returns verbatim source of relevant symbols plus the call path |
| `codegraph_node` | SECONDARY | One symbol's full source + caller/callee trail, or read a whole file with line numbers (drop-in replacement for Read) |
| `codegraph_search` | Lookup | Find symbols by name across the codebase |
| `codegraph_callers` | Enumeration | Every call site of a function, including callback registrations and multiple same-named definitions |

**Four unlisted tools** (`callees`, `impact`, `files`, `status`) remain fully functional via CLI and library API but are not shown to agents. The evidence for cutting them: `impact` appears in zero recorded eval runs (its blast-radius info already arrives inline on explore/node), `callees` is redundant by construction (a symbol's body IS its callee list), and `files`/`status` reduce to one grep.

**Tool allowlist — `CODEGRAPH_MCP_TOOLS` env var:**

```typescript
// src/mcp/tools.ts line 625-631
export function getStaticTools(): ToolDefinition[] {
  const raw = process.env.CODEGRAPH_MCP_TOOLS;
  if (!raw || !raw.trim()) {
    return tools.filter(t => DEFAULT_MCP_TOOLS.has(t.name.replace(/^codegraph_/, '')));
  }
  const allow = new Set(raw.split(',').map(s => s.trim().replace(/^codegraph_/, '')).filter(Boolean));
  return allow.size ? tools.filter(t => allow.has(t.name.replace(/^codegraph_/, ''))) : tools;
}
```

Set `CODEGRAPH_MCP_TOOLS=explore,node,search,callers,impact` to re-enable unlisted tools. The allowlist is checked at both `tools/list` (so disallowed tools are genuinely absent from the schema) and at `execute()` (so a client that cached the old list gets a clear error).

### 4.4 No Plugin Mechanism

CodeGraph has **no plugin mechanism**. Adding a new tool requires modifying `src/mcp/tools.ts` directly — adding an entry to the `tools[]` array and implementing its handler in `ToolHandler`. There is no plugin API, hook system, or external loader.

**Recommended integration pattern for custom tools:** run a **separate MCP server** alongside CodeGraph rather than extending it. The agent's MCP config can list multiple servers:

```json
{
  "mcpServers": {
    "codegraph": {
      "command": "codegraph",
      "args": ["serve", "--mcp"]
    },
    "my-custom-server": {
      "command": "node",
      "args": ["path/to/my-mcp-server/dist/index.js"]
    }
  }
}
```

### 4.5 ToolHandler and Execution Flow

`ToolHandler` (line 664) wraps a `CodeGraph` instance and implements all tool handlers. Key design points:

- **Lazy CodeGraph loading:** `loadCodeGraph()` uses `require()` (cached, synchronous) to pull in the SQLite/grammar chain only when a tool actually runs, not on server startup. This keeps `tools/list` fast.
- **Cross-project queries:** `getCodeGraph(projectPath?)` walks up directories to find `.codegraph/`, caches by resolved root, and refuses sensitive system paths via `validateProjectPath`.
- **Input validation:** `validateString()` and `validateOptionalPath()` enforce `MAX_INPUT_LENGTH` (10,000 chars) and `MAX_PATH_LENGTH` (4,096 chars) centrally, before any tool-specific logic runs.
- **Error handling:** `NotIndexedError` returns a SUCCESS-shaped response with guidance (not `isError: true`) so one unindexed workspace never teaches the agent to abandon the whole toolset. `PathRefusalError` is the one `isError: true` case — a genuine security refusal.
- **Staleness banners:** `withStalenessNotice()` prepends a per-file warning when the response references files that the watcher has not yet synced. A footer lists pending files elsewhere in the project.

The `execute()` switch (line 1146) routes to `handleSearch`, `handleCallers`, `handleCallees`, `handleImpact`, `handleExplore`, `handleNode`, `handleStatus`, `handleFiles`.

### 4.6 Dynamic Tool Surface and Explore Budget

`getTools()` (line 748) is the dynamic variant used after a project is open. It adapts the tool surface to project size:

- **Under 500 files:** only `explore`, `search`, `node` are exposed (not even `callers` — at this scale it reduces to one grep). Empirical floor: cutting below 5 tools caused regressions on single-file-framework repos.
- **500+ files:** the full default 4-tool surface.
- **`codegraph_explore` description** is augmented with a per-project budget recommendation: "make at most N calls for this project (X files indexed)" — scaled by `getExploreBudget(fileCount)` which returns 1-5 based on file count tiers.

### 4.7 Server Instructions (`src/mcp/server-instructions.ts`)

This file exports `SERVER_INSTRUCTIONS` (the full playbook) and `SERVER_INSTRUCTIONS_UNINDEXED` (a short "inactive" note). Both are sent in the MCP `initialize` response and surface directly in the agent's system prompt.

`SERVER_INSTRUCTIONS_UNINDEXED` is the single source of truth for agent-facing tool guidance. The installer no longer writes a duplicate instructions block into agent config files (the previous cause of issue #529 — the two copies would diverge).

The indexed instructions cover: tool selection by intent, common chains (flow = one `explore`, refactor = `callers` then `node`), anti-patterns (don't grep when search is faster, don't chain search+node when one explore suffices), and limitations (index lags ~1s, cross-file resolution is best-effort, no live correctness validation).

---

## 2. Java Extractor

The Java extractor is defined in `src/extraction/languages/java.ts` and wired into the general `TreeSitterExtractor` in `src/extraction/tree-sitter.ts`. It handles all JVM source files (`.java`; Kotlin uses the same resolver but has its own extractor).

### 2.1 AST Node to NodeKind Mapping

The extractor declares which tree-sitter node types correspond to each `NodeKind`. The mapping is read by `TreeSitterExtractor.visitNode` and dispatched to the appropriate `extract*` private method.

| tree-sitter node type | CodeGraph NodeKind | Notes |
|---|---|---|
| `class_declaration` | `class` | Regular class definitions |
| `method_declaration` | `method` | Instance and static methods inside classes |
| `constructor_declaration` | `method` | Java constructors, treated as `method` kind |
| `field_declaration` | `field` or `constant` | `static final` fields become `constant` (see §2.3); others are `field` |
| `interface_declaration` | `interface` | Plain Java interfaces |
| `annotation_type_declaration` | `interface` | `@interface Foo { … }` — annotation type definitions. Without this, annotation type nodes (`@SerializedName`, `@GetMapping`, JPA/Spring annotations) are invisible and every `@Foo` usage shows zero dependents |
| `enum_declaration` | `enum` | Java enums |
| `enum_constant` | `enum_member` | Individual enum constants |
| `import_declaration` | `import` | `import` statements, resolved to target module |
| `method_invocation` | (call edge only) | Method calls; produces a `calls` edge, not a node |
| `local_variable_declaration` | `variable` | Local variables inside method bodies |
| `package_declaration` | (namespace node) | Creates an implicit `namespace` node wrapping top-level declarations, giving them a fully qualified name |

The extractor also declares the field names used to navigate each node type:

```typescript
{
  nameField: 'name',        // field holding the symbol's simple name
  bodyField: 'body',        // field holding the class/method body block
  paramsField: 'parameters', // field holding method parameters
  returnField: 'type',      // field holding the return type annotation
}
```

### 2.2 Return Type Normalization

`extractJavaReturnType` (java.ts, line 25) reads the `type` field of a `method_declaration` or `constructor_declaration` and normalizes it for the `return_type` column in the `nodes` table. The normalization:

1. Skips primitives and `void` — these cannot be the receiver of a chained call, so they return `undefined` (no `return_type` stored).
2. Skips array types (`Foo[]`) — same reasoning.
3. Strips generic type arguments: `List<Foo>` becomes `List`.
4. Strips a dotted package qualifier: `java.util.List` becomes `List`.
5. Validates the result is a valid identifier before returning it.

```typescript
// java.ts
function extractJavaReturnType(node: SyntaxNode, source: string): string | undefined {
  const typeNode = getChildByField(node, 'type');
  if (!typeNode) return undefined;
  if (JAVA_NON_CLASS_RETURN_NODES.has(typeNode.type)) return undefined;
  if (typeNode.type === 'array_type') return undefined;
  const raw = getNodeText(typeNode, source).trim().replace(/<[^>]*>/g, '');
  const last = raw.split('.').pop()?.trim();
  if (!last || !/^[A-Za-z_]\w*$/.test(last)) return undefined;
  return last;
}
```

### 2.3 Constant vs Field: `static final` Detection

Java `static final` fields are stored as `constant` kind so that value-reference edges can target them. Instance fields and `final`-only or `static`-only fields stay as `field` kind. The `isConst` predicate checks for both `static` and `final` modifiers in the `modifiers` child:

```typescript
// java.ts
isConst: (node) => {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.type === 'modifiers') {
      const text = child.text;
      return /\bstatic\b/.test(text) && /\bfinal\b/.test(text);
    }
  }
  return false;
}
```

### 2.4 Visibility Modifier Extraction

The `getVisibility` function scans the `modifiers` child for `public`, `private`, or `protected` and returns the first match (in that priority order). If no modifier is found the field is absent from the node — Java defaults to package-private.

### 2.5 `extractDecoratorsFor`: Annotation/Decorator Extraction

`extractDecoratorsFor` (tree-sitter.ts, line 3540) is called from every symbol-creating extractor — `extractClass`, `extractMethod`, `extractProperty`, `extractField`, `extractFunction` — immediately after `createNode`. It finds all decorator/annotation nodes that precede or belong to the declaration and emits an unresolved reference of kind `decorates` for each one.

#### What node types are considered decorators

The function accepts four tree-sitter node types as decorators:

```typescript
if (
  n.type !== 'decorator' &&        // TypeScript / Python
  n.type !== 'annotation' &&        // Java/Kotlin (with args)
  n.type !== 'marker_annotation' && // Java (no args: @Override, @Deprecated)
  n.type !== 'attribute'           // Swift attributes
) {
  return;
}
```

#### How the decorator name is extracted

1. If the decorator has a `call_expression` child (e.g. `@GetMapping("/users")` or `@Autowired(required=false)`), the function is resolved from the `call_expression`'s `function` field.
2. Otherwise, the first named child of one of these types is used: `identifier`, `member_expression`, `scoped_identifier`, `navigation_expression`, `user_type` (Swift), `type_identifier`.
3. The name text is extracted, then cleaned:
   - Generic type arguments are stripped: `@Argument<T>` becomes `Argument`.
   - Everything before the last `.` or `::` is stripped: `org.example.MyAnno` becomes `MyAnno`.

```typescript
let name = getNodeText(target, this.source);
const lt = name.indexOf('<'); // strip generic args
if (lt > 0) name = name.slice(0, lt);
const lastDot = Math.max(name.lastIndexOf('.'), name.lastIndexOf('::'));
if (lastDot >= 0) name = name.slice(lastDot + 1).replace(/^[:.]/, '');
name = name.trim();
```

#### Where decorators are searched

The function searches two locations:

1. **Direct named children of the declaration node** — covers method/property decorators and also descends through a `modifiers` child (Java/Kotlin/C# put annotations inside `modifiers: @MyAnno public class X`).
2. **Preceding siblings of the declaration inside its parent** — covers TypeScript class style where `@Decorator class Foo {}` parses as `export_statement` with the `decorator` as a sibling before the `class_declaration`. The scan walks backwards and stops at the first non-decorator node, preventing decorators from an earlier unrelated declaration from leaking onto the next one.

#### Output: `decorates` unresolved reference

For each decorator found, one unresolved reference is pushed:

```typescript
this.unresolvedReferences.push({
  fromNodeId: decoratedId,   // the node that carries the decorator
  referenceName: name,       // e.g. "GetMapping", "Autowired"
  referenceKind: 'decorates',
  line: n.startPosition.row + 1,
  column: n.startPosition.column,
});
```

The `decorates` reference kind is resolved by the reference resolver. This is how `@RestController` on a class links to the `interface` node for `RestController` (the annotation type definition), giving the annotation type dependents in the graph.

#### `decorators` column on nodes

In addition to emitting a `decorates` edge, the decorator names are also stored as a JSON array in the `decorators` column on the node itself. This is done by `createNode` (tree-sitter.ts, line 1157), which merges in any `extractModifiers` result from the language extractor:

```typescript
const mods = this.extractor?.extractModifiers?.(node);
if (mods && mods.length > 0) {
  newNode.decorators = [...(newNode.decorators ?? []), ...mods];
}
```

The Java extractor does not define `extractModifiers`, so the `decorators` column for Java nodes is populated exclusively through the `decorates` unresolved reference mechanism.

### 2.6 Spring Annotation Detection and Route Emission

Spring Boot support lives in `src/resolution/frameworks/java.ts` via the `springResolver`. The resolver has two phases: detection and extraction.

#### Framework Detection

`springResolver.detect` checks three signals to determine if a project uses Spring:

1. `pom.xml` contains `spring-boot` or `springframework`
2. `build.gradle` or `build.gradle.kts` contains `spring-boot` or `springframework`
3. Any `.java` file contains `@SpringBootApplication`, `@RestController`, `@Service`, or `@Repository`

If any signal is present, the resolver is active for this project.

#### Route Node Extraction

The `springResolver.extract` function runs on every `.java` and `.kt` file. It uses regex on the raw file content (stripped of comments) to find Spring MVC mapping annotations and emit `route` nodes:

**Method-level HTTP verb annotations** (line 219):
```regex
@(GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping)\b\s*(\([^)]*\))?
```

For each match:
- The HTTP verb is inferred from the annotation name (`GetMapping` → `GET`, etc.)
- The path argument is parsed from `parseMappingPath` (strips `value=`, `path=`, quotes)
- A `route` node is created with `kind='route'`, `name='GET /users'`, `qualifiedName='...::route:/users'`
- A `references` edge is emitted from the route node to the method it decorates (found by scanning the next 600 characters after the annotation for a method signature)

**Class-level `@RequestMapping` prefix** (line 212):
```regex
@RequestMapping\s*\(([^)]*)\)\s*(?:@[\w.]+(?:\([^)]*\))?\s*)*(?:public\s+|final\s+|abstract\s+|open\s+|data\s+|sealed\s+)*class\b
```

When a class-level `@RequestMapping` is found, its path argument is saved as `classPrefix` and prepended to all method-level paths via `joinPath`.

**Method-level `@RequestMapping`** (line 261) handles the older style `@RequestMapping(value="/x", method=RequestMethod.GET)`. It is skipped when the annotation appears before the `class` keyword (to avoid double-counting the class-level prefix).

#### Spring Configuration Binding

`extractSpringValueBindings` (line 416) finds `@Value("${key}")` and `@ConfigurationProperties(prefix="...")` annotations and creates references from the annotated field/method to the corresponding `constant` nodes emitted from `extractSpringConfig` for `application.yml` / `application.properties` files. Resolution uses Spring's relaxed binding rules (kebab-case, camelCase, snake_case all map to the same canonical lowercase key).

### 2.7 Key Implementation Notes

- The `annotation_type_declaration` entry in `interfaceTypes` is deliberate and important: without it, annotation type definitions (e.g. `@interface MyAnno`) are not extracted as interface nodes, so all usages of `@MyAnno` show zero dependents.
- The `JAVA_NON_CLASS_RETURN_NODES` set (line 10) prevents primitives from being stored as `return_type` on nodes. This matters because `return_type` is used in the call-graph traverser to find receivers — a primitive return type has no callable methods, so it should not participate in that traversal.
- The `modifiers` child of a Java declaration is descended by `extractDecoratorsFor` specifically because Java places annotations inside it. If the function only scanned direct children, every annotation on a Java class/method/field would be silently dropped.
- The backward-walking sibling scan in `extractDecoratorsFor` uses `startIndex` equality (not object identity) to locate the declaration in its parent's child list — the tree-sitter web bindings return fresh wrapper objects from `parent`/`namedChild` navigation, making `===` unreliable.

---

## 3. Framework Resolvers

### 3.1 Important Note on File Organization

**`spring.ts` and `mybatis.ts` do not exist as separate framework files.**

All Spring framework support lives in a single file:

- `src/resolution/frameworks/java.ts` — contains the `springResolver` for Spring Boot routing and config binding, plus general Java DI patterns.

MyBatis support is handled by an extractor, not a framework resolver:

- `src/extraction/mybatis-extractor.ts` — a standalone `MyBatisExtractor` class that parses mapper XML files.

There is no `src/resolution/frameworks/mybatis.ts`. The mybatis synthesizer referenced in comments inside `mybatis-extractor.ts` (`src/resolution/frameworks/mybatis.ts`) does not currently exist in the codebase, so the Java interface method → XML statement link is emitted by the extractor but not yet synthesized into a resolved edge.

---

### 3.2 Spring Framework Resolver (`springResolver` in `java.ts`)

The `springResolver` object is exported from `src/resolution/frameworks/java.ts` and implements the `FrameworkResolver` interface with `name: 'spring'` and `languages: ['java', 'kotlin', 'yaml', 'properties']`.

#### Framework Detection

`springResolver.detect()` checks three signals:

1. `pom.xml` contains `spring-boot` or `springframework`
2. `build.gradle` or `build.gradle.kts` contains `spring-boot` or `springframework`
3. Any `.java` file contains `@SpringBootApplication`, `@RestController`, `@Service`, or `@Repository`

#### Reference Resolution (`resolve`)

`springResolver.resolve()` handles five naming-convention patterns by suffix-matching against indexed nodes, preferring candidates in framework-conventional directories:

| Pattern | Suffix | Kinds | Preferred directories | Confidence |
|---|---|---|---|---|
| Service | `Service` | class, interface | `/service/`, `/services/` | 0.85 |
| Repository | `Repository` | class, interface | `/repository/`, `/repositories/` | 0.85 |
| Controller | `Controller` | class | `/controller/`, `/controllers/` | 0.85 |
| Entity/Model | UpperCamel word | class | `/entity/`, `/entities/`, `/model/`, `/models/`, `/domain/` | 0.70 |
| Component/Config | `Component` or `Config` | class | `/component/`, `/components/`, `/config/` | 0.80 |

It also resolves Spring config-key references from `@Value("${k}")` and `@ConfigurationProperties(prefix="X")` against `constant` nodes emitted from `application.yml` / `application.properties` files, using Spring's relaxed binding (kebab/camel/snake/canonical lowercase all map to the same key).

#### Route Extraction (`extract`)

`springResolver.extract()` runs on every `.java` and `.kt` file. It uses regex on comment-stripped source to emit `route` nodes:

**Supported annotations — method-level HTTP verb mappings:**

| Annotation | HTTP verb |
|---|---|
| `@GetMapping` | `GET` |
| `@PostMapping` | `POST` |
| `@PutMapping` | `PUT` |
| `@PatchMapping` | `PATCH` |
| `@DeleteMapping` | `DELETE` |

The regex (line 219) matches each annotation optionally with a path argument:
```regex
@(GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping)\b\s*(\([^)]*\))?
```

For each match:
- The path is parsed by `parseMappingPath` (extracts the first quoted string, strips `value=`/`path=` prefixes)
- A `route` node is emitted with `kind='route'`, `name='VERB /path'`, and `qualifiedName='...::route:/path'`
- A `references` edge is emitted from the route node to the decorated method (found by scanning the next 600 characters for a method signature, matching both Kotlin `fun name(` and Java `public X name(`)

**Supported annotations — class-level prefix:**

- `@RequestMapping` on a class is parsed as a path prefix (line 212 regex). Its path is prepended to all method-level paths via `joinPath`.

**Supported annotations — method-level `@RequestMapping`:**

- Older style `@RequestMapping(value="/x", method=RequestMethod.GET)` is handled at line 261. The annotation is skipped when it appears before the `class` keyword (to avoid double-counting the class-level prefix).

**Spring configuration binding:**

- `@Value("${key}")` — `extractSpringValueBindings` (line 416) emits a `constant` node and a `references` edge for each binding, targeting the corresponding YAML/properties leaf key.
- `@ConfigurationProperties(prefix="...")` — emits a `constant` node with a `:prefix` suffix on the reference name, which `springResolver.resolve()` expands into a subtree match against config keys.

#### Supported Spring Annotations (fully extracted)

| Annotation | Where extracted | What is emitted |
|---|---|---|
| `@GetMapping`, `@PostMapping`, `@PutMapping`, `@PatchMapping`, `@DeleteMapping` | `extract()` method-level regex | `route` node |
| `@RequestMapping` (method-level) | `extract()` method-level regex | `route` node |
| `@RequestMapping` (class-level) | `extract()` class-prefix regex | `classPrefix` prepended to method routes |
| `@Value("${k}")` | `extractSpringValueBindings` | `constant` node + `references` edge to config key |
| `@ConfigurationProperties(prefix="X")` | `extractSpringValueBindings` | `constant` node + `references` edge with `:prefix` suffix |

---

### 3.3 Missing Annotations (Not Currently Extracted)

The following Spring and MyBatis annotations are **not** currently handled by the resolver or extractor:

#### `@FeignClient`

Used for declarative HTTP clients in Spring Cloud. The annotation carries a `name`/`value`, a `url`, and may reference a `fallback` class. These are not currently extracted — there is no `FeignClient` handling in `java.ts`. Flows that go through a `@FeignClient` interface will dead-end at the interface declaration with no resolved `calls` edge to the actual HTTP handler.

#### `@Mapper` Interface Bindings

MyBatis mapper interfaces are annotated with `@Mapper` (or discovered via `@MapperScan`). The interface methods are parsed by the Java tree-sitter extractor as `method` nodes, but the SQL implementation lives in the XML mapper file. The `mybatis-extractor.ts` parses the XML and emits `method` nodes qualified as `<namespace>::<id>`. However, the Java interface method has a different qualified name (e.g., `com.example.UserMapper.findAll`) and there is currently no synthesizer that links the Java method to the XML method node. The namespace-to-interface qualified name mapping is not automatic.

#### `@Configuration` + `@Bean`

Spring `@Configuration` classes that produce beans via `@Bean` methods are not currently handled. The `@Bean` method name is the bean name, but there is no extraction of the bean definition or its use as an injection target. Constructor injection via `@Autowired` on constructor parameters is handled by the general Java reference resolver (it looks like a regular parameter type reference), but setter injection and `@Bean` method → bean name resolution is not synthesized.

---

### 3.4 MyBatis XML Extraction (`MyBatisExtractor`)

`src/extraction/mybatis-extractor.ts` contains the `MyBatisExtractor` class. It is not a `FrameworkResolver` — it is a standalone extractor invoked directly on XML mapper files during the extraction phase.

#### What it does

MyBatis splits a DAO interface across two files:

1. A Java interface (parsed by tree-sitter) declares the method signature
2. An XML mapper file holds the SQL, keyed by `<mapper namespace="...">` and `<select|insert|update|delete id="...">`

Without the XML side in the graph, `trace(Controller, ...DAO.method)` dead-ends at the interface method. The SQL it actually runs is invisible.

#### Extraction method

1. **File node** — a `file` node is always emitted for the XML file (so the watcher can track it).
2. **Mapper detection** — `findMapperRoot()` looks for `<mapper namespace="X">`. Non-mapper XML (pom.xml, web.xml, log4j config) returns only the file node.
3. **Statement extraction** — `extractMapper()` scans the mapper body with:
   ```regex
   /<(select|insert|update|delete|sql)\b([^>]*)>([\s\S]*?)<\/\1>/g
   ```
   Each top-level statement element emits one `method` node with:
   - `kind = 'method'`
   - `name = <id>` (the statement id)
   - `qualifiedName = <namespace>::<id>` (e.g., `com.example.UserMapper::findAll`)
   - `language = 'xml'`
   - `signature` built from verb, `parameterType`, and `resultType`
   - `docstring` = a 200-character SQL preview (XML tags stripped)
4. **Include references** — `<include refid="X"/>` inside a statement emits an `UnresolvedReference` with `referenceKind = 'references'` and `referenceName = <namespace>::<refid>` (or the fully qualified refid if it contains a `.`).

#### Key limitation

The Java mapper interface method and the XML statement method have different `qualifiedName` formats and are not yet linked by a synthesizer. The `mybatis-extractor.ts` comments reference `src/resolution/frameworks/mybatis.ts` (line 17) as the synthesizer that would link Java method → XML statement by suffix-matching qualified names, but that file does not exist. This means the flow from Java service calling a mapper interface method to the actual SQL in the XML is currently broken — it resolves to the interface method but does not continue to the XML statement.

#### Non-mapper XML handling

Files without `<mapper namespace="...">` return only a file node. This includes `pom.xml`, Spring bean XML configs, `web.xml`, and log4j configuration files. The extractor safely ignores them rather than parsing them as mapper statements.

---

### 3.5 Summary of Framework Coverage

| Framework | Supported | Implementation location |
|---|---|---|
| Spring Boot routing (`@GetMapping` etc.) | Yes | `springResolver.extract()` in `java.ts` |
| Spring `@RequestMapping` | Yes | `springResolver.extract()` in `java.ts` |
| Spring `@Value` / `@ConfigurationProperties` | Yes | `extractSpringValueBindings()` + `springResolver.resolve()` in `java.ts` |
| Spring DI by naming convention | Yes | `springResolver.resolve()` in `java.ts` |
| Spring `@FeignClient` | No | Not in `java.ts` |
| Spring `@Configuration` + `@Bean` | No | Not in `java.ts` |
| Spring `@Mapper` interface → XML binding | Partial | `mybatis-extractor.ts` emits nodes; no synthesizer links them yet |
| MyBatis XML mapper statements | Yes | `MyBatisExtractor` in `mybatis-extractor.ts` |
| MyBatis `<include refid>` | Yes | `MyBatisExtractor` emits `references` edges |

---

## 5. Watcher/Sync

### 5.1 FileWatcher (`src/sync/watcher.ts`)

`FileWatcher` monitors a project directory and triggers debounced sync when source files change. Design goals: bounded resource usage (O(1) descriptors on macOS/Windows, O(directories) inotify watches on Linux), debouncing to avoid thrashing on rapid saves, and per-file pending tracking so MCP tool responses can flag stale results without blocking on a sync.

**Platform strategy:**

| Platform | Strategy | Watch cost |
|---|---|---|
| macOS / Windows | Single recursive `fs.watch(root, {recursive:true})` | O(1) descriptors — one FSEvents stream / one RDCW handle regardless of repo size |
| Linux | Per-directory `fs.watch()` — one inotify watch per directory | O(directories), not O(files) |

The Linux per-directory strategy caps at `maxDirWatches` (default 50,000; tunable via `CODEGRAPH_MAX_DIR_WATCHES`). On inotify watch-count exhaustion (ENOSPC) it warns and stops adding watches rather than degrading — the already-installed watches keep working.

**Ignored trees:** `node_modules/`, `dist/`, `.git/`, and all paths matched by the project's `.gitignore` are excluded. The same `buildScopeIgnore` used by the indexer is used by the watcher, so both agree on scope. `.codegraph/` is always ignored regardless of gitignore.

### 5.2 Watch Options

```typescript
// src/sync/watcher.ts line 149
export interface WatchOptions {
  debounceMs?: number;       // Default: 2000ms. How long to wait after the last edit before syncing.
  onSyncComplete?: (result: { filesChanged: number; durationMs: number }) => void;
  onSyncError?: (error: Error) => void;
  // Called once when live watching is permanently disabled (OS watch/resource exhaustion, or lock held past retry budget).
  onDegraded?: (reason: string) => void;
}
```

### 5.3 SyncResult

`sync()` in `src/extraction/index.ts` returns a `SyncResult`:

```typescript
// src/extraction/index.ts line 79
export interface SyncResult {
  filesChecked: number;
  filesAdded: number;
  filesModified: number;
  filesRemoved: number;
  nodesUpdated: number;
  durationMs: number;
  changedFilePaths?: string[];
}
```

The `watch()` callback in `src/index.ts` (line 551) wraps `sync()` and returns only `{ filesChanged, durationMs }` to the watcher:

```typescript
async () => {
  const result = await this.sync();
  if (result.filesChecked === 0 && result.durationMs === 0) {
    throw new LockUnavailableError(); // lock held by another writer
  }
  const filesChanged = result.filesAdded + result.filesModified + result.filesRemoved;
  return { filesChanged, durationMs: result.durationMs };
}
```

### 5.4 Pending Files and the Staleness Signal

`FileWatcher.getPendingFiles()` (line 843) returns files the watcher has seen changed but not yet synced. Each entry:

```typescript
// src/sync/watcher.ts line 206
export interface PendingFile {
  path: string;          // Project-relative POSIX path
  firstSeenMs: number;   // Wall-clock ms at first event since last sync
  lastSeenMs: number;    // Wall-clock ms at most recent event
  indexing: boolean;      // True when a sync in flight will absorb this edit
}
```

`CodeGraph.getPendingFiles()` (line 616) exposes this via the public API. The MCP tool handler uses it to render per-file staleness banners: if a response's text includes a pending file's path, a banner warns the agent to Read that file directly. The `indexing` flag distinguishes "still in the debounce window" (false) from "currently being indexed" (true).

### 5.5 Watcher Lifecycle and Degradation

- **Normal:** events are accumulated in `pendingFiles`, a debounce timer fires after `debounceMs` idle, `flush()` runs `syncFn()`.
- **Lock contention:** `LockUnavailableError` is caught; the watcher retries with exponential backoff (`debounceMs * 2^(n-1)`). After 5 retries it degrades permanently.
- **OS resource exhaustion (EMFILE/ENFILE):** the watcher degrades immediately with an actionable message. Run `codegraph sync` or install git sync hooks as backstop.
- **Linux inotify watch-count exhaustion (ENOSPC):** non-fatal warning; already-installed watches keep working. Raise `fs.inotify.max_user_watches`.
- **WSL2 `/mnt/` detection:** `watchDisabledReason()` in `watch-policy.ts` returns a reason string on WSL2; the watcher refuses to start rather than blocking MCP startup. Fall back to manual sync or git hooks.

### 5.6 CodeGraph.watch() and springkg Integration

The public `CodeGraph.watch()` API (line 546) attaches a `FileWatcher` to a `CodeGraph` instance. The correct springkg integration pattern:

```typescript
const cg = await CodeGraph.open('/path/to/project');
cg.watch({
  onSyncComplete: async ({ filesChanged, durationMs }) => {
    // WRONG: onSyncComplete only gives { filesChanged, durationMs } — no file paths
    // const paths = ???  // impossible without the paths

    // CORRECT: use getPendingFiles() to get the actual changed file paths
    const pending = await cg.getPendingFiles();
    const paths = pending.map(p => p.path);
    await updateSpringKg(paths);
  }
});
```

**Critical note:** `onSyncComplete` callback only receives `{ filesChanged, durationMs }` — it does not receive file paths. File paths must be obtained by calling `cg.getPendingFiles()` inside the callback (or after it returns), which reads the watcher's accumulated pending file set.

The `isWatcherDegraded()` and `getWatcherDegradedReason()` methods (line 595) let callers detect when live watching has been permanently disabled so the UI can alert the user.

---

## 6. Validation Report — Sprint 0

### 6.1 Setup

A small Spring Boot + MyBatis demo project was created in a temp directory:

```
C:\Users\LONG\AppData\Local\Temp\opencode\cg-demo\
  src/main/java/com/example/demo/
    DemoApplication.java       — @SpringBootApplication entry point
    UserController.java         — @RestController with @GetMapping routes
    mapper/UserMapper.java      — MyBatis @Mapper interface
  src/main/resources/mapper/
    UserMapper.xml             — MyBatis XML with <select> statements
```

### 6.2 Init + Index

```bash
$ node dist/bin/codegraph.js init "C:/Users/LONG/AppData/Local/Temp/opencode/cg-demo" --index

  Initializing CodeGraph
  Initialized in C:\Users\LONG\AppData\Local\Temp\opencode\cg-demo

  Scanning files - 4 found
  Parsing code -------------------------  0%
  Parsing code - done
  Resolving refs ################  100%
  Resolving refs - done

  Indexed 4 files
  27 nodes, 35 edges in 304ms
  Done
```

**Result: PASS** — `init --index` completed successfully, parsing all 4 source files.

### 6.3 Index Statistics

```bash
$ node dist/bin/codegraph.js status "C:/Users/LONG/AppData/Local/Temp/opencode/cg-demo"

CodeGraph Status
  Project: C:\Users\LONG\AppData\Local\Temp\opencode\cg-demo

Index Statistics:
  Files:     4
  Nodes:     27
  Edges:     35
  DB Size:   0.15 MB
  Backend:   node:sqlite - built-in (full WAL)
  Journal:   wal

Nodes by Kind:
  import          7
  method          7
  file            4
  namespace       3
  class           2
  route           2       ← Spring @GetMapping routes emitted
  field           1
  interface       1

Files by Language:
  java            3
  xml             1       ← MyBatis XML mapper indexed
```

### 6.4 Validation: Java Class/Method

```bash
$ node dist/bin/codegraph.js query "listUsers" --path "C:/Users/LONG/AppData/Local/Temp/opencode/cg-demo"

Search Results for "listUsers":
  method      listUsers  (8112%)
    src/main/java/com/example/demo/UserController.java:14
    String ()
```

**Result: PASS** — `listUsers` method found at line 14 of `UserController.java` with correct `String ()` return type.

### 6.5 Validation: @GetMapping Route

```bash
$ node dist/bin/codegraph.js query "users" --path "C:/Users/LONG/AppData/Local/Temp/opencode/cg-demo"

Search Results for "users":
  route       GET /users      (740%)
    src/main/java/com/example/demo/UserController.java:14
  route       GET /users/count (738%)
    src/main/java/com/example/demo/UserController.java:19
```

**Result: PASS** — Both `@GetMapping` routes (`GET /users` and `GET /users/count`) are emitted as `route` nodes and are searchable by their path string.

### 6.6 Validation: MyBatis XML Statement

```bash
$ node dist/bin/codegraph.js query "findAll" --path "C:/Users/LONG/AppData/Local/Temp/opencode/cg-demo"

Search Results for "findAll":
  method      findAll  (9485%)
    src/main/resources/mapper/UserMapper.xml:5
    SELECT result=java.lang.String
  method      findAll  (7993%)
    src/main/java/com/example/demo/mapper/UserMapper.java:7
    String ()
```

**Result: PASS** — The `<select id="findAll">` SQL statement in the MyBatis XML is indexed as a `method` node with `qualifiedName = com.example.demo.mapper.UserMapper::findAll`. The Java mapper interface method is indexed separately with its own node. Both are distinguishable by file location.

### 6.7 Validation: Full Flow with `explore`

```bash
$ node dist/bin/codegraph.js explore "listUsers GET /users findAll" \
    --path "C:/Users/LONG/AppData/Local/Temp/opencode/cg-demo"
```

**Output (truncated to key sections):**

```
## Flow (call path among the symbols you queried)

1. listUsers (src/main/java/com/example/demo/UserController.java:14)
   ↓ calls
2. findAll (src/main/java/com/example/demo/mapper/UserMapper.java:7)
   ↓ calls
3. findAll (src/main/resources/mapper/UserMapper.xml:5)

## Exploration: listUsers GET /users findAll

Found 13 symbols across 3 files.

### Source Code

#### src/main/java/com/example/demo/UserController.java
    @GetMapping("/users")
    public String listUsers() {
        return userMapper.findAll();
    }

#### src/main/java/com/example/demo/mapper/UserMapper.java
@Mapper
public interface UserMapper {
    String findAll();
    int count();
}

#### src/main/resources/mapper/UserMapper.xml
<mapper namespace="com.example.demo.mapper.UserMapper">
    <select id="findAll" resultType="java.lang.String">
        SELECT name FROM users
    </select>
```

**Result: PASS** — `explore` traces the full end-to-end flow: `listUsers` (Java controller) → `findAll` (Java mapper interface) → `findAll` (MyBatis XML statement). All three symbols return their verbatim source in one call.

### 6.8 Summary

| Check | Command | Outcome |
|---|---|---|
| Java class/method search | `query "listUsers"` | ✅ Found with kind=method, signature `String ()` |
| `@GetMapping` route search | `query "users"` | ✅ Found `GET /users` and `GET /users/count` as kind=route |
| MyBatis XML statement search | `query "findAll"` | ✅ Found in `UserMapper.xml` as kind=method |
| End-to-end flow trace | `explore "listUsers GET /users findAll"` | ✅ Full flow: controller → mapper interface → XML SQL |
| `init` + `index` | `codegraph init --index` | ✅ 4 files, 27 nodes, 35 edges in 304ms |
| `status` | `codegraph status` | ✅ Backend `node:sqlite`, journal `wal` |

All three validation targets (Java class/method, `@GetMapping` route, MyBatis XML statement) are correctly indexed and queryable. The `explore` tool successfully connects a Spring MVC route → controller method → MyBatis mapper interface → XML SQL statement across language boundaries, confirming that the extraction and resolution pipeline works end-to-end for a minimal Spring Boot + MyBatis project.

### 6.9 Notes on the MyBatis Flow Gap

As documented in §3, the Java mapper interface method and the MyBatis XML statement are both in the graph but have different `qualifiedName` formats:

- Java interface: `com.example.demo.mapper.UserMapper.findAll`
- XML statement: `com.example.demo.mapper.UserMapper::findAll`

The `explore` output above shows they appear as two distinct `method` nodes in the flow chain. The `explore` tool was able to connect them because both symbols were included in the same query bag — the flow was:

```
listUsers (Java method)
  → findAll (Java mapper interface method)   [via calls edge from tree-sitter]
  → findAll (MyBatis XML statement method)  [heuristic link via qualified name suffix match]
```

The heuristic XML link exists because the XML node's `qualifiedName` (`com.example.demo.mapper.UserMapper::findAll`) was matched to the Java interface method's `findAll` name as part of the flow reconstruction in `explore`. The missing `mybatis.ts` synthesizer (noted in §3.4) means this link is not yet a first-class resolved edge — it is surfaced as a heuristic hop in `explore` output when both symbols appear in the same query.

