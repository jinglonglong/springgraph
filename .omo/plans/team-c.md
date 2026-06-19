# Team C — Data Access / MyBatis / SQL

> **Status**: Ready to start (blocked on Team A Phase 1 completion)
> **Owns**: `packages/springkg-data/src/**` + `packages/springkg-data/__tests__/**`
> **Worktree branch**: `team-c-data`
> **Goal**: Extract MyBatis XML / annotation SQL, resolve table+column references, bind Mapper interfaces to XML statements, recognize MyBatis-Plus and JPA entity → table mappings. The output of this team unblocks the `spring_find_mapper` and the data-access tail of `spring_trace_flow` MCP tools in Team E (Sprint 2).

---

## 1. Team Overview

Team C owns the **data access** slice of the SpringCloud knowledge graph. Once Team A's `SpringKg` class and `springkg.db` schema are stable (Phase 1 done), Team C ships 7 resolvers/extractors that together produce a complete **Endpoint → Controller → Service → Mapper interface → XML statement → SQL → Table/Column** traversal graph.

**Why this team is on the critical path of Sprint 2**: `spring_find_mapper` (Team E T33) and the data-access extension of `spring_trace_flow` (Team E T34) both consume nodes/edges that only Team C writes (`mapper`, `mapper_method`, `sql_statement`, `entity`, `table`, `column` and the `EXECUTES_SQL` / `READS_TABLE` / `WRITES_TABLE` / `MAPS_TO_TABLE` / `BIND_TO` / `MAPS_FIELD` / `USES_COLUMN` edges). Without T25–T30 done, those two tools can only emit `controller → service → mapper_method` and then dead-end at the SQL.

**Reference implementation to study first**: `src/extraction/mybatis-extractor.ts` (the upstream CodeGraph MyBatis extractor) — Team C's `MyBatisXmlExtractor` (T25) **enhances and re-encodes** the upstream behavior, not duplicates it; the new version also emits `sql_statement` rows in `spring_sql_statements` and uses the new `mapper_method` kind in `spring_symbols`. Read it before writing T25.

**Design doc anchors**: `资料/CodeGraph-SpringCloud_VibeCoding_实施方案.md` §6.1 P0 #4 (MyBatis/SQL parsing must-haves), §6.1 P0 #2 (JPA), §13.5 (binding prompt), §4 (entity / relation list with `MyBatisXmlStatement` / `SQLStatement` / `Table` / `Column` / `Entity`).

---

## 2. Owned Files (exclusive)

```
packages/springkg-data/
├── package.json                              # created in T25 scaffold
├── tsconfig.json                             # created in T25 scaffold
├── vitest.config.ts                          # created in T25 scaffold
├── src/
│   ├── index.ts                              # T25 — barrel exports
│   ├── mybatis-xml-extractor.ts              # T25
│   ├── annotation-sql-extractor.ts           # T26
│   ├── sql-table-column.ts                   # T27
│   ├── writer.ts                             # T28
│   ├── mapper-binding-resolver.ts            # T29
│   ├── mybatis-plus-resolver.ts              # T30
│   └── jpa-entity-resolver.ts                # T31
└── __tests__/
    ├── mybatis-xml-extractor.test.ts         # T25 (5 cases)
    ├── annotation-sql-extractor.test.ts      # T26 (4 cases)
    ├── sql-table-column.test.ts              # T27 (5 cases)
    ├── writer.test.ts                        # T28 (3 cases)
    ├── mapper-binding-resolver.test.ts       # T29 (3 cases)
    ├── mybatis-plus-resolver.test.ts         # T30 (3 cases)
    └── jpa-entity-resolver.test.ts           # T31 (2 cases)
```

**Hard rule**: Team C **does not** modify `packages/springkg-core/`, `packages/springkg-shared/`, any other team package, `src/` (upstream CodeGraph), `package.json` workspace root, or `tsconfig.json` workspace root. The migration file Team C needs (`002_*.sql` for `spring_tables` / `spring_columns`) is **written to `packages/springkg-data/src/db/migrations/002_spring_tables_and_columns.sql`**, and Team C **submits a request to Team A** (via the `docs/team-coordination.md` channel that Team G maintains) to add it to Team A's migration runner — Team C does not touch the migration runner itself.

If T25-T30 need an extra column added to the existing `spring_sql_statements` table (defined by Team A), Team C **submits a schema-amendment request** to Team A in `docs/team-coordination.md`. Team A owns the schema; Team C only consumes it. Default design: `spring_sql_statements` already has `id / mapper_namespace / statement_id / operation / sql_preview / xml_path / metadata_json` (per design doc §5), and T25 fills those columns. T28 adds two **new** tables (`spring_tables`, `spring_columns`) — these *do* require a `002_*.sql` migration.

---

## 3. Cross-team Contracts

### 3.1 Input (from Team A)

| Contract | Where it lives | What Team C reads |
|---|---|---|
| `SpringKg` class | `packages/springkg-core/src/spring-kg.ts` | `SpringKg.enhance(input)` (or per-resolver registration API) — invoked by the watcher sync callback after CodeGraph's main index passes |
| `springkg.db` schema | `packages/springkg-core/src/db/schema.sql` | Read `spring_symbols` (existing rows from CodeGraph: `function` / `method` kinds = Java methods; `file` = .java / .xml files) to resolve Mapper interfaces and their method nodes |
| `spring_symbols` row shape | Team A shared types | `(id, kind, name, qualified_name, file_path, signature, start_line, end_line, decorators_json, metadata_json, codegraph_node_id, confidence)` |
| `spring_edges` row shape | Team A shared types | `(id, source_id, target_id, kind, metadata_json, confidence, provenance)` |
| `SPRINGKG_CONFIG` | `packages/springkg-shared/src/config.ts` | `sensitiveKeyPatterns` (not used by Team C — listed for completeness; Team D uses it) |
| `Resolver` interface | `packages/springkg-shared/src/index.ts` | `name: string` + `enhance(input: SpringKgEnhanceInput): Promise<SpringKgEnhanceOutput>` — Team C's 7 modules each implement a class with this shape and get registered in the `SpringKg.enhancers` array |

### 3.2 Output (consumed by Team E `spring_find_mapper` T33 + `spring_trace_flow` extension T34)

**Append-only to `springkg.db`**. Team C owns these NodeKinds and EdgeKinds (per the main plan's append-only-by-kind table):

| Kind | Type | Tables | Producers |
|---|---|---|---|
| `mapper` | node | `spring_symbols` | T29 (from `@Mapper` interface file nodes already in graph) |
| `mapper_method` | node | `spring_symbols` | T25 (XML), T26 (annotations), T29 (interface method) |
| `sql_statement` | node | `spring_symbols` | T25, T26 (one per `<select>` / `<insert>` / etc. and per `@Select` method) |
| `entity` | node | `spring_symbols` | T30 (MyBatis-Plus), T31 (JPA) |
| `table` | node | `spring_symbols` | T27 (one per unique table name discovered) |
| `column` | node | `spring_symbols` | T27 (one per unique column referenced) |

| Kind | Type | Tables | Producers |
|---|---|---|---|
| `EXECUTES_SQL` | edge | `spring_edges` | T25, T26, T29 (`mapper_method` → `sql_statement`) |
| `READS_TABLE` | edge | `spring_edges` | T27 (sql_statement → table) |
| `WRITES_TABLE` | edge | `spring_edges` | T27 (sql_statement → table) |
| `USES_COLUMN` | edge | `spring_edges` | T27 (sql_statement → column) |
| `MAPS_TO_TABLE` | edge | `spring_edges` | T30, T31 (entity → table) |
| `MAPS_FIELD` | edge | `spring_edges` | T30, T31 (entity-field → column — reuses `codegraph_node_id` for the Java field) |
| `BIND_TO` | edge | `spring_edges` | T29 (mapper interface method → xml statement — links the two ends of the binding) |

**Read-side for Team E (T33/T34)**:
- `spring_find_mapper` filters `spring_symbols` by `kind='mapper_method'`, returns row + joined `spring_sql_statements` + joined `table`/`column` nodes via `EXECUTES_SQL` / `READS_TABLE` / `WRITES_TABLE` / `USES_COLUMN` edges.
- `spring_trace_flow` (data-access extension) follows the chain `controller_method → service_method → mapper_method → sql_statement → table` using existing `CALLS` edges (from Team B) + Team C's `EXECUTES_SQL` / `READS_TABLE` / `WRITES_TABLE`.

**Important constraint — ID stability**: All node IDs in `spring_symbols` are `${kind}:${sha256truncated_32chars}`. Team C **must** use `generateNodeId()` (re-exported from `packages/springkg-shared/src/index.ts` by Team A). Hand-rolled IDs are forbidden — they break `CALLS` edge resolution (Team B writes edges with `source_id` / `target_id` derived from the same hash).

---

## 4. Task List

> **TDD**: write the test file first (RED), confirm it fails, then implement the module (GREEN). Every test file lives next to the code in `packages/springkg-data/__tests__/`. Every implementation file is < 250 LOC where possible — if a module grows past that, split it inside Team C's owned area (e.g. T25's dynamic-SQL expansion can be a private helper file in `packages/springkg-data/src/internal/`).
>
> **Format note**: this plan uses bare-number format `- [ ] N. [C] title` per the project convention; do **not** rename to `TN.`, `Phase N:`, or `Task-N.`.

### Implementation tasks (Team C scope, 7 total)

- [ ] 1. [C] **T25 — `packages/springkg-data/src/mybatis-xml-extractor.ts`: MyBatisXmlExtractor (enhance upstream)**
  - **Read first**: `src/extraction/mybatis-extractor.ts` (upstream CodeGraph, ~200 LOC) — note the existing regex-based scan, the `kind: 'method'` emission for each `<select|insert|update|delete|sql>`, and the `<include refid>` reference emission.
  - **Outputs**:
    - `spring_symbols` rows with `kind = 'mapper_method'` (one per `<select|insert|update|delete>`, qualified as `<namespace>::<id>` — matches the upstream qualified-name format so `CALLS` edge resolution from Team B continues to work) and `kind = 'sql_statement'` (one per `<select|insert|update|delete>` with `decorators_json` carrying the `<resultMap>` / `<parameterMap>` / `resultType` / `parameterType` attribute values; `signature` = `SELECT param=X result=Y`).
    - `spring_sql_statements` rows: `(id = generateNodeId(filePath,'sql_statement',namespace+'::'+id,startLine)`, `mapper_namespace`, `statement_id`, `operation = SELECT|INSERT|UPDATE|DELETE`, `sql_preview` = first 200 chars of the SQL with XML tags stripped and whitespace collapsed, `xml_path` = relative file path, `metadata_json` = JSON of any extracted `<bind>` / dynamic-tag counts).
    - `spring_edges`: `EXECUTES_SQL` from the `mapper_method` node (matching the upstream `kind: 'method'` node by qualified name) to the `sql_statement` node. (`codegraph_node_id` on the new `sql_statement` row points at the upstream `method` node for cross-team edge resolution.)
  - **Enhancements over upstream** (5 cases must pass):
    1. **`<include refid="X">` recursive expansion** — build a `refid → fragment body` map for the same mapper first (or a transitive-import map for `ns.X` form), substitute fragments **before** scanning, so a `<select>` that uses `<include refid="columns"/>` produces a `sql_preview` that already contains the columns. Detect cycles (refid that resolves to itself, directly or transitively) and mark the statement `metadata_json.confidence = 0.7` with a `dynamic_cycle` reason.
    2. **`<resultMap>` / `<association>` / `<collection>`** — when a `<select resultMap="X">` references a `<resultMap id="X">`, attach the resultMap's `<id property="…" column="…"/>` and `<result property="…" column="…"/>` children to the `sql_statement.metadata_json.resultMap` as `{ property, column, jdbcType }` rows. Top-level `<resultMap>` (no parent statement) becomes a `mapper_method` row with `kind = 'sql_statement'`, `operation = 'RESULT_MAP'` (synthetic — not a real SQL op but marks the row in the graph).
    3. **Dynamic SQL (`<if>`, `<choose>`/`<when>`/`<otherwise>`, `<foreach>`, `<where>`, `<set>`, `<trim>`, `<bind>`)** — strip the tag wrapper when stripping tags for `sql_preview`, but count occurrences and stash in `metadata_json.dynamicTags = { if: 3, foreach: 1, … }` and bump `confidence` down: 0.9 with no dynamic, 0.8 with `<where>`/`<set>` only, 0.7 with `<if>`/`<choose>`, 0.6 with `<foreach>` (variable iteration count is a real ambiguity).
    4. **Multi-statement mappers + `<sql>` fragments** — `<sql id="X">` produces a `mapper_method` row with `kind = 'sql_statement'`, `operation = 'FRAGMENT'` (synthetic). The `<include refid="X">` reference becomes a `BIND_TO` edge from the consuming statement to the fragment (kind: 'BIND_TO', per the cross-team table). This is the only edge Team C writes that uses the `BIND_TO` kind from XML side; T29 also writes `BIND_TO` from interface method to XML statement.
    5. **Bad XML / partial file** — wrap extraction in try/catch, push to `errors[]`, return what was extracted so far. `metadata_json.parseError = true` on any affected statement. (This is the safety net; the upstream extractor has the same shape — copy the try/catch pattern.)
  - **Module API**:
    ```typescript
    export class MyBatisXmlExtractor {
      constructor(private readonly filePath: string, private readonly source: string) {}
      extract(): {
        symbols: SpringKgNode[];     // kind: mapper_method | sql_statement
        sqlStatements: SpringSqlStatement[];
        edges: SpringKgEdge[];       // EXECUTES_SQL | BIND_TO (XML-side)
        errors: { message: string; line: number; severity: 'error' | 'warning' }[];
      };
    }
    ```
  - **Scaffold** (also in T25): create `packages/springkg-data/package.json` (name `@springkg/data`, `type: "module"`, deps: none beyond shared), `tsconfig.json` extending workspace root, `vitest.config.ts`, `src/index.ts` (re-exports the 7 modules). Workspace root `package.json` is **not** touched (Team A owns it); instead Team C's `package.json` is **discovered via glob** when Team A's installer runs `npm install` from the workspace root.
  - **Tests** (`__tests__/mybatis-xml-extractor.test.ts`, 5 cases): (1) simple SELECT; (2) include refid in same mapper; (3) nested dynamic SQL with `<if>` + `<foreach>`; (4) `<resultMap>` with `<association>` / `<collection>`; (5) `<sql>` fragment with cycle detection.

- [ ] 2. [C] **T26 — `packages/springkg-data/src/annotation-sql-extractor.ts`: AnnotationSqlExtractor**
  - **Reads** from `springkg.db`: `spring_symbols` rows where `kind = 'method'` AND `decorators_json LIKE '%@Select%'` (or `@Insert` / `@Update` / `@Delete`). The decorators column is already populated by CodeGraph's Java extractor — Team C does **not** re-parse Java source. Cross-team: the `decorators_json` shape is defined in `packages/springkg-shared/src/decorators.ts` by Team A; if a needed key is missing, submit a schema-amendment request via `docs/team-coordination.md` (do not add the key from Team C).
  - **For each matching method**:
    1. Extract the first string-literal argument of the annotation: `["SELECT * FROM user WHERE id = #{id}"]` → `SELECT * FROM user WHERE id = #{id}`. Regex on the decorator string: `@(?:Select|Insert|Update|Delete)\(\s*"([^"]+)"\s*\)`. Handle `value = "…"` form too (the canonical Java form).
    2. Replace `#{paramName}` and `${paramName}` with `?` placeholder (positional for prepared statements, but Team C stores the original form in `metadata_json.originalSql` for round-trip debugging).
    3. Detect operation: leading `select` (case-insensitive, with optional `/* ... */` comments prefix) → SELECT; `insert` → INSERT; `update` → UPDATE; `delete` → DELETE. Default to the annotation name if no match (`@Select` → SELECT).
    4. Write `spring_symbols` row: `kind = 'sql_statement'`, `name = <method-name>`, `qualified_name = <class-fqn>::<method-name>::<AnnotationName>`, `codegraph_node_id` = the existing `method` row's id (so the binding back to the Java method is direct, no extra edge needed for binding — `CALLS` from Team B already covers the call-site resolution).
    5. Write `spring_sql_statements` row: `id` = `generateNodeId(filePath,'sql_statement',qualified,startLine)`, `mapper_namespace` = the containing interface's FQN, `statement_id` = the method name, `operation` = SELECT/INSERT/UPDATE/DELETE, `sql_preview` = first 200 chars, `xml_path` = the source `.java` file path, `metadata_json` = `{ source: 'annotation', annotation: 'Select', paramNames: [...] }`.
    6. Write `spring_edges`: one `EXECUTES_SQL` edge from the existing `method` row (the Java method) to the new `sql_statement` row. The `metadata_json` carries `{ source: 'annotation', annotation: 'Select' }` so Team E can tell annotation-SQL from XML-SQL.
  - **Module API**:
    ```typescript
    export class AnnotationSqlExtractor {
      constructor(private readonly db: SpringKgDb) {}
      extract(): SpringKgEnhanceOutput;  // uses the Resolver contract
    }
    ```
  - **Tests** (`__tests__/annotation-sql-extractor.test.ts`, 4 cases): (1) `@Select("SELECT …")` on a method; (2) `@Insert("INSERT INTO user …")` with multiple `#{param}` placeholders; (3) `@Update` + `@Delete` in the same file (both work in one pass); (4) `value = "…"` form (canonical Java) alongside the bare-string form.

- [ ] 3. [C] **T27 — `packages/springkg-data/src/sql-table-column.ts`: SqlTableColumnExtractor**
  - **Input**: SQL string (from T25's `sql_preview` or the original SQL — T27 accepts either; `sql_preview` is the truncation-safe default).
  - **Output** for the given SQL:
    ```typescript
    export interface SqlTableColumnResult {
      tables: { name: string; access: 'READ' | 'WRITE'; confidence: number; }[];
      columns: { name: string; confidence: number; }[];
      confidence: number;  // overall for this SQL
    }
    ```
  - **Table detection** — case-insensitive scan, **stop at** the first non-keyword token after the verb. Patterns:
    - `FROM <ident>` → READ
    - `<ident> JOIN <ident>` → READ (both sides)
    - `INTO <ident>` (preceded by `INSERT`) → WRITE
    - `UPDATE <ident>` → WRITE
    - `DELETE FROM <ident>` → WRITE
    - `TRUNCATE TABLE <ident>` → WRITE (rare in MyBatis but legal)
    - **Exclude from output** if the ident matches the SQL reserved-word list (`SELECT`, `FROM`, `WHERE`, `JOIN`, `INNER`, `LEFT`, `RIGHT`, `OUTER`, `CROSS`, `ON`, `USING`, `GROUP`, `ORDER`, `BY`, `HAVING`, `LIMIT`, `OFFSET`, `UNION`, `ALL`, `DISTINCT`, `AS`, `SET`, `VALUES`, `INTO`, `UPDATE`, `DELETE`, `TABLE`, `INDEX`, `VIEW`, `DATABASE`, `SCHEMA`, `WHERE`, `AND`, `OR`, `NOT`, `NULL`, `IS`, `IN`, `EXISTS`, `BETWEEN`, `LIKE`, `CASE`, `WHEN`, `THEN`, `ELSE`, `END`, `WITH`, `RECURSIVE`). Build a `Set<string>` of these (case-folded) and skip.
    - **Strip alias**: `users u` → `users`. `users AS u` → `users`. Detect by: after the ident, if the next token is a single identifier that's not a reserved word and not followed by `(`, it's an alias.
    - **Strip schema prefix**: `public.users` → `users`. Detect by a `.` in the ident; take the suffix.
  - **Column detection** — same case-insensitive scan:
    - `INSERT INTO t (col1, col2, col3) VALUES (…)` → columns col1, col2, col3
    - `SELECT col1, col2, t.col3 FROM t` → col1, col2, col3 (strip `t.` prefix when the alias matches a table we already detected)
    - `UPDATE t SET col1 = ?, col2 = ? WHERE …` → col1, col2
    - Skip `*` (no column name to emit). Skip numeric literals.
  - **Confidence marking**:
    - `1.0` if no dynamic SQL was present (callers pass a flag from T25/T26's `metadata_json.dynamicTags` — empty / absent → 1.0)
    - `0.9` with `<where>` / `<set>` only
    - `0.7` with `<if>` / `<choose>` / `<when>` (columns are conditionally present)
    - `0.5` with `<foreach>` (column list is parameterized by iteration — same column repeated N times, but the table detection might be wrong)
    - For T27 standalone tests (no caller), accept an explicit `confidence: number` argument to drive test cases.
  - **Module API**:
    ```typescript
    export class SqlTableColumnExtractor {
      extract(sql: string, opts?: { dynamicTags?: Record<string, number> }): SqlTableColumnResult;
    }
    ```
  - **Tests** (`__tests__/sql-table-column.test.ts`, 5 cases): (1) `SELECT id, name FROM users WHERE id = ?` → tables=[users:READ], columns=[id, name], confidence=1.0; (2) `INSERT INTO orders (user_id, total) VALUES (?, ?)` → tables=[orders:WRITE], columns=[user_id, total]; (3) `UPDATE users SET name = ? WHERE id = ?` → tables=[users:WRITE], columns=[name, id]; (4) `SELECT u.id, u.name FROM users u JOIN orders o ON u.id = o.user_id` → tables=[users:READ, orders:READ], columns=[id, name, user_id] (alias stripped); (5) Dynamic SQL flag → confidence drops to 0.7.

- [ ] 4. [C] **T28 — `packages/springkg-data/src/writer.ts`: SQL writer**
  - **Receives** a stream of tuples from T25, T26, T27: `{ sqlStatement, tables, columns, mapperMethodId, xmlPath?, filePath? }`. The `mapperMethodId` is the existing `spring_symbols.id` of the `mapper_method` (XML) or `method` (annotation) row that produces the SQL.
  - **Writes** (all in one transaction per call):
    1. `INSERT OR REPLACE INTO spring_symbols (id, kind, name, qualified_name, file_path, signature, start_line, end_line, decorators_json, metadata_json, codegraph_node_id, confidence) VALUES (...)` — one row per table name discovered (kind = 'table'), one row per column (kind = 'column'). Reuse `generateNodeId(filePath, 'table', tableName, 0)` and `generateNodeId(filePath, 'column', tableName + '.' + columnName, 0)`. `codegraph_node_id` is `null` (these are SQL-derived, not AST-derived). `confidence` comes from T27.
    2. `INSERT OR REPLACE INTO spring_sql_statements (...)` — one row per input tuple.
    3. `INSERT OR REPLACE INTO spring_edges (id, source_id, target_id, kind, metadata_json, confidence, provenance) VALUES (...)` — for each table: `READS_TABLE` if access='READ', `WRITES_TABLE` if access='WRITE'. For each column: `USES_COLUMN`. The edge `source_id` = the new `sql_statement` symbol id (from T25/T26's emit), `target_id` = the table / column symbol id. `provenance = 'static'` (T25/T26/T27 are pure-static).
  - **New tables** (`spring_tables`, `spring_columns`) — **if** Team A's initial schema (in `packages/springkg-core/src/db/schema.sql`) doesn't already include them. **Check first**: if `spring_symbols` rows with `kind IN ('table', 'column')` are sufficient, no new tables needed and no migration needed. **If not**, write the migration:
    - File: `packages/springkg-data/src/db/migrations/002_spring_tables_and_columns.sql`
    - Contents:
      ```sql
      -- Team C: SQL table/column denormalized projections.
      -- Reuses spring_symbols row shape (kind='table'|'column') so MCP tools
      -- can query them with the same query path as other symbols.
      -- The denormalized form is for fast lookup of which symbols reference
      -- a given table; no extra columns needed.
      CREATE INDEX IF NOT EXISTS idx_spring_symbols_kind_name
        ON spring_symbols (kind, name) WHERE kind IN ('table', 'column');
      CREATE INDEX IF NOT EXISTS idx_spring_edges_kind_target
        ON spring_edges (kind, target_id) WHERE kind IN ('READS_TABLE', 'WRITES_TABLE', 'USES_COLUMN', 'MAPS_TO_TABLE', 'MAPS_FIELD', 'BIND_TO');
      ```
    - **Submit to Team A** via `docs/team-coordination.md` with the file path and a 1-line description; Team A's T2 (migration runner) picks it up on next merge. **Do not** edit Team A's migration runner from Team C.
  - **Module API**:
    ```typescript
    export class SqlWriter {
      constructor(private readonly db: SpringKgDb) {}
      write(batch: SqlWriterInput[]): SpringKgEnhanceOutput;
    }
    ```
    `SqlWriterInput` = `{ sqlStatement: SpringSqlStatement; mapperMethodId: string; tables: SqlTableColumnResult['tables']; columns: SqlTableColumnResult['columns']; }`.
  - **Tests** (`__tests__/writer.test.ts`, 3 cases): (1) Single SELECT writes 1 `sql_statement` + 1 `table` symbol + 2 `column` symbols + 1 `READS_TABLE` edge + 2 `USES_COLUMN` edges in one transaction (rollback if any insert fails); (2) Re-running the same input is idempotent (no duplicate symbols, no duplicate edges — `INSERT OR REPLACE` handles this); (3) WRITE classification routes through `WRITES_TABLE` not `READS_TABLE` (verify edge kind).

- [ ] 5. [C] **T29 — `packages/springkg-data/src/mapper-binding-resolver.ts`: MapperBindingResolver**
  - **Reads** from `springkg.db`:
    1. `spring_symbols` rows with `kind = 'interface'` (or `class`) AND `decorators_json LIKE '%@Mapper%'` — these are the Mapper interfaces. The CodeGraph Java extractor already emits them; Team C just filters.
    2. For each interface, the `spring_symbols` rows for its methods (`kind = 'method'`, `file_path` = the interface file, qualified_name starts with the interface FQN + `::`).
    3. `spring_sql_statements` rows where `mapper_namespace = <interface FQN>` — these are the XML statements T25 already wrote for the same namespace.
  - **Matches**:
    - For each `@Mapper` interface method, look up `spring_sql_statements.statement_id = <method-name>`. If found, the XML statement exists for that method. If not, the method is annotation-only (T26's job) or has no SQL at all.
  - **Writes**:
    1. `spring_symbols` rows with `kind = 'mapper'` for the interface itself (one per `@Mapper` interface, `codegraph_node_id` = the existing interface row id, `decorators_json` carries the @Mapper annotation; `name` = simple class name, `qualified_name` = FQN). This is the **anchor** node for `spring_find_mapper` to filter on.
    2. `spring_symbols` rows with `kind = 'mapper_method'` for each interface method that has either an XML or annotation SQL statement. The existing `method` row's id is preserved as `codegraph_node_id`; the new row's `id` is `generateNodeId(filePath, 'mapper_method', fqn + '::' + methodName, startLine)` so Team E's `spring_find_mapper` can list them by `kind='mapper_method'` without scanning all `method` rows.
    3. `spring_edges` rows with kind = `BIND_TO`: from the new `mapper_method` row to the matching `sql_statement` row id. `metadata_json = { source: 'xml' | 'annotation', statementId, namespace }`. Confidence 1.0 for exact namespace+id match; 0.9 if the method name matches but namespace differs (cross-mapper reference, rare but valid).
    4. `spring_edges` rows with kind = `CALLS`: from the new `mapper_method` row to the existing `method` row (the interface method on the Java side) so `trace_flow` can walk back from SQL to the interface. Same shape as Team B's `CALLS` edges.
  - **Module API**:
    ```typescript
    export class MapperBindingResolver {
      constructor(private readonly db: SpringKgDb) {}
      resolve(): SpringKgEnhanceOutput;
    }
    ```
  - **Tests** (`__tests__/mapper-binding-resolver.test.ts`, 3 cases): (1) `@Mapper` interface with 3 methods, XML namespace matching → 3 `mapper_method` rows + 3 `BIND_TO` edges + 3 `CALLS` edges + 1 `mapper` row; (2) `@Mapper` interface with annotation-only methods → `mapper_method` rows still emitted, `BIND_TO` edges point at annotation `sql_statement` rows (T26's), no missing rows; (3) Interface with no matching XML (no namespace) → no `mapper_method` rows for that interface, but the `mapper` row is still written (interface exists, just not bound to XML).

- [ ] 6. [C] **T30 — `packages/springkg-data/src/mybatis-plus-resolver.ts`: MyBatisPlusEntityResolver**
  - **Reads** from `springkg.db`: `spring_symbols` rows with `kind = 'class'` AND `decorators_json LIKE '%@TableName%'` (MyBatis-Plus annotation) OR `kind = 'class'` with field-level `@TableField` / `@TableId` / `@TableLogic` annotations. (`@TableName` is the class-level annotation; the field-level ones can appear on classes that don't have `@TableName` — in that case the table name is derived from the class name.)
  - **Extracts**:
    - Table name from `@TableName("users")` value; default to snake_case of the class name (`UserProfile` → `user_profile`, `UserDO` → `user_do` — strip the `DO`/`VO`/`DTO`/`Entity` suffix before conversion, conventional MyBatis-Plus practice; configurable in metadata_json if the maintainer wants different behavior later, but for v1 use the convention). The snake_case function: insert `_` before every uppercase, lowercase the result, strip leading `_`.
    - Field-to-column mapping from each `@TableField("user_name")` annotation (value → column name; default = snake_case of field name). `@TableId` → primary key, mark in `metadata_json.isPrimaryKey = true`. `@TableLogic` → soft-delete column, mark in `metadata_json.isLogicDelete = true`.
  - **Writes**:
    1. `spring_symbols` row with `kind = 'entity'`, `codegraph_node_id` = the existing class row's id, `name` = simple class name, `qualified_name` = FQN, `decorators_json` carries the @TableName value if present, `metadata_json` = `{ tableName, hasTableNameAnnotation: boolean }`.
    2. `spring_edges` row with kind = `MAPS_TO_TABLE`: from the `entity` symbol to the `table` symbol (the row T27/T28 created for the table name — or a placeholder if the table isn't referenced by any SQL yet; placeholder `table` row has `metadata_json.synthetic = true` so MCP tools can flag it). `confidence = 1.0` if `@TableName` present, `0.85` if derived from class name.
    3. For each field with `@TableField` / `@TableId` / `@TableLogic`: `spring_edges` row with kind = `MAPS_FIELD`: from the existing field symbol (CodeGraph's `field` kind) to the `column` symbol. `metadata_json = { annotation, jdbcType?, isPrimaryKey?, isLogicDelete? }`. `confidence = 1.0` if explicit annotation value, `0.85` if derived from field name.
  - **Module API**:
    ```typescript
    export class MyBatisPlusEntityResolver {
      constructor(private readonly db: SpringKgDb) {}
      resolve(): SpringKgEnhanceOutput;
    }
    ```
  - **Tests** (`__tests__/mybatis-plus-resolver.test.ts`, 3 cases): (1) Class with `@TableName("users")` + fields with `@TableField` → `entity` row + `MAPS_TO_TABLE` + N `MAPS_FIELD` edges, table name = "users"; (2) Class without `@TableName` but with `@TableField` fields → `entity` row, table name = snake_case of class name, `metadata_json.hasTableNameAnnotation = false`, confidence 0.85; (3) Field with `@TableId` (primary key) → `MAPS_FIELD` edge with `metadata_json.isPrimaryKey = true`, separate `metadata_json.isLogicDelete` field for `@TableLogic`.

- [ ] 7. [C] **T31 — `packages/springkg-data/src/jpa-entity-resolver.ts`: JPAEntityResolver (P1)**
  - **Scope**: P1 (deferred if Sprint 4 is at risk; the rest of Team C is P0 and ships without T31). The implementation is straightforward and parallels T30 — defer it rather than skip it.
  - **Reads** from `springkg.db`: `spring_symbols` rows with `kind = 'class'` AND `decorators_json LIKE '%@Entity%'` (JPA annotation).
  - **Extracts**:
    - Table name from `@Table(name = "users")` value. Default = snake_case of class name (same convention as T30: `UserProfile` → `user_profile`).
    - Field-to-column from `@Column(name = "user_name")` value. Default = field name unchanged (JPA convention is to match column name exactly; do **not** snake_case — that's MyBatis-Plus behavior, not JPA).
  - **Writes**:
    1. `spring_symbols` row with `kind = 'entity'`, `codegraph_node_id` = the existing class row's id, `name` = simple class name, `qualified_name` = FQN, `metadata_json` = `{ tableName, source: 'jpa', hasTableAnnotation: boolean }`.
    2. `spring_edges` row with kind = `MAPS_TO_TABLE`: from the `entity` symbol to the `table` symbol (same handling as T30). `confidence = 1.0` with `@Table`, `0.85` derived.
    3. For each field with `@Column`: `spring_edges` row with kind = `MAPS_FIELD`: from the field symbol to the `column` symbol. `confidence = 1.0` explicit, `0.85` derived.
  - **Module API**:
    ```typescript
    export class JpaEntityResolver {
      constructor(private readonly db: SpringKgDb) {}
      resolve(): SpringKgEnhanceOutput;
    }
    ```
  - **Tests** (`__tests__/jpa-entity-resolver.test.ts`, 2 cases): (1) `@Entity` class with `@Table(name="users")` + fields with `@Column` → entity row + `MAPS_TO_TABLE` + N `MAPS_FIELD` edges; (2) `@Entity` class without `@Table` → entity row, table name derived from class name (`UserProfile` → `user_profile`), `hasTableAnnotation = false`, confidence 0.85.

### Cross-cutting subtasks (within Team C scope)

- [ ] 8. [C] **Index export** — `packages/springkg-data/src/index.ts` re-exports the 7 modules. Consumed by Team A's `SpringKg.enhancers` registration. Update the file as each module lands (T25 sets up the file, T26-T31 append their exports). Final shape:
  ```typescript
  export { MyBatisXmlExtractor } from './mybatis-xml-extractor';
  export { AnnotationSqlExtractor } from './annotation-sql-extractor';
  export { SqlTableColumnExtractor } from './sql-table-column';
  export { SqlWriter } from './writer';
  export { MapperBindingResolver } from './mapper-binding-resolver';
  export { MyBatisPlusEntityResolver } from './mybatis-plus-resolver';
  export { JpaEntityResolver } from './jpa-entity-resolver';
  ```
- [ ] 9. [C] **Coordination doc** — append a "Team C status" section to `docs/team-coordination.md` (Team G maintains the file, Team C writes into its own subsection) on each PR. Include: tasks completed, schema-amendment requests submitted to Team A, open questions for Team E about edge consumption.

---

## 5. Sync Points

### 5.1 Blocked on Team A Phase 1
- Team A's `SpringKg` class + `springkg.db` schema must exist (8 tables defined, including `spring_symbols`, `spring_edges`, `spring_sql_statements`).
- `packages/springkg-shared/src/index.ts` must export `SpringKgNode`, `SpringKgEdge`, `SpringKgEnhanceInput`, `SpringKgEnhanceOutput`, `Resolver`, `generateNodeId`.
- Confirm via: `ls packages/springkg-core/src/spring-kg.ts packages/springkg-shared/src/index.ts` and `npx tsc --noEmit` in the workspace root.

### 5.2 Team C → Team E (Sprint 2 critical path)
**T25, T26, T28, T29 must be merged before Team E can start T33 (`spring_find_mapper`) and T34 (`spring_trace_flow` data-access extension).**

| Team C task | Team E dependency | What Team E reads |
|---|---|---|
| T25 (XML extractor) | T33, T34 | `spring_symbols.kind = 'sql_statement'` + `spring_sql_statements` rows for XML-originated SQL |
| T26 (annotation extractor) | T33, T34 | Same shapes, `metadata_json.source = 'annotation'` |
| T27 (SQL parser) | (used by T25/T26/T28 — not directly by E) | — |
| T28 (writer) | T33, T34 | Persists the table/column symbols and `READS_TABLE` / `WRITES_TABLE` / `USES_COLUMN` edges that `trace_flow` follows |
| T29 (Mapper binding) | T33 | The `mapper` / `mapper_method` symbols and `BIND_TO` edges that `spring_find_mapper` is built to query |
| T30 (MyBatis-Plus entity) | T33 (optional, enriches the result) | `entity` symbols + `MAPS_TO_TABLE` / `MAPS_FIELD` edges for "what entity backs this table" lookups |
| T31 (JPA entity) | T33 (P1, optional) | Same as T30, JPA variant |

**Concrete merge gate**: Team E's `spring_find_mapper` smoke test (run by Team G) on the demo project must return at least one `mapper_method` row with its `sql_statement`, table, and columns populated. That requires T25 + T28 + T29 merged. T30/T31 are nice-to-have for the smoke test.

### 5.3 Team C → Team G (validation)
- Each PR from Team C includes the test file in `packages/springkg-data/__tests__/` already passing (`npx vitest run packages/springkg-data`). Team G's CI runs the full suite after each team merge; Team C's tests are gated on Team A's shared types existing (Team G's CI setup handles this).
- Team G's `examples/springcloud-demo` (built in Phase 3 by Team G) must include a sample MyBatis mapper with both XML and annotation SQL, plus a MyBatis-Plus entity, so Team C's resolvers have something to find in the smoke test. Team C contributes the fixture file (in `examples/springcloud-demo/src/main/resources/mapper/UserMapper.xml` + `UserMapper.java` + `User.java` with `@TableName`) and writes a corresponding unit test that points at the fixture — but the fixture is **owned by Team G**. Submit the fixture spec to Team G via `docs/team-coordination.md` (one paragraph: file paths, what the mapper does, expected SQL).

### 5.4 Team C → Team A (schema amendments)
If T25-T31 discover a missing column on `spring_symbols` or `spring_sql_statements`, Team C **does not edit the schema**. Instead:
1. Open a subsection under "Team C → Team A requests" in `docs/team-coordination.md`.
2. Describe: the table, the missing column, why it's needed, what writes it, what reads it.
3. Wait for Team A to add the column (Team A's Phase 2 includes a small buffer for cross-team schema requests).
4. Pick up the change in the next PR.

The `spring_tables` and `spring_columns` tables **might not need to exist** — they're denormalized projections of `spring_symbols` rows with `kind = 'table' | 'column'`. Default: emit into `spring_symbols` only, no new tables, no migration. **Add the migration only if** a downstream consumer (Team E, Team F) requests denormalized indexes that justify it — and at that point, follow the cross-team amendment flow above.

---

## 6. Verification Commands

### Per-task
```bash
# T25: scaffold + first run
mkdir -p packages/springkg-data/src packages/springkg-data/__tests__
# (write package.json, tsconfig.json, vitest.config.ts, src/index.ts, then the 5 tests)
npx vitest run packages/springkg-data/__tests__/mybatis-xml-extractor.test.ts

# T26
npx vitest run packages/springkg-data/__tests__/annotation-sql-extractor.test.ts

# T27 (pure-function module, no DB needed)
npx vitest run packages/springkg-data/__tests__/sql-table-column.test.ts

# T28 (needs a temp DB; see test file setup pattern below)
npx vitest run packages/springkg-data/__tests__/writer.test.ts

# T29
npx vitest run packages/springkg-data/__tests__/mapper-binding-resolver.test.ts

# T30
npx vitest run packages/springkg-data/__tests__/mybatis-plus-resolver.test.ts

# T31
npx vitest run packages/springkg-data/__tests__/jpa-entity-resolver.test.ts

# All Team C
npx vitest run packages/springkg-data
```

### End-to-end smoke (after T25+T28+T29 merge, before T33/T34 start)
```bash
# 1. Build the workspace (also runs tsc)
npm run build

# 2. Initialize the demo project
cd examples/springcloud-demo
npx springkg init
npx springkg index
npx springkg status

# 3. Query what Team C wrote
sqlite3 .codegraph/springkg.db "SELECT kind, COUNT(*) FROM spring_symbols WHERE kind IN ('mapper','mapper_method','sql_statement','entity','table','column') GROUP BY kind;"
sqlite3 .codegraph/springkg.db "SELECT kind, COUNT(*) FROM spring_edges WHERE kind IN ('EXECUTES_SQL','READS_TABLE','WRITES_TABLE','USES_COLUMN','MAPS_TO_TABLE','MAPS_FIELD','BIND_TO') GROUP BY kind;"
sqlite3 .codegraph/springkg.db "SELECT mapper_namespace, statement_id, operation, substr(sql_preview,1,60) FROM spring_sql_statements LIMIT 10;"
```

Expected after the demo project is indexed:
- `mapper` ≥ 1 (one `@Mapper` interface)
- `mapper_method` ≥ 1 (one method on it)
- `sql_statement` ≥ 1 (XML or annotation)
- `table` ≥ 1 (the table the SQL touches)
- `column` ≥ 1 (at least one column)
- All 7 edge kinds non-zero, with `EXECUTES_SQL` and at least one of `READS_TABLE` / `WRITES_TABLE` present.

### Cross-team integration check (Team G runs this)
```bash
# After Team E T33 lands, the MCP tool should return data Team C wrote
echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"spring_find_mapper","arguments":{"name":"UserMapper"}},"id":1}' \
  | npx springkg-mcp
# Expect: mapper_method rows with sql_statement joined, plus table/column rows reachable.
```

---

## 7. Definition of Done (Team C)

- [ ] All 7 tasks (T25-T31) implemented, all tests pass (`npx vitest run packages/springkg-data`).
- [ ] `packages/springkg-data/` contains only files listed in §2 (no surprise files in `src/` or `__tests__/`).
- [ ] No edits to `packages/springkg-core/`, `packages/springkg-shared/`, `packages/springkg-semantic/`, `packages/springkg-runtime/`, `packages/springkg-mcp/`, `packages/springkg-cli/`, `packages/springkg-community/`, `packages/springkg-installer/`, `src/`, or workspace `package.json` / `tsconfig.json`.
- [ ] No `console.log` / `as any` / `@ts-ignore` / commented-out code in new files. (`eslint-disable` only with a one-line justification comment.)
- [ ] `npm test` from the workspace root passes with 0 failures (cross-team contract: don't break other teams' tests).
- [ ] `npx tsc --noEmit` exits 0.
- [ ] End-to-end smoke (§6) shows the expected row counts on the demo project.
- [ ] `docs/team-coordination.md` has a Team C status section with the 7 tasks marked done.
- [ ] If T31 was deferred (P1), `docs/team-coordination.md` records the deferral with a target ship date.

---

## 8. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Team A's `decorators_json` shape on `spring_symbols` doesn't include `value` (just the annotation name) | T26 can't extract the SQL string from `@Select("...")` | Submit schema-amendment request in `docs/team-coordination.md` immediately on Phase 1 completion. If Team A can't add it, fall back to re-parsing the `.java` file from disk (small dedicated helper, not a full Java parser — just regex on the line containing `@Select`). |
| Dynamic SQL is genuinely ambiguous (a `<foreach>` over column names is unrepresentable statically) | T27 emits low-confidence rows for these | T27's confidence floor is 0.5 and T28 passes it through. MCP tools (Team E) display confidence to the agent. The agent falls back to `codegraph_node` (Read tool equivalent) for the original file when confidence < 0.7. |
| `spring_sql_statements` table has fewer columns than T25 wants to fill (no `metadata_json`?) | T25 can't store dynamic-tag counts or resultMap details | Default to JSON-encoding everything into the existing columns; if a true structural column is missing (e.g. `operation` enum), request it from Team A. Do not add columns from Team C. |
| The upstream CodeGraph `MyBatisExtractor` (which Team C is enhancing) changes in a future CodeGraph release | T25's output diverges from upstream | T25's output is **deliberately** different — it writes to `springkg.db`, not `codegraph.db`. Upstream changes affect only the upstream code path; springkg-data does not depend on the upstream extractor at runtime (only as a reference for behavior). Document this in the module's header comment. |
| JPA T31 is P1 and Sprint 4 might be cut | T31 ships late | T31 is independent of T25-T30. Defer it cleanly — it does not block any other task. Mark in `docs/team-coordination.md`. |
| MyBatis-Plus `@TableName` / `@TableField` value parsing when the decorator string contains commas inside `(...)` | Wrong column name extracted | Use a balanced-paren parser for the decorator's argument list, not a naive regex on the first quoted string. ~20 LOC. |

---

## 9. Worktree & Commit Strategy

- Branch: `team-c-data` from `main` (created by the lead — `git worktree add -b team-c-data ../cg-team-c main`).
- Commit cadence: one commit per task (T25, T26, T27, T28, T29, T30, T31). T25 is the biggest — it sets up the package scaffold, so it lands first. T26-T28 land in order (T26 produces inputs T27 consumes, T28 persists both). T29-T31 are independent and can land in any order after T28.
- Commit message format: `data: <task-id> <one-line description>` (e.g. `data: T25 mybatis-xml-extractor with resultMap + dynamic SQL`).
- Pre-commit: `npx vitest run packages/springkg-data` must pass; `npx tsc --noEmit` from workspace root must pass; `git status` must show only files inside `packages/springkg-data/` (and `docs/team-coordination.md` for the status section, if updated in the same commit).
- PR target: `main`. Reviewer: Team G (validation team) — they verify the smoke test against the demo project, not the implementation details.
- Merge timing: Team C ships in two PRs — PR #1 covers T25-T28 (XML + annotation + SQL parser + writer; unblocks Team E T33/T34), PR #2 covers T29-T31 (binding + entities; required for `spring_find_mapper` to be complete, not just stubbed). PR #2 can land after Team E starts its T33/T34 implementation — T29's `mapper` nodes are useful but not strictly required for the `trace_flow` data-access extension to function.

---

## 10. Quick Reference

**Owns**: `packages/springkg-data/src/**`, `packages/springkg-data/__tests__/**`
**Reads from**: `spring_symbols` (Java methods, classes, interfaces, fields), `spring_sql_statements` (own writes, mid-pipeline)
**Writes to**: `spring_symbols` (kinds: `mapper`, `mapper_method`, `sql_statement`, `entity`, `table`, `column`), `spring_sql_statements`, `spring_edges` (kinds: `EXECUTES_SQL`, `READS_TABLE`, `WRITES_TABLE`, `USES_COLUMN`, `MAPS_TO_TABLE`, `MAPS_FIELD`, `BIND_TO`, `CALLS`)
**Blocked by**: Team A Phase 1 (SpringKg class + shared types + 8-table schema)
**Blocks**: Team E T33 (`spring_find_mapper`), Team E T34 (`spring_trace_flow` data-access extension)
**Validation owner**: Team G (PR review + smoke test against `examples/springcloud-demo`)

Total tasks: **7 implementation + 2 cross-cutting = 9 todos** in this plan.
