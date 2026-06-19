# Team A — Foundation / CodeGraph Integration

> **Status**: ⏳ PENDING (Phase 1 — Foundation)
> **Worktree**: `team-a-foundation` (must be created from `main` before any work begins)
> **Owns**: `packages/springkg-core/`, `packages/springkg-shared/`, `packages/springkg-installer/`, root `package.json` (workspaces field), root `tsconfig.json`
> **Critical path**: Phase 1 outputs (`SpringKg` class + `springkg.db` schema + cross-team interface contracts) unblock Teams B, C, D, E, F.

---

## TL;DR

> **Mission**: Scaffold the `springkg` monorepo, wrap CodeGraph's `CodeGraph` class as a `SpringKg` orchestrator that owns a separate `springkg.db` (in `.codegraph/`, WAL-mode), define the cross-team `Resolver` contract that Teams B/C/D plug into, and ship a working `springkg install`/`uninstall` CLI for Claude/Cursor/opencode. **Team A does NOT write any per-resolver logic** — it builds the scaffolding and the pipeline, Teams B–F fill the resolvers.
>
> **15 tasks · 2 phases · ~2-3 days wall-clock**
>
> - **Phase 1 (Tasks 1-5)** — monorepo + DB + SpringKg skeleton (unblocks B/C/D)
> - **Phase 2 (Tasks 6-15)** — resolver pipeline wiring + install CLI + WAL/confidence/migration/Windows (unblocks E/F + closes Metis C2/C5/M gates)
>
> **Hard "DO NOT" rules**:
> - ❌ Do NOT modify `src/**` (CodeGraph upstream) or any file outside the owned list.
> - ❌ Do NOT write resolver internals (annotation-engine, mybatis-xml-extractor, etc.) — those are Teams B/C/D/F.
> - ❌ Do NOT create `.springkg/` at the project root — `springkg.db` lives in `.codegraph/`.
> - ❌ Do NOT invent CodeGraph API. The real `CodeGraph` class is at `src/index.ts:132`; use it as-is.

---

## 1. Team Overview

Team A is the **foundation layer**. Every other team depends on our three exports:

1. **`@colbymchenry/springkg-shared`** — TypeScript interfaces (`SpringKgNode`, `SpringKgEdge`, `Resolver`, `SPRINGKG_CONFIG`). Other teams `import { Resolver, SpringKgNode } from '@colbymchenry/springkg-shared'`. **The contract is law.**
2. **`@colbymchenry/springkg-core`** — The `SpringKg` class wrapping `CodeGraph` + a private `SpringDatabase` (own `springkg.db` file). Manages the resolver chain that Teams B–F plug into via `enhanceOnSync(paths)`.
3. **`@colbymchenry/springkg-installer`** — `springkg install` / `springkg uninstall` CLI (modeled on `src/installer/`), wires the springkg MCP server into the supported agents' config files.

We also mutate two root files (`package.json` workspaces field, root `tsconfig.json` for the monorepo). Both are listed in the "Owned" section and no other team may touch them.

**Why Team A blocks everything else**: Teams B/C/D/F need `SpringKg.enhanceOnSync` to register their resolvers. Team E needs `SPRINGKG_CONFIG` to wire MCP. Team G needs the install CLI to run validation. Until Phase 1 lands, no other team can start.

---

## 2. Owned Files (DO NOT WRITE OUTSIDE THIS LIST)

| Path | Purpose |
|---|---|
| `package.json` (root) | Add `"workspaces": ["packages/*"]` field, `peerDependencies` for `@colbymchenry/codegraph`, root `build`/`test` orchestration. |
| `tsconfig.json` (root) | Extend with monorepo-wide references; per-package `tsconfig.json`s compose. |
| `packages/springkg-shared/src/**` | All cross-team interface types, `SPRINGKG_CONFIG`, the `Resolver` contract. |
| `packages/springkg-core/src/**` | `spring-kg.ts`, `db/spring-db.ts`, `db/schema.sql`, `db/migrations.ts`, `db/migrations/*.sql`, `enhance/*.ts` (only the pipeline dispatcher — resolvers are stubbed). |
| `packages/springkg-installer/src/**` | `targets/{registry,types,claude}.ts`, CLI `install`/`uninstall` flow. |
| `packages/springkg-{semantic,data,runtime,community,mcp,cli}/package.json` + `tsconfig.json` + `src/index.ts` | **Scaffold only.** Stub `index.ts` exports the package name; do NOT implement any resolver. |
| `__tests__/setup.ts` | Platform-detection helper used by all teams' `it.runIf(...)` patterns. |
| `__tests__/team-a/**/*.test.ts` | Team A's own tests (schema, SpringKg, WAL, migrations, installer). |

### Explicit "DO NOT write" list (other teams' files)

| Path | Owned by |
|---|---|
| `packages/springkg-semantic/src/resolvers/**` | Team B |
| `packages/springkg-data/src/resolvers/**` | Team C |
| `packages/springkg-runtime/src/resolvers/**` | Team D |
| `packages/springkg-community/src/**` (except scaffold) | Team F |
| `packages/springkg-mcp/src/**` | Team E |
| `packages/springkg-cli/src/**` | Team E |
| `src/**` (CodeGraph upstream) | **NEVER TOUCH** |
| `examples/**`, `docs/**`, `CHANGELOG.md` | Team G |
| `__tests__/team-{b..g}/**` | Other teams |

If a task appears to require writing into a "DO NOT" path, **stop and re-read the task** — Team A only scaffolds those packages, never implements them.

---

## 3. Input Contracts (from main plan)

The main coordination plan (`springcloud.md`) supplies:

- **Database path convention**: `springkg.db` MUST live in `.codegraph/springkg.db` (next to `codegraph.db`; the CodeGraph file watcher already skips `.codegraph/`, so `springkg.db` is automatically excluded from indexing).
- **Append-only writes** by kind — Team A owns no row data. Schema is shared; rows belong to B/C/D/F.
- **CodeGraph API surface** — `CodeGraph.init/open/indexAll/sync/watch/getPendingFiles/close`. See `src/index.ts`. **Use exactly this API.** The plan claim "onSyncComplete.changedFilePaths" does NOT exist; use `cg.getPendingFiles()` per `src/index.ts:611-619`.
- **PRAGMA baseline** (per `src/db/index.ts:30-38`): `busy_timeout=5000, foreign_keys=ON, journal_mode=WAL, synchronous=NORMAL`. Match exactly.
- **Schema-version pattern** (per `src/db/migrations.ts` + `schema_versions` table). Mirror it.

---

## 4. Output Contracts (interfaces in `packages/springkg-shared/src/index.ts`)

This is the **single source of truth** for cross-team types. Teams B/C/D/F import from here. Do not change shapes after Phase 1 lands; if a contract change is required, coordinate via team-coordination.md and bump a major version on `springkg-shared`.

```typescript
// packages/springkg-shared/src/index.ts

// -----------------------------------------------------------------------------
// Node / Edge kinds — union of all per-team symbol/edge kinds.
// -----------------------------------------------------------------------------

export const SPRINGKG_NODE_KINDS = [
  // Team A (none — only schema owner)
  // Team B (semantic)
  'controller', 'service', 'repository', 'component',
  'feign_client', 'feign_method', 'endpoint', 'remote_service',
  // Team C (data)
  'mapper', 'mapper_method', 'sql_statement', 'entity', 'table', 'column',
  // Team D (runtime)
  'config_property', 'middleware', 'nacos_cluster', 'nacos_config', 'gateway_route',
  // Team F (community)
  'feature_community', 'feature_community_member',
] as const;
export type SpringKgNodeKind = (typeof SPRINGKG_NODE_KINDS)[number];

export const SPRINGKG_EDGE_KINDS = [
  // Team B
  'HANDLED_BY', 'CALLS', 'BELONGS_TO', 'CALLS_FEIGN', 'TARGETS_ENDPOINT',
  // Team C
  'EXECUTES_SQL', 'READS_TABLE', 'WRITES_TABLE', 'MAPS_TO_TABLE', 'BIND_TO',
  // Team D
  'CONNECTS_TO', 'LOADS_CONFIG', 'ROUTES_TO',
  // Team F
  'MEMBER_OF',
] as const;
export type SpringKgEdgeKind = (typeof SPRINGKG_EDGE_KINDS)[number];

// -----------------------------------------------------------------------------
// Core node / edge records persisted to springkg.db
// -----------------------------------------------------------------------------

export interface SpringKgNode {
  id: string;                         // deterministic: `${kind}:${sha256(...).slice(0,32)}`
  kind: SpringKgNodeKind;
  codegraphNodeId: string;            // FK into CodeGraph's nodes table
  name?: string;
  qualifiedName?: string;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  metadata?: Record<string, unknown>;
  confidence: number;                 // 0.0-1.0 (Metis M fix; default 1.0)
  createdAt: number;
  updatedAt: number;
}

export interface SpringKgEdge {
  id: string;
  sourceId: string;                   // SpringKgNode.id
  targetId: string;                   // SpringKgNode.id
  kind: SpringKgEdgeKind;
  metadata?: Record<string, unknown>;
  confidence: number;                 // 0.0-1.0 (Metis M fix; default 1.0)
  createdAt: number;
}

export interface SpringKgEndpoint {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD' | '*';
  path: string;
  handlerClassId?: string;            // SpringKgNode.id (controller)
  handlerMethodId?: string;           // SpringKgNode.id
  sourceFilePath: string;
  sourceLine: number;
}

export interface SpringKgFeignClient {
  id: string;
  clientName: string;                 // e.g. "UserClient"
  targetService: string;              // e.g. "user-service" (from @FeignClient name)
  targetUrl?: string;                 // from @FeignClient url=
  methodCount: number;
}

export interface SpringKgSqlStatement {
  id: string;
  mapperId: string;                   // SpringKgNode.id (mapper)
  sqlHash: string;                    // sha256 of normalized SQL
  sqlText: string;                    // canonicalized
  parameterCount: number;
  tables: string[];                   // derived
  sourceFilePath: string;
  sourceLine: number;
}

export interface RuntimeConfigProperty {
  id: string;
  key: string;
  valueHash: string;                  // sha256 of value (sensitive values are redacted)
  isSensitive: boolean;               // true iff key matches SPRINGKG_CONFIG.sensitiveKeyPatterns
  sourceFilePath: string;
  sourceLine: number;
  beanId?: string;                    // @ConfigurationProperties prefix
}

export interface FeatureCommunity {
  id: string;
  label: string;
  summary: string;
  memberCount: number;
  dirty: boolean;                     // true until SummaryGenerator runs
  lastSummarizedAt?: number;
}

export interface FeatureCommunityMember {
  communityId: string;
  springNodeId: string;               // SpringKgNode.id
  membershipScore: number;
}

// -----------------------------------------------------------------------------
// Resolver contract (Teams B / C / D / F implement this)
// -----------------------------------------------------------------------------

export interface SpringKgEnhanceInput {
  codegraphNodes: ReadonlyArray<{ id: string; kind: string; name: string; filePath: string; [k: string]: unknown }>;
  codegraphEdges: ReadonlyArray<{ id: string; source: string; target: string; kind: string; [k: string]: unknown }>;
  /** Absolute file paths that changed since the last enhance call. */
  changedFiles: ReadonlyArray<string>;
  /** Active CodeGraph instance (use for ad-hoc queries). */
  cg: { getNode(id: string): unknown; getOutgoingEdges(id: string): unknown[]; getIncomingEdges(id: string): unknown[]; getNodesInFile(path: string): unknown[]; [k: string]: unknown };
}

export interface SpringKgEnhanceOutput {
  symbolsAdded: number;
  edgesAdded: number;
  byKind: Record<string, number>;
}

export interface Resolver {
  /** Unique name, used for log lines and idempotency checks. */
  readonly name: string;
  /** Optional: declared kind of nodes this resolver emits. Used for diagnostics only. */
  readonly emitsKinds?: ReadonlyArray<SpringKgNodeKind>;
  /** Called after every sync. Must be idempotent — same input twice MUST yield same output. */
  enhance(input: SpringKgEnhanceInput): Promise<SpringKgEnhanceOutput>;
}

// -----------------------------------------------------------------------------
// Shared config (Team A owns; Teams B–G read)
// -----------------------------------------------------------------------------

export const SPRINGKG_CONFIG = {
  version: '0.1.0',
  db: {
    filename: 'springkg.db',         // always inside .codegraph/
    journalMode: 'wal' as const,
    busyTimeoutMs: 5000,
    synchronous: 'NORMAL' as const,
  },
  mcp: {
    name: 'springkg-mcp',
    version: '0.1.0',
  },
  sensitiveKeyPatterns: [
    /password/i, /passwd/i, /secret/i, /token/i,
    /access[-_]?key/i, /api[-_]?key/i, /private[-_]?key/i,
    /credential/i, /auth/i,
  ] as const,
  /** Resolver execution order (append to this list as new resolvers land). */
  resolverChain: [
    // Team B
    'annotation-engine', 'endpoint-resolver', 'feign-resolver',
    'feign-provider-bridge', 'feign-request-response-type',
    // Team D
    'config-resolver', 'middleware-inventory',
    'nacos-config-resolver', 'config-property-usage-tracker', 'gateway-route-resolver',
    // Team C
    'mybatis-xml-extractor', 'annotation-sql-extractor',
    'sql-table-column', 'mapper-binding', 'mybatis-plus',
    // Team F (after per-file resolvers)
    'community-builder',
  ] as const,
  /** Async summary generation cadence (Metis M — manual + timer). */
  summaryRegeneration: {
    intervalMs: 60_000,                // 60s timer
    triggerOn: ['manual', 'timer', 'dirty-count-100'] as const,
  },
} as const;
```

---

## 5. Task List

> **Format**: Each task is `- [ ] N. [A] Title` (bare numbers, NOT `T1.` / `Phase 1:`). The "T#" prefix in the main plan maps to N here, so T7→1, T8→2, …, T72→15.

---

- [x] 1. [A] Init monorepo (9 packages, workspaces, per-package tsconfig)

**What to do**:

Create the monorepo skeleton. **9 package directories** under `packages/`, each with a stub `package.json` + `tsconfig.json` + `src/index.ts` (stub). Only `springkg-core`, `springkg-shared`, `springkg-installer` get real code in this task — the other 6 are empty scaffolds that other teams will fill in (their `index.ts` just exports the package name string).

Root `package.json` changes:

- Add `"workspaces": ["packages/*"]`.
- Add `peerDependencies: { "@colbymchenry/codegraph": ">=0.9.0 <1.0.0" }` (Task 15).
- Add root scripts:
  - `build`: `tsc -b packages/springkg-shared packages/springkg-core packages/springkg-installer` (other packages are built by their owners when they exist).
  - `test`: `vitest run __tests__/team-a` (other teams extend this).
- Keep the existing `codegraph` build untouched (it's a separate top-level concern).

Root `tsconfig.json`: add `"composite": true` and `references` to each sub-package's `tsconfig.json` (only `springkg-shared` and `springkg-core` need it for Phase 1; add others as teams ship them).

Per-package template (apply to all 9):

```jsonc
// packages/springkg-core/package.json
{
  "name": "@colbymchenry/springkg-core",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc && npm run copy-assets",
    "copy-assets": "node -e \"const fs=require('fs'),path=require('path');fs.mkdirSync('dist/db',{recursive:true});fs.copyFileSync('src/db/schema.sql','dist/db/springkg-schema.sql')\""
  },
  "dependencies": {
    "@colbymchenry/springkg-shared": "0.1.0"
  },
  "peerDependencies": {
    "@colbymchenry/codegraph": ">=0.9.0 <1.0.0"
  }
}
```

```jsonc
// packages/springkg-core/tsconfig.json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "references": [{ "path": "../springkg-shared" }]
}
```

```ts
// packages/springkg-core/src/index.ts
export { SpringKg } from './spring-kg.js';
export { SpringDatabase } from './db/spring-db.js';
export type { Resolver as SpringKgResolver, SpringKgEnhanceInput, SpringKgEnhanceOutput } from '@colbymchenry/springkg-shared';
```

For the 6 packages Team A does NOT own, the `src/index.ts` is just:

```ts
// packages/springkg-semantic/src/index.ts
// Scaffold owned by Team A. Real implementation lands in Sprint 2+.
export const SPRINGKG_PACKAGE = '@colbymchenry/springkg-semantic' as const;
```

**Recommended Agent Profile**: `quick` (1) — pure mechanical scaffolding, no design decisions.

**Parallelization**: Sequentially with Task 2 (the schema must exist before SpringDatabase can use it). All 9 package scaffolds can be created in a single pass.

**Acceptance Criteria**:

- [ ] `packages/springkg-{core,shared,semantic,data,runtime,community,mcp,cli,installer}/package.json` exist with `name: "@colbymchenry/springkg-{pkg}"`, `type: "module"`, version `0.1.0`.
- [ ] Root `package.json` has `"workspaces": ["packages/*"]`.
- [ ] `npm install` from root completes with 0 errors and creates `packages/*/node_modules` symlinks.
- [ ] `npx tsc -b packages/springkg-shared packages/springkg-core` succeeds with 0 errors.
- [ ] Each sub-package's `dist/index.js` exists after build.

**QA Scenarios**:

```bash
# 1. Verify all 9 package.json files exist
ls packages/springkg-{core,shared,semantic,data,runtime,community,mcp,cli,installer}/package.json | wc -l   # → 9

# 2. Verify workspaces field
node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf-8')).workspaces)"
# → ["packages/*"]

# 3. Install from root (no peer dep conflicts)
rm -rf node_modules packages/*/node_modules
npm install   # must exit 0, no ERESOLVE

# 4. Build core + shared
npx tsc -b packages/springkg-shared packages/springkg-core
# → exit 0, no errors

# 5. Verify core can be required (smoke test)
node -e "import('@colbymchenry/springkg-core').then(m => console.log(typeof m.SpringKg))" --input-type=module
# → "function"
```

---

- [x] 2. [A] springkg.db schema (8 tables + indexes + confidence column)

**What to do**:

Author `packages/springkg-core/src/db/schema.sql` — **8 tables** exactly as specified in the main plan §Concrete Deliverables:

1. `spring_symbols` (kind, codegraph_node_id UNIQUE, name, qualified_name, file_path, start_line, end_line, metadata JSON, **confidence REAL DEFAULT 1.0**, created_at, updated_at)
2. `spring_edges` (source_id, target_id, kind, metadata JSON, **confidence REAL DEFAULT 1.0**, created_at)
3. `spring_endpoints` (method, path, handler_class_id, handler_method_id, source_file_path, source_line)
4. `spring_feign_clients` (client_name, target_service, target_url, method_count)
5. `spring_sql_statements` (mapper_id, sql_hash, sql_text, parameter_count, tables JSON, source_file_path, source_line)
6. `runtime_config_properties` (key, value_hash, is_sensitive, source_file_path, source_line, bean_id)
7. `feature_communities` (label, summary, member_count, dirty INTEGER, last_summarized_at)
8. `feature_community_members` (community_id, spring_node_id, membership_score)

Plus the bookkeeping table `schema_versions` (mirroring `src/db/schema.sql` lines 4-10):

```sql
CREATE TABLE IF NOT EXISTS schema_versions (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL,
    description TEXT
);
```

Indexes (must be present):

- `spring_symbols(codegraph_node_id)` — UNIQUE
- `spring_symbols(kind)`, `spring_symbols(file_path)`, `spring_symbols(confidence)` — for filter queries
- `spring_edges(source_id)`, `spring_edges(target_id)`, `spring_edges(kind)` — graph traversal
- `spring_endpoints(method, path)` — composite
- `spring_feign_clients(client_name)` — UNIQUE
- `spring_sql_statements(mapper_id)`, `spring_sql_statements(sql_hash)` — UNIQUE on sql_hash
- `runtime_config_properties(key)` — for reverse lookup
- `feature_community_members(community_id)`, `feature_community_members(spring_node_id)` — UNIQUE composite

**Metis M fix (T70)**: both `spring_symbols` and `spring_edges` MUST have `confidence REAL DEFAULT 1.0`. Document this in a SQL comment so reviewers can find it.

**Asset copy (also part of T70)**: add to `packages/springkg-core/package.json` `scripts.copy-assets`:

```jsonc
"copy-assets": "node -e \"const fs=require('fs'),path=require('path');fs.mkdirSync('dist/db',{recursive:true});fs.copyFileSync('src/db/schema.sql','dist/db/springkg-schema.sql')\""
```

Schema is loaded by `SpringDatabase.initialize()` (Task 3) from `dist/db/springkg-schema.sql` (so this copy step is required for the built artifact to find the schema at runtime).

**Recommended Agent Profile**: `quick` (1) — straightforward SQL authoring, no design decisions.

**Parallelization**: Independent of Tasks 1/3/4 (schema is a pure SQL file). Can land in parallel with the monorepo scaffold.

**Acceptance Criteria**:

- [ ] `packages/springkg-core/src/db/schema.sql` exists, 8 tables, all with `IF NOT EXISTS`.
- [ ] Both `spring_symbols` and `spring_edges` contain `confidence REAL DEFAULT 1.0`.
- [ ] All required indexes exist (verify with `sqlite3 ... ".schema spring_symbols"`).
- [ ] `npm run build` in `packages/springkg-core` produces `dist/db/springkg-schema.sql` byte-equal to source (modulo trailing newline).
- [ ] Loading the schema against a fresh `.codegraph/springkg.db` succeeds with 0 errors.

**QA Scenarios**:

```bash
# 1. Open against a temp db and verify tables
TMP=$(mktemp -d)
sqlite3 "$TMP/springkg.db" < packages/springkg-core/src/db/schema.sql
sqlite3 "$TMP/springkg.db" ".tables" | tr ' ' '\n' | sort -u
# → expected (order varies):
#   feature_community_members
#   feature_communities
#   runtime_config_properties
#   schema_versions
#   spring_edges
#   spring_endpoints
#   spring_feign_clients
#   spring_sql_statements
#   spring_symbols

# 2. Verify confidence column
sqlite3 "$TMP/springkg.db" "PRAGMA table_info(spring_symbols);" | grep -i confidence
# → ...|confidence|REAL|1|1.0|...  (default 1.0 visible)
sqlite3 "$TMP/springkg.db" "PRAGMA table_info(spring_edges);" | grep -i confidence
# → ...|confidence|REAL|1|1.0|...

# 3. Verify indexes
sqlite3 "$TMP/springkg.db" ".indexes spring_symbols" | sort
# → idx_spring_symbols_codegraph_node_id
#   idx_spring_symbols_confidence
#   idx_spring_symbols_file_path
#   idx_spring_symbols_kind

# 4. Verify copy-assets produced the built schema
test -f packages/springkg-core/dist/db/springkg-schema.sql
diff packages/springkg-core/src/db/schema.sql packages/springkg-core/dist/db/springkg-schema.sql
# → exit 0 (no diff)
```

---

- [x] 3. [A] SpringDatabase wrapper (open `.codegraph/springkg.db`, WAL, migrations)

**What to do**:

Create `packages/springkg-core/src/db/spring-db.ts` exporting a `SpringDatabase` class.

**API** (mirrors `src/db/connection.ts:DatabaseConnection` but for `springkg.db`):

```typescript
export class SpringDatabase {
  static initialize(projectPath: string): SpringDatabase;   // creates new + applies migrations
  static open(projectPath: string): SpringDatabase;          // opens existing
  private constructor(...);

  getDb(): import('@colbymchenry/codegraph').SqliteDatabase; // re-exports shape, not the type
  getPath(): string;
  getJournalMode(): string;
  transaction<T>(fn: () => T): T;
  close(): void;
  isOpen(): boolean;

  /** Run all pending migrations. Idempotent. */
  runMigrations(): void;
}
```

Implementation:

1. **DB path** = `path.join(getCodeGraphDir(projectPath), SPRINGKG_CONFIG.db.filename)`. Use `getCodeGraphDir` from `@colbymchenry/codegraph` (re-exported in its public API; see `src/index.ts:64-69`). If `getCodeGraphDir` is not in the public re-exports, fall back to `path.join(projectPath, '.codegraph', SPRINGKG_CONFIG.db.filename)`.
2. **Open DB** with `createDatabase(dbPath)` from `@colbymchenry/codegraph` — but the public re-exports don't include it. Use the public `DatabaseConnection.initialize/open` only as a *reference* for PRAGMA order. **For springkg.db**, instantiate the same `SqliteDatabase` interface by calling the CodeGraph-internal `createDatabase` (acceptable because both DBs use the same `node:sqlite` backend — the wrapper just routes through CodeGraph's adapter factory).
   - **Pragmatic option (recommended)**: import `createDatabase` from `@colbymchenry/codegraph/dist/db/sqlite-adapter.js` (relative dist path). This is internal, but it's the same module the upstream uses for its own DB. Document the choice in a code comment.
   - **Hard guard**: if this import path doesn't exist after `npm install`, fall back to the constructor at `src/db/sqlite-adapter.ts` — but the cleanest path is to import it once via deep import.
3. **PRAGMAs** (in this exact order, matching `src/db/index.ts:30-38`):
   - `busy_timeout = 5000` (FIRST — must be set before journal_mode)
   - `foreign_keys = ON`
   - `journal_mode = WAL`
   - `synchronous = NORMAL`
   - `cache_size = -64000`
   - `temp_store = MEMORY`
4. **Schema load** (in `initialize`): read `path.join(__dirname, 'db', 'springkg-schema.sql')` — this is the file produced by `copy-assets` (Task 2). `db.exec(schema)`.
5. **Migration runner**: call `runMigrations()` (defined in Task 9). On first run, record the initial schema version in `schema_versions` (mirroring `src/db/index.ts:74-80`).
6. **Type import**: re-use the `SqliteDatabase` type from CodeGraph's public re-exports. If not exposed, declare a structural-compatible local type for our own use.

**Recommended Agent Profile**: `quick` (1) — direct port of the existing `DatabaseConnection` pattern.

**Parallelization**: Independent of Tasks 1, 2 (schema already in `dist/db/`). Depends on `createDatabase` import resolution (verify in QA Scenario #1).

**Acceptance Criteria**:

- [ ] `SpringDatabase.initialize(projectPath)` creates `.codegraph/springkg.db` with WAL mode active.
- [ ] `db.pragma('journal_mode')` returns `'wal'` (lowercased).
- [ ] `getJournalMode()` returns `'wal'`.
- [ ] `close()` is idempotent.
- [ ] Reopening an existing `springkg.db` (via `open`) preserves data and runs no duplicate migrations.

**QA Scenarios**:

```bash
# 1. Initialize in a temp project
TMP=$(mktemp -d)
node -e "import('./packages/springkg-core/dist/db/spring-db.js').then(async m => {
  const db = m.SpringDatabase.initialize('$TMP');
  console.log('journal:', db.getJournalMode());
  console.log('tables:', db.getDb().prepare(\"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name\").all().map(r => r.name).join(','));
  db.close();
})" --input-type=module
# → journal: wal
# → tables: feature_community_members,feature_communities,runtime_config_properties,schema_versions,spring_edges,spring_endpoints,spring_feign_clients,spring_sql_statements,spring_symbols

# 2. Reopen + idempotent
node -e "import('./packages/springkg-core/dist/db/spring-db.js').then(async m => {
  const a = m.SpringDatabase.initialize('$TMP');
  a.getDb().prepare('INSERT INTO spring_symbols (id, kind, codegraph_node_id) VALUES (?,?,?)').run('s:test:1','controller','cg:n:1');
  a.close();
  const b = m.SpringDatabase.open('$TMP');
  const n = b.getDb().prepare('SELECT COUNT(*) AS c FROM spring_symbols').get();
  console.log('rows after reopen:', n.c);  // → 1
  b.close();
})"

# 3. Verify WAL file appears
ls "$TMP/.codegraph/" | grep springkg
# → springkg.db
# → springkg.db-wal
# → springkg.db-shm
```

---

- [x] 4. [A] SpringKg orchestrator class (wraps CodeGraph + SpringDatabase + resolver chain)

**What to do**:

Create `packages/springkg-core/src/spring-kg.ts` exporting the `SpringKg` class — the public entry point for all other teams.

**API**:

```typescript
import type { Resolver, SpringKgEnhanceInput, SpringKgEnhanceOutput } from '@colbymchenry/springkg-shared';

export interface SpringKgOptions {
  projectPath: string;
  /** Initial resolvers (others can be added via registerResolver). */
  resolvers?: Resolver[];
  /** When true (default), enables the file watcher on init(). */
  autoWatch?: boolean;
}

export class SpringKg {
  static async open(options: SpringKgOptions): Promise<SpringKg>;     // opens existing
  static async init(options: SpringKgOptions): Promise<SpringKg>;      // creates + indexes
  private constructor(...);

  /** CodeGraph handle (read-only exposure to other teams). */
  readonly cg: import('@colbymchenry/codegraph').CodeGraph;

  /** SpringDB handle. */
  readonly db: import('./db/spring-db.js').SpringDatabase;

  /** Register a resolver (idempotent: same name re-registered replaces). */
  registerResolver(r: Resolver): void;

  /** Run all registered resolvers against current state + changed files. */
  async enhanceOnSync(paths: ReadonlyArray<string>): Promise<SpringKgEnhanceOutput[]>;

  /** Index the project (wraps CodeGraph.indexAll, then enhanceOnSync). */
  async index(): Promise<{ indexed: number; enhanced: SpringKgEnhanceOutput[] }>;

  /** Incremental sync (wraps CodeGraph.sync, then enhanceOnSync with changed files). */
  async sync(): Promise<SpringKgEnhanceOutput[]>;

  /** Start watcher. Uses CodeGraph.watch + bridges onSyncComplete → enhanceOnSync. */
  watch(opts?: import('@colbymchenry/codegraph').WatchOptions): boolean;

  /** Stop watcher. */
  unwatch(): void;

  /** Close CodeGraph + SpringDatabase. */
  async close(): Promise<void>;
}
```

**CRITICAL implementation details** (these are the footguns):

1. **`enhanceOnSync(paths)`** receives **absolute file paths** (a `string[]`), NOT a `SyncResult`. This is the contract.

2. **Watch callback bridging**: when calling `this.cg.watch(...)`, the `WatchOptions.onSyncComplete` callback gets `{ filesChanged, durationMs }` only — **no paths**. To know which files changed, **call `this.cg.getPendingFiles()`** (defined at `src/index.ts:617-619`, returns `PendingFile[]` from `src/sync/watcher.ts:206-219`). The `PendingFile` shape is:

   ```typescript
   interface PendingFile {
     path: string;          // project-relative POSIX
     firstSeenMs: number;
     lastSeenMs: number;
     indexing: boolean;
   }
   ```

   Map `PendingFile.path` → absolute path with `path.resolve(this.projectRoot, pf.path)` and pass to `enhanceOnSync(absPaths)`. **Do NOT invent a `changedFilePaths` field on the callback result — it doesn't exist in the real API.**

3. **Enhance input construction**: for each `enhanceOnSync(paths)` call, build `SpringKgEnhanceInput`:
   - `codegraphNodes`: query `cg.getNodesInFile(path)` for each `paths[i]`, deduplicate, freeze.
   - `codegraphEdges`: `cg.getEdgesForNodes(nodeIds)`, freeze.
   - `changedFiles`: the input array (absolute paths).
   - `cg`: pass a thin facade object exposing `{ getNode, getOutgoingEdges, getIncomingEdges, getNodesInFile }` so resolvers can't accidentally call mutating methods on CodeGraph.

4. **Resolver execution**: iterate `this.resolvers` in the order specified by `SPRINGKG_CONFIG.resolverChain` (look up each resolver's `name`). Catch per-resolver errors and log them — **one resolver failing MUST NOT block the others** (this is non-negotiable; a flaky SQL parser in Team C cannot take down the whole chain).

5. **Per-resolver timing**: log `name + durationMs + symbolsAdded + edgesAdded` at debug level. Aggregate into a single `SpringKgEnhanceOutput` for the watcher.

6. **Task 32/40/43/50 follow-ups**: Tasks 6–9 below ADD resolvers to `SPRINGKG_CONFIG.resolverChain` and CALL them in `enhanceOnSync`. Task 4 only builds the *dispatch loop* — it does not register any specific resolvers (those come from Teams B/C/D/F at runtime via `registerResolver`). The chain array exists in shared config as a *declaration of order*; the actual resolver instances are passed via `SpringKgOptions.resolvers` or `registerResolver` at startup.

7. **Index flow**: `index()` calls `await this.cg.indexAll()`, then `await this.enhanceOnSync([])` (empty paths — but resolvers still run because the enhance contract says "run on current state").

8. **Sync flow**: `sync()` calls `await this.cg.sync()`, then pulls the changed file paths from `cg.getChangedFiles()` (returns `{ added, modified, removed }` per `src/index.ts:632-635`) and passes the union to `enhanceOnSync`. For `removed` paths, still call `enhanceOnSync` so resolvers can prune their rows.

**Recommended Agent Profile**: `deep` (1) — this is the most contract-critical class. The errors here break every other team.

**Parallelization**: Hard-sequential after Tasks 2/3. Other teams cannot start without a working `SpringKg` skeleton.

**Acceptance Criteria**:

- [ ] `await SpringKg.init({ projectPath: '/tmp/demo' })` returns an instance with `cg` + `db` non-null.
- [ ] `registerResolver({ name: 'noop', enhance: async () => ({ symbolsAdded: 0, edgesAdded: 0, byKind: {} }) })` is idempotent (registering twice does not duplicate the resolver).
- [ ] `enhanceOnSync(['/abs/path/A.java'])`:
  - Builds an `SpringKgEnhanceInput` with `codegraphNodes` populated from `cg.getNodesInFile` for that path.
  - Calls each registered resolver exactly once.
  - A resolver that throws does not prevent other resolvers from running.
  - Returns one `SpringKgEnhanceOutput` per resolver, in registration order.
- [ ] `watch()` calls `cg.watch()` with a bridged `onSyncComplete` that uses `cg.getPendingFiles()` to get paths.
- [ ] `close()` closes both `cg` and `db`.

**QA Scenarios**:

```bash
# 1. Skeleton init (no resolvers)
TMP=$(mktemp -d)
mkdir -p "$TMP/src/main/java/com/example" && echo "package com.example; public class Foo {}" > "$TMP/src/main/java/com/example/Foo.java"
node -e "import('./packages/springkg-core/dist/spring-kg.js').then(async m => {
  const sk = await m.SpringKg.init({ projectPath: '$TMP', autoWatch: false });
  console.log('cg open:', sk.cg.isIndexing() === false || true);
  console.log('db journal:', sk.db.getJournalMode());
  await sk.close();
})" --input-type=module
# → cg open: true
# → db journal: wal

# 2. Resolver chain runs in order, one failure does not block
node -e "import('./packages/springkg-core/dist/spring-kg.js').then(async m => {
  const sk = await m.SpringKg.init({ projectPath: '$TMP', autoWatch: false });
  sk.registerResolver({ name: 'ok1', enhance: async () => ({ symbolsAdded: 1, edgesAdded: 0, byKind: { controller: 1 } }) });
  sk.registerResolver({ name: 'bad', enhance: async () => { throw new Error('boom'); } });
  sk.registerResolver({ name: 'ok2', enhance: async () => ({ symbolsAdded: 2, edgesAdded: 1, byKind: { service: 2 } }) });
  const out = await sk.enhanceOnSync([]);
  console.log('results:', out.length, 'first.symbolsAdded:', out[0].symbolsAdded);
  // Expect: results: 3, first.symbolsAdded: 1
  await sk.close();
})"

# 3. Watcher uses getPendingFiles (not a fabricated changedFilePaths)
# Run with a tiny fixture, modify a file, wait, assert getPendingFiles was read.
# (See __tests__/team-a/spring-kg-watcher.test.ts for the full test.)
```

---

- [x] 5. [A] Wire Team B resolvers into enhanceOnSync (annotation → endpoint → feign → config → middleware → mybatis-xml → annotation-sql → sql-table-column → mapper-binding → mybatis-plus)

**What to do**:

Extend `enhanceOnSync` (Task 4) so that the **declared** order in `SPRINGKG_CONFIG.resolverChain` is enforced at runtime. Specifically: when a resolver whose `name` matches an entry in `resolverChain` is registered, it executes in that position. Resolvers with names NOT in the chain run after chain resolvers (fallback), in registration order.

**In Task 4, the dispatcher should already use `SPRINGKG_CONFIG.resolverChain` as the canonical order.** If Task 4 used a simpler "registration order" fallback, upgrade it here.

This task's actual deliverable is **integration plumbing** — the 10 resolvers themselves are stubs owned by Teams B/C/D. The plumbing we own:

1. **Pipeline segmentation** (the order in `SPRINGKG_CONFIG.resolverChain` is already the source of truth — confirm and document the segmentation):
   - **Stage 1 (Team B, semantic)**: `annotation-engine`, `endpoint-resolver`, `feign-resolver`
   - **Stage 2 (Team D, runtime infra)**: `config-resolver`, `middleware-inventory`
   - **Stage 3 (Team C, data)**: `mybatis-xml-extractor`, `annotation-sql-extractor`, `sql-table-column`, `mapper-binding`, `mybatis-plus`
2. **Per-stage timing** in logs: `enhanceOnSync` should emit a log line per stage (start, end + duration + aggregate counts).
3. **Stage isolation**: if Stage 1 fails entirely, do NOT proceed to Stage 2/3. If a single resolver in a stage fails, continue with siblings in the same stage, then proceed. (This protects Teams C/D from being blocked by a Team B bug.)
4. **Idempotency on re-enhance**: when `enhanceOnSync` is called twice with the same `changedFiles`, the total `symbolsAdded` second time should be ≤ first (only deltas). Resolvers own their delta logic; we just expose a `since: number` (ms epoch) in `SpringKgEnhanceInput` derived from the last successful `enhanceOnSync` call. Add a private `lastEnhanceAt: number` field on `SpringKg`.

**Recommended Agent Profile**: `unspecified-high` (1) — small but cross-cutting.

**Parallelization**: This task modifies `spring-kg.ts` from Task 4 — must be merged before Team B starts (or at least before Team B can run end-to-end tests). Sequentially after Task 4.

**Acceptance Criteria**:

- [ ] `SPRINGKG_CONFIG.resolverChain` lists all 10 resolver names in the order specified.
- [ ] When a registered resolver's name is in `resolverChain`, it runs at its declared position.
- [ ] A failure in Stage 1 (e.g. all 3 Team B resolvers throw) prevents Stage 2/3 from running.
- [ ] A single resolver failure within a stage does NOT block siblings.
- [ ] `SpringKgEnhanceInput.since` is populated with the epoch ms of the previous `enhanceOnSync` call (or `0` on first call).
- [ ] `lastEnhanceAt` is updated to `Date.now()` after a successful (or partial) `enhanceOnSync`.

**QA Scenarios**:

```bash
# 1. Resolver order is enforced
node -e "import('./packages/springkg-core/dist/spring-kg.js').then(async m => {
  const sk = await m.SpringKg.init({ projectPath: '$(mktemp -d)', autoWatch: false });
  const order = [];
  sk.registerResolver({ name: 'mapper-binding', enhance: async () => { order.push('mapper-binding'); return { symbolsAdded: 0, edgesAdded: 0, byKind: {} }; } });
  sk.registerResolver({ name: 'annotation-engine', enhance: async () => { order.push('annotation-engine'); return { symbolsAdded: 0, edgesAdded: 0, byKind: {} }; } });
  await sk.enhanceOnSync([]);
  console.log(order.join(','));
  // → annotation-engine,mapper-binding
  await sk.close();
})"

# 2. Stage-1 hard failure skips Stages 2/3
# (covered in __tests__/team-a/enhance-stages.test.ts)
```

---

- [x] 6. [A] Add Team D late resolvers (NacosConfigResolver, ConfigPropertyUsageTracker, GatewayRouteResolver)

**What to do**:

Add the 3 late Stage-2 resolvers to the **declaration** in `SPRINGKG_CONFIG.resolverChain` (Task 5's `packages/springkg-shared/src/index.ts`). The actual resolver implementations are Team D's responsibility — Team A only owns the contract and the order.

1. Append to the `resolverChain` const array (in the **runtime** segment, after `middleware-inventory`):
   - `nacos-config-resolver`
   - `config-property-usage-tracker`
   - `gateway-route-resolver`
2. Confirm the dispatcher (Task 5) picks them up at the right position.
3. **No code changes to `spring-kg.ts`** beyond what's required for ordering — the existing dispatcher already handles this. This task is primarily a `springkg-shared` change + a one-line integration test.

**Edge case** (note for Team D, not for us to implement): `config-property-usage-tracker` must run AFTER both `config-resolver` and `annotation-engine` (so it can correlate `@Value` usages with the resolved property keys). The chain order in `SPRINGKG_CONFIG.resolverChain` already reflects this — verify and document in a comment.

**Recommended Agent Profile**: `quick` (1) — one-line shared-config change.

**Parallelization**: Independent of Tasks 7/8/9 (they each touch the same `resolverChain` const). **All four Tasks 5/6/7/8 MUST land in the same commit** to avoid merge conflicts on `springkg-shared`. Coordinate with the team lead before merging.

**Acceptance Criteria**:

- [ ] `SPRINGKG_CONFIG.resolverChain` includes `nacos-config-resolver`, `config-property-usage-tracker`, `gateway-route-resolver` in the order: `middleware-inventory → nacos-config-resolver → config-property-usage-tracker → gateway-route-resolver`.
- [ ] A unit test in `__tests__/team-a/resolver-chain.test.ts` asserts the chain contains all 18 names (10 from Task 5 + 3 from Task 6 + 2 from Task 7 + 1 from Task 8 = 16, plus the 2 from Team B added in Task 5; total = 18).

**QA Scenarios**:

```bash
node -e "import('./packages/springkg-shared/dist/index.js').then(m => {
  const idx = (n) => m.SPRINGKG_CONFIG.resolverChain.indexOf(n);
  console.log('nacos after middleware:', idx('nacos-config-resolver') > idx('middleware-inventory'));
  console.log('usage-tracker after config-resolver:', idx('config-property-usage-tracker') > idx('config-resolver'));
  console.log('total resolvers:', m.SPRINGKG_CONFIG.resolverChain.length);
})"
# → nacos after middleware: true
# → usage-tracker after config-resolver: true
# → total resolvers: 18  (or 19 if F's community-builder already added)
```

---

- [x] 7. [A] Add Team B late resolvers (FeignProviderBridge, FeignRequestResponseType)

**What to do**:

Append to `SPRINGKG_CONFIG.resolverChain` in the Team B stage:

- `feign-provider-bridge` (after `feign-resolver`, before Stage 2)
- `feign-request-response-type` (immediately after `feign-provider-bridge`)

Same as Task 6: this is a `springkg-shared` change only. Implementations are Team B's. The chain order is already the source of truth — verify in the integration test.

**Recommended Agent Profile**: `quick` (1).

**Parallelization**: Must land in the same commit as Tasks 5/6/8 (see Task 6 note).

**Acceptance Criteria**:

- [ ] `SPRINGKG_CONFIG.resolverChain` includes `feign-provider-bridge` and `feign-request-response-type` in the correct positions.
- [ ] Chain order: `feign-resolver → feign-provider-bridge → feign-request-response-type → config-resolver → ...`.

**QA Scenarios**:

```bash
node -e "import('./packages/springkg-shared/dist/index.js').then(m => {
  const c = m.SPRINGKG_CONFIG.resolverChain;
  console.log(c.indexOf('feign-resolver') < c.indexOf('feign-provider-bridge'));
  console.log(c.indexOf('feign-provider-bridge') < c.indexOf('feign-request-response-type'));
  console.log(c.indexOf('feign-request-response-type') < c.indexOf('config-resolver'));
})"
# → all three lines: true
```

---

- [x] 8. [A] Add Team F community resolver (CommunityBuilder + async SummaryGenerator)

**What to do**:

This is a two-part change:

**Part 1 — `springkg-shared`**: append to `resolverChain` (in Team F's slot, after the last Team C resolver):

- `community-builder` — runs synchronously after the per-file resolvers. It groups `spring_symbols` into `feature_communities` and marks them `dirty=1` (the table schema from Task 2 has the `dirty` column for this).

**Part 2 — `springkg-core`**: implement the **async** `SummaryGenerator`:

1. `packages/springkg-core/src/community/summary-generator.ts` — `class SummaryGenerator`:
   - Constructor takes `SpringDatabase`.
   - `start()`: starts a `setInterval` timer with `SPRINGKG_CONFIG.summaryRegeneration.intervalMs` (60s).
   - `stop()`: clears the interval.
   - `regenerateIfDirty()`: scans `feature_communities WHERE dirty=1`, calls a `summarize(community) => string` hook (Team F provides the default; we ship a stub that returns `'(summary pending)'`), writes back to `summary` and sets `dirty=0`, `last_summarized_at=now`. **Never blocks the resolver chain** — the resolver only sets `dirty=1`.
   - `regenerateNow()`: synchronous regeneration (used by `springkg rebuild-community` CLI in Task 13's later delivery).
2. `SpringKg` owns one `SummaryGenerator` instance; starts it in `init()` (or on first `enhanceOnSync` call), stops it in `close()`.
3. **Manual trigger**: `SpringKg.summarizeNow(): Promise<void>` — exposed for Team G's CLI.

**Critical**: the resolver `community-builder` only sets `dirty=1`. The `SummaryGenerator` is async and runs on its own timer. **The resolver chain MUST NOT wait for summaries** — summaries are decoupled.

**Recommended Agent Profile**: `unspecified-high` (1) — modest but cross-cutting (shared + core + a new file).

**Parallelization**: Must land in the same commit as Tasks 5/6/7 (see Task 6 note).

**Acceptance Criteria**:

- [ ] `SPRINGKG_CONFIG.resolverChain` includes `community-builder` as the last entry.
- [ ] `SummaryGenerator.start()` runs without throwing; `stop()` clears the interval (no leaked timer).
- [ ] `regenerateIfDirty()` processes all `dirty=1` communities; sets `dirty=0`, `last_summarized_at` to a recent ms.
- [ ] `SpringKg.close()` calls `SummaryGenerator.stop()` before closing the DB.
- [ ] The resolver `community-builder` is registered as a stub in `SpringKg` so the chain doesn't blow up when Team F's real implementation isn't ready (default behavior: count `feature_community` rows but don't add anything if Team F hasn't landed).

**QA Scenarios**:

```bash
# 1. SummaryGenerator timer lifecycle
node -e "import('./packages/springkg-core/dist/community/summary-generator.js').then(async m => {
  // create db
  const TMP = require('os').tmpdir() + '/sg-test-' + Date.now();
  require('fs').mkdirSync(TMP, { recursive: true });
  const db = (await import('./packages/springkg-core/dist/db/spring-db.js')).SpringDatabase.initialize(TMP);
  db.getDb().prepare('INSERT INTO feature_communities (id, label, summary, member_count, dirty) VALUES (?,?,?,?,?)')
    .run('fc:1', 'Test', '', 0, 1);
  const sg = new m.SummaryGenerator(db);
  sg.start();
  await new Promise(r => setTimeout(r, 100));   // give it a tick
  await sg.regenerateIfDirty();
  sg.stop();
  const row = db.getDb().prepare('SELECT dirty, last_summarized_at FROM feature_communities WHERE id=?').get('fc:1');
  console.log('dirty:', row.dirty, 'lastSummarizedAt set:', row.last_summarized_at > 0);
  db.close();
})"
# → dirty: 0, lastSummarizedAt set: true
```

---

- [x] 9. [A] Migration runner (Metis C2)

**What to do**:

Create `packages/springkg-core/src/db/migrations.ts` — the migration runner that `SpringDatabase` calls on `initialize` and `open`.

**Design** (mirroring `src/db/migrations.ts` for consistency):

1. **`schema_versions` table** is already in the schema (Task 2). On `initialize`:
   - Read all `.sql` files in `path.join(__dirname, 'migrations')` (alphabetical).
   - For each file named `NNN_*.sql` where `NNN` is a numeric prefix: parse the version as `parseInt(NNN, 10)`.
   - Compare to the highest `version` in `schema_versions`. If `NNN > current`, apply the SQL and `INSERT INTO schema_versions (version, applied_at, description) VALUES (?, ?, ?)`.
2. **File format**: each migration file is plain SQL — multiple statements OK. The runner concatenates all and runs in a transaction.
3. **Initial migration**: `packages/springkg-core/src/db/migrations/001_initial_8_tables.sql` — copy of the 8 tables from `schema.sql` (sans the `schema_versions` bookkeeping). This makes `schema_versions` the SOURCE OF TRUTH for what's been applied, not the bare `schema.sql` (which uses `IF NOT EXISTS` for idempotency on open but isn't a true migration).
4. **Idempotency**: re-running `runMigrations` on a fresh DB inserts version 1. Re-running on a DB at version 1 does nothing.
5. **Exported API**:
   ```typescript
   export function runMigrations(db: SqliteDatabase): void;
   export function getCurrentVersion(db: SqliteDatabase): number;
   export const CURRENT_SCHEMA_VERSION: number;     // = 1 initially
   ```
6. **Asset copy**: add to `packages/springkg-core/package.json` `scripts.copy-assets`:
   ```jsonc
   "copy-assets": "... && copyDir('src/db/migrations', 'dist/db/migrations')"
   ```
   so the migration files ship with the built artifact.

**Recommended Agent Profile**: `quick` (1) — direct port of CodeGraph's pattern.

**Parallelization**: Independent of Tasks 1–8 (only the `schema.sql` consumer). Can land any time after Task 2.

**Acceptance Criteria**:

- [ ] `packages/springkg-core/src/db/migrations/001_initial_8_tables.sql` exists, contains the 8 tables from Task 2 (without `schema_versions`).
- [ ] `runMigrations(db)` is idempotent (running twice on the same DB yields no error and no duplicate rows in `schema_versions`).
- [ ] On a fresh DB, `schema_versions` has exactly one row (`version=1, applied_at>0`).
- [ ] On a DB at version 1, `runMigrations` is a no-op.

**QA Scenarios**:

```bash
# 1. Fresh DB → schema_versions has version 1
TMP=$(mktemp -d)
node -e "import('./packages/springkg-core/dist/db/spring-db.js').then(async m => {
  const db = m.SpringDatabase.initialize('$TMP');
  const row = db.getDb().prepare('SELECT * FROM schema_versions').get();
  console.log(JSON.stringify(row));
  db.close();
})"
# → {"version":1,"applied_at":<ms>,"description":"Initial 8 tables for springkg.db"}

# 2. Re-init: no duplicate
node -e "import('./packages/springkg-core/dist/db/spring-db.js').then(async m => {
  const db = m.SpringDatabase.initialize('$TMP');
  const n = db.getDb().prepare('SELECT COUNT(*) AS c FROM schema_versions').get();
  console.log('count:', n.c);  // → 1
  db.close();
})"
```

---

- [x] 10. [A] `springkg-installer` scaffold (registry, types, claude target)

**What to do**:

Scaffold `packages/springkg-installer/` modeled on `src/installer/`:

1. `packages/springkg-installer/src/targets/types.ts`:
   ```typescript
   export type Location = 'global' | 'local';
   export type SpringkgTargetId = 'claude' | 'cursor' | 'opencode';   // Phase 1: 3 targets
   export interface DetectionResult { installed: boolean; alreadyConfigured: boolean; configPath?: string; }
   export interface WriteResult { files: Array<{ path: string; action: 'created' | 'updated' | 'unchanged' | 'removed' | 'not-found' | 'kept'; }>; notes?: string[]; }
   export interface InstallOptions { autoAllow: boolean; }
   export interface SpringkgAgentTarget {
     readonly id: SpringkgTargetId;
     readonly displayName: string;
     readonly docsUrl?: string;
     supportsLocation(loc: Location): boolean;
     detect(loc: Location): DetectionResult;
     install(loc: Location, opts: InstallOptions): WriteResult;
     uninstall(loc: Location): WriteResult;
     printConfig(loc: Location): string;
     describePaths(loc: Location): string[];
   }
   ```

2. `packages/springkg-installer/src/targets/registry.ts`:
   ```typescript
   import type { SpringkgAgentTarget, Location, SpringkgTargetId } from './types.js';
   import { claudeTarget } from './claude.js';
   import { cursorTarget } from './cursor.js';     // Team E will fill in
   import { opencodeTarget } from './opencode.js'; // Team E will fill in
   export const ALL_TARGETS: ReadonlyArray<SpringkgAgentTarget> = Object.freeze([
     claudeTarget, cursorTarget, opencodeTarget,
   ]);
   export function getTarget(id: string): SpringkgAgentTarget | undefined { ... }
   export function listTargetIds(): SpringkgTargetId[] { ... }
   export function detectAll(loc: Location): Array<{...}> { ... }
   export function resolveTargetFlag(value: string, loc: Location): SpringkgAgentTarget[] { ... }
   ```
   Team A ships `claude.ts` (real). `cursor.ts` and `opencode.ts` are stubs (Phase 1 only needs claude working — Team E will replace the stubs with real impls in Sprint 1).

3. `packages/springkg-installer/src/targets/claude.ts`:
   - `mcpJsonPath(loc)`: global → `~/.claude.json`; local → `./.mcp.json` (mirror CodeGraph's `src/installer/targets/claude.ts:49-56`).
   - `install`: write `{ mcpServers: { springkg: { type: 'stdio', command: 'springkg', args: ['serve', '--mcp'] } } }` (the **springkg** binary, not `codegraph`).
   - `uninstall`: surgically remove `mcpServers.springkg` from the same file; preserve siblings.
   - **Idempotency**: re-running `install` with no changes should report `action: 'unchanged'` (byte-equal), matching the upstream pattern.
   - `getMcpServerConfig()` helper exported from `shared.ts` (parallel to CodeGraph's `getMcpServerConfig` at `src/installer/targets/shared.ts:24-30`).

4. **Cursor + opencode stubs** (so `resolveTargetFlag('all')` doesn't crash):
   ```typescript
   // packages/springkg-installer/src/targets/cursor.ts
   export const cursorTarget: SpringkgAgentTarget = {
     id: 'cursor',
     displayName: 'Cursor',
     supportsLocation: () => false,        // Team E implements
     detect: () => ({ installed: false, alreadyConfigured: false }),
     install: () => ({ files: [{ path: '(stub)', action: 'not-found' }] }),
     uninstall: () => ({ files: [] }),
     printConfig: () => '// Team E will implement',
     describePaths: () => [],
   };
   ```

**Recommended Agent Profile**: `unspecified-high` (1) — mirror of existing code, not a new design.

**Parallelization**: Independent of Tasks 11–15. Can land first.

**Acceptance Criteria**:

- [ ] `packages/springkg-installer/src/targets/{types,registry,claude}.ts` exist.
- [ ] `claudeTarget.install('global', { autoAllow: false })` writes to `~/.claude.json` adding `mcpServers.springkg`.
- [ ] `claudeTarget.uninstall('global')` removes only the `springkg` key; other MCP servers in the same file are preserved.
- [ ] Calling `install` twice in a row returns `action: 'unchanged'` for the second call.
- [ ] `cursor.ts` and `opencode.ts` stubs compile and return `not-found` actions.

**QA Scenarios**:

```bash
# 1. Install + verify ~/.claude.json
TMPHOME=$(mktemp -d)
HOME=$TMPHOME node -e "import('./packages/springkg-installer/dist/targets/claude.js').then(m => {
  console.log(JSON.stringify(m.claudeTarget.install('global', { autoAllow: false })));
})"
cat "$TMPHOME/.claude.json" | python3 -m json.tool
# → { "mcpServers": { "springkg": { "type": "stdio", "command": "springkg", "args": ["serve", "--mcp"] } } }

# 2. Uninstall preserves siblings
HOME=$TMPHOME node -e "import('./packages/springkg-installer/dist/targets/claude.js').then(m => {
  // Pre-populate with a sibling
  const fs = require('fs'); const path = require('path');
  const p = path.join('$TMPHOME', '.claude.json');
  fs.writeFileSync(p, JSON.stringify({ mcpServers: { other: { type: 'stdio', command: 'x', args: [] } } }));
  m.claudeTarget.install('global', { autoAllow: false });
  m.claudeTarget.uninstall('global');
  console.log(fs.readFileSync(p, 'utf-8'));
})"
# → { "mcpServers": { "other": ... } }   (sibling preserved)

# 3. Idempotent re-install
HOME=$TMPHOME node -e "import('./packages/springkg-installer/dist/targets/claude.js').then(m => {
  const a = m.claudeTarget.install('global', { autoAllow: false });
  const b = m.claudeTarget.install('global', { autoAllow: false });
  console.log(b.files[0].action);  // → unchanged
})"
```

---

- [x] 11. [A] `springkg install` / `springkg uninstall` CLI (Metis C5)

**What to do**:

Add the `springkg` CLI binary in `packages/springkg-cli/` (Team E owns the bulk of this package, but Task 11 adds the install/uninstall subcommands — the only ones Team A owns).

**Scope** (Team A's portion):

1. `packages/springkg-cli/src/commands/install.ts`:
   ```typescript
   import { ALL_TARGETS, resolveTargetFlag } from '@colbymchenry/springkg-installer';
   import { runInstallerWithOptions } from '@colbymchenry/springkg-installer';   // from Task 10
   ```
   (Team A owns this — it's the only piece of `springkg-cli` we ship in Phase 1. Other commands are Team E's.)
2. Flag parsing (commander, already a dep of CodeGraph):
   - `--target <list>` (csv; values: `claude,cursor,opencode,auto,all,none`).
   - `--location <global|local>` (default: `global`).
   - `--yes` (skip prompts, non-interactive).
   - `--print-config <id>` (dump snippet, no filesystem writes).
3. `springkg uninstall` mirrors `install` — same flags; iterates `resolveTargetFlag(...)` and calls `target.uninstall(loc, opts)`.
4. Exit codes: 0 on success, 1 on invalid target id, 1 on no targets to install (`--target=none` is a no-op with exit 0).
5. `package.json` `bin`: `"springkg": "./dist/bin/springkg.js"`. The bin script invokes the commander program.

**Recommended Agent Profile**: `unspecified-high` (1) — moderate but mechanical (parallels `src/installer/index.ts`).

**Parallelization**: Depends on Task 10 (the targets). Sequentially after Task 10.

**Acceptance Criteria**:

- [ ] `springkg install --target=claude --yes --location=global` writes `~/.claude.json` adding `mcpServers.springkg` (test with a temp `$HOME`).
- [ ] `springkg install --target=none --yes` exits 0 with no file changes.
- [ ] `springkg install --target=bogus` exits 1 with "Unknown --target id" message.
- [ ] `springkg uninstall --target=claude --yes` removes the `springkg` entry; siblings preserved.
- [ ] `springkg install --print-config=claude` prints the snippet and exits 0 with no file changes.

**QA Scenarios**:

```bash
# 1. End-to-end install in a temp HOME
TMPHOME=$(mktemp -d)
PATH="$(pwd)/packages/springkg-cli/dist/bin:$PATH" HOME=$TMPHOME \
  node ./packages/springkg-cli/dist/bin/springkg.js install --target=claude --yes
test -f "$TMPHOME/.claude.json" && cat "$TMPHOME/.claude.json" | python3 -m json.tool

# 2. Print config (no file writes)
PATH="$(pwd)/packages/springkg-cli/dist/bin:$PATH" HOME=$TMPHOME \
  node ./packages/springkg-cli/dist/bin/springkg.js install --print-config=claude
# → outputs a JSON snippet, ~/.claude.json not created

# 3. Uninstall
PATH="$(pwd)/packages/springkg-cli/dist/bin:$PATH" HOME=$TMPHOME \
  node ./packages/springkg-cli/dist/bin/springkg.js uninstall --target=claude --yes
cat "$TMPHOME/.claude.json" 2>/dev/null || echo "(file absent or empty)"
```

---

- [x] 12. [A] WAL mode + concurrent-access verification (Metis M)

**What to do**:

Two verification tests in `__tests__/team-a/concurrent-wal.test.ts` (the Metis M acceptance gate).

**Test 1 — WAL active**:
- Open a fresh `springkg.db` via `SpringDatabase.initialize(tmpDir)`.
- Assert `db.getJournalMode() === 'wal'`.
- Assert `db.getDb().pragma('journal_mode')` returns an object/row whose `journal_mode` is `'wal'` (lowercased).
- Skip the test (with a console warning) if the platform can't enable WAL (rare, but possible on WSL2 `/mnt`).

**Test 2 — Concurrent writes don't throw "database is locked"**:
- Open the SAME `springkg.db` file with TWO `SpringDatabase` instances (a writer and a writer).
- The first writer holds a transaction (`BEGIN IMMEDIATE`); the second writer attempts an `INSERT`.
- Assert the second writer waits (via `busy_timeout=5000`) and succeeds, OR throws a non-"database is locked" error (a SQLite "BUSY" error that respects `busy_timeout` is acceptable; a hard "database is locked" from `node:sqlite` indicates the timeout didn't kick in).
- Model this test on `__tests__/concurrent-locking.test.ts:68-90` (the existing CodeGraph test). Same patterns apply.

**Recommended Agent Profile**: `quick` (1) — tests, not implementation.

**Parallelization**: Independent of Tasks 13/14/15. Can land any time after Task 3.

**Acceptance Criteria**:

- [ ] `__tests__/team-a/concurrent-wal.test.ts` exists, 2+ test cases, all pass on `npm test`.
- [ ] WAL assertion runs on macOS dev machine and passes (the platform the test suite runs on by default).
- [ ] The concurrent-write test takes < 6 seconds (the busy_timeout cap).
- [ ] The test is correctly skipped (not failed) on platforms where WAL cannot be enabled.

**QA Scenarios**:

```bash
# 1. Run the WAL test in isolation
npx vitest run __tests__/team-a/concurrent-wal.test.ts -t "WAL"
# → 1 passed

# 2. Run the concurrent test
npx vitest run __tests__/team-a/concurrent-wal.test.ts -t "concurrent"
# → 1 passed

# 3. Run all team-a tests
npx vitest run __tests__/team-a/
# → all passed, 0 failed
```

---

- [x] 13. [A] confidence column on spring_symbols + spring_edges (Metis M, T70)

**What to do**:

This task is **partially subsumed by Task 2** (the schema already includes `confidence REAL DEFAULT 1.0` on both tables). The Metis M acceptance gate requires:

1. A test in `__tests__/team-a/schema-confidence.test.ts` that:
   - Initializes a `SpringDatabase`.
   - Reads `PRAGMA table_info(spring_symbols)` and asserts `name='confidence'`, `type='REAL'`, `dflt_value='1.0'`.
   - Same for `spring_edges`.
   - Inserts a row WITHOUT specifying `confidence` and asserts the resulting row has `confidence=1.0`.
2. A test that demonstrates the column is USED end-to-end (i.e. a fake resolver writes a low-confidence row, the next resolver run reads it back, the value is preserved).
3. **Documentation note** in `packages/springkg-shared/src/index.ts` — add a one-line JSDoc on `SpringKgNode.confidence` and `SpringKgEdge.confidence`:
   ```typescript
   /** Confidence score 0.0-1.0. Defaults to 1.0 (deterministic). Resolvers that rely on heuristics should set < 1.0. */
   confidence: number;
   ```

**Recommended Agent Profile**: `quick` (1) — tests + a comment.

**Parallelization**: Must land in the same commit as Task 2 (or be rebased onto it).

**Acceptance Criteria**:

- [ ] `__tests__/team-a/schema-confidence.test.ts` exists, all 3 test cases pass.
- [ ] JSDoc comment on `confidence` in `springkg-shared` references "heuristic" and the default value `1.0`.

**QA Scenarios**:

```bash
npx vitest run __tests__/team-a/schema-confidence.test.ts
# → 3 passed (column-exists, default-value, round-trip)
```

---

- [x] 14. [A] `__tests__/setup.ts` — platform detection helpers (Metis M)

**What to do**:

Create `__tests__/setup.ts` (used by all teams' tests via the `setupFiles` array in `vitest.config.ts`).

**Exports**:

```typescript
// __tests__/setup.ts
import { afterEach, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const isWindows = process.platform === 'win32';
export const isMacOS = process.platform === 'darwin';
export const isLinux = process.platform === 'linux';
export const isPosix = !isWindows;

/**
 * Run a test ONLY on Windows. Pattern: it.runIf(isWindows)('description', async () => {...})
 *   - Pairs with vitest's built-in `it.runIf(condition)`.
 *   - The `isWindows` here is also exported for use in `if (isWindows)` branches inside tests.
 */
export const platformGate = {
  windows: isWindows,
  posix: isPosix,
  macos: isMacOS,
  linux: isLinux,
};

/**
 * Helper to make a temp directory and register cleanup. Usage:
 *   const tmp = makeTmpDir('springkg-test-');
 *   afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));
 */
export function makeTmpDir(prefix = 'springkg-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Helper: get a path inside a temp dir.
 */
export function tmpPath(dir: string, ...parts: string[]): string {
  return path.join(dir, ...parts);
}

/**
 * Set HOME to a temp dir for the duration of a test (so installer tests don't touch the real ~).
 * Usage:
 *   const restore = setTmpHome();
 *   afterEach(restore);
 */
export function setTmpHome(): () => void {
  const realHome = process.env.HOME;
  const tmp = makeTmpDir('springkg-home-');
  process.env.HOME = tmp;
  return () => {
    if (realHome === undefined) delete process.env.HOME;
    else process.env.HOME = realHome;
  };
}
```

Update `vitest.config.ts` to add `setupFiles: ['./__tests__/setup.ts']`.

Add 3+ **Windows-gated** test cases to demonstrate the pattern (modeled on the existing CodeGraph tests using `it.runIf`):

- `__tests__/team-a/platform-paths.test.ts`:
  - `it.runIf(isWindows)('resolves %APPDATA% to a real path on Windows', ...)` — verifies `path.join(os.homedir(), '.claude.json')` resolves to something like `C:\Users\...\AppData\Roaming\.claude.json` or similar.
  - `it.runIf(!isWindows)('does not throw when checking /etc/.claude.json (POSIX sensitive path)', ...)` — guards against the inverse failure mode (POSIX-only assertion running on Windows and failing because `C:\etc\.claude.json` doesn't exist).
  - `it.runIf(isWindows)('uses CRLF-aware line endings in installed JSON files', ...)` — verifies the installer writes files that survive Windows line-ending handling.

**Recommended Agent Profile**: `quick` (1) — boilerplate + 3 simple tests.

**Parallelization**: Independent of all other tasks. Land first so other teams can import the helpers.

**Acceptance Criteria**:

- [ ] `__tests__/setup.ts` exports `platformGate`, `makeTmpDir`, `tmpPath`, `setTmpHome`.
- [ ] `vitest.config.ts` includes `setupFiles: ['./__tests__/setup.ts']`.
- [ ] `__tests__/team-a/platform-paths.test.ts` has 3+ Windows-gated test cases, all pass on `npm test`.
- [ ] Tests using `it.runIf(isWindows)` are correctly skipped (not failed) on non-Windows platforms.

**QA Scenarios**:

```bash
# 1. Setup file loads
npx vitest run __tests__/team-a/platform-paths.test.ts
# → all platform-gated tests skipped (macOS dev) or passed (Windows dev)

# 2. Helpers importable from any team
node -e "import('./__tests__/setup.js').then(m => console.log(typeof m.makeTmpDir, typeof m.platformGate))"
# → function object
```

---

- [x] 15. [A] Root package.json peer-dep + per-package inter-deps (Metis M, T72)

**What to do**:

Wire the dependency graph in `package.json` (root) and the 9 sub-package `package.json`s.

**Root `package.json`** (add to existing):

```jsonc
{
  "workspaces": ["packages/*"],
  "peerDependencies": {
    "@colbymchenry/codegraph": ">=0.9.0 <1.0.0"
  },
  "devDependencies": {
    // ...existing
  }
}
```

**Per-package `package.json` inter-deps** (only the ones we own — Team A):

| Package | depends on | devDeps |
|---|---|---|
| `springkg-shared` | (none) | `typescript` |
| `springkg-core` | `@colbymchenry/springkg-shared` (workspace:*) | `@colbymchenry/codegraph` (peer) |
| `springkg-installer` | `@colbymchenry/springkg-shared` (workspace:*) | `@colbymchenry/codegraph` (peer, for `getCodeGraphDir` if needed) |
| `springkg-semantic` (scaffold) | `@colbymchenry/springkg-shared` (workspace:*) | `@colbymchenry/codegraph` (peer) |
| `springkg-data` (scaffold) | same | same |
| `springkg-runtime` (scaffold) | same | same |
| `springkg-community` (scaffold) | same | same |
| `springkg-mcp` (scaffold) | same | same |
| `springkg-cli` (scaffold + Task 11's install cmd) | `@colbymchenry/springkg-shared`, `@colbymchenry/springkg-installer` | `@colbymchenry/codegraph` (peer) |

**Critical constraints**:

- `springkg-shared` has ZERO runtime deps on `@colbymchenry/codegraph` — it can be imported by tests, by code that doesn't use CodeGraph, by docs. The shared types are pure TypeScript.
- `springkg-core` declares `@colbymchenry/codegraph` as a `peerDependency` (NOT a regular `dependency`) — the host project supplies it. This is the canonical pattern (CodeGraph itself uses peer deps for its native `node:sqlite`).
- Use `workspace:*` (npm 7+ workspaces protocol) for intra-monorepo references. Do NOT use file:../ paths.
- **Verify `npm install` produces 0 ERESOLVE / 0 peer-dep warnings**.

**Recommended Agent Profile**: `quick` (1) — pure config.

**Parallelization**: Independent of all other tasks. Land LAST (after Tasks 1-14 ship, so the version constraints in the package.json are realistic).

**Acceptance Criteria**:

- [ ] Root `package.json` has `peerDependencies["@colbymchenry/codegraph"]: ">=0.9.0 <1.0.0"`.
- [ ] `packages/springkg-shared/package.json` has no `dependencies` field (only `devDependencies`).
- [ ] `packages/springkg-core/package.json` has `@colbymchenry/codegraph` as `peerDependency`, not `dependency`.
- [ ] `npm install` from root exits 0 with 0 ERESOLVE errors and 0 peer-dep warnings (verify with `npm install --dry-run` first).
- [ ] `npx tsc -b` succeeds across all 9 packages (or, for Phase 1, across the 3 Team A owns + scaffolds build cleanly).

**QA Scenarios**:

```bash
# 1. Clean install, verify 0 conflicts
rm -rf node_modules packages/*/node_modules package-lock.json
npm install
# → exit 0, 0 ERESOLVE

# 2. Check no peer-dep warnings
npm install --dry-run 2>&1 | grep -i "WARN\|ERESOLVE" | wc -l
# → 0

# 3. Verify springkg-shared has no runtime deps
node -e "const p = require('./packages/springkg-shared/package.json'); console.log(Object.keys(p.dependencies || {}).length)"
# → 0

# 4. Verify springkg-core uses peerDep
node -e "const p = require('./packages/springkg-core/package.json'); console.log(p.peerDependencies)"
# → { '@colbymchenry/codegraph': '>=0.9.0 <1.0.0' }
```

---

## 6. Sync Points (when Team A unblocks other teams)

| Phase | Team A deliverable | Teams unblocked | Gate criteria |
|---|---|---|---|
| **Phase 1** (Tasks 1-4) | `SpringKg` skeleton + `springkg-shared` interfaces + `springkg.db` schema | **B, C, D, F** can scaffold their resolvers using `SpringKg.registerResolver({ name, enhance })` | `await SpringKg.init({ projectPath })` returns a working instance; `enhanceOnSync` invokes a stub resolver and aggregates output. |
| **Phase 2** (Tasks 5-9) | Resolver chain order + migration runner + `SummaryGenerator` | **E** can build MCP tools that consume `SpringKg` and `SPRINGKG_CONFIG`; **F** can implement `community-builder` against the existing chain | `SPRINGKG_CONFIG.resolverChain` lists all 18 names in order; `runMigrations` is idempotent on a fresh DB. |
| **Phase 2** (Tasks 10-11) | `springkg install` / `uninstall` CLI | **G** can run e2e tests on a real agent install; **E** can ship the MCP server the CLI wires up | `springkg install --target=claude --yes` writes `~/.claude.json` adding `mcpServers.springkg`; `--print-config=claude` exits 0 without writes. |
| **Phase 2** (Tasks 12-15) | WAL + confidence + platform helpers + dep graph | **All** — these are the Metis M acceptance gates | All tests pass on `npm test`; `npm install` 0 ERESOLVE; WAL active; confidence column exists with default 1.0. |

**Post-Phase-1 notification** (when Teams B/C/D/F can start):

- Team A posts a one-liner in `docs/team-coordination.md` (Team G maintains the doc): "@colbymchenry/springkg-shared v0.1.0 + SpringKg skeleton ready. Resolver contract: see `packages/springkg-shared/src/index.ts`. Try `SpringKg.init({ projectPath }).registerResolver({ name, enhance })`."
- Team A tags the commit `v0.1.0-springkg-foundation`.

**Post-Phase-2 notification** (when E/F can start):

- "@colbymchenry/springkg-core v0.1.0 ready. Migration runner ships; resolver chain order locked; `springkg install` CLI works."

---

## 7. Verification Commands

End-to-end smoke (run from repo root):

```bash
# 1. Clean install + build
rm -rf node_modules packages/*/node_modules dist packages/*/dist
npm install                                       # → 0 errors, 0 peer-dep warnings
npx tsc -b packages/springkg-shared packages/springkg-core packages/springkg-installer   # → 0 errors
npm run build --workspace=@colbymchenry/springkg-core   # → copies schema.sql to dist/db/

# 2. SpringKg skeleton init (no real resolvers yet, no project files)
TMP=$(mktemp -d)
node --input-type=module -e "
  import { SpringKg } from './packages/springkg-core/dist/spring-kg.js';
  const sk = await SpringKg.init({ projectPath: '$TMP', autoWatch: false });
  console.log('cg:', !!sk.cg, 'db journal:', sk.db.getJournalMode());
  await sk.close();
"
# → cg: true  db journal: wal

# 3. Resolver chain
node --input-type=module -e "
  import { SpringKg } from './packages/springkg-core/dist/spring-kg.js';
  import { SPRINGKG_CONFIG } from './packages/springkg-shared/dist/index.js';
  const sk = await SpringKg.init({ projectPath: '$TMP', autoWatch: false });
  console.log('chain length:', SPRINGKG_CONFIG.resolverChain.length);  // → 18
  await sk.close();
"

# 4. Install + uninstall cycle
TMPHOME=$(mktemp -d)
HOME=$TMPHOME node ./packages/springkg-cli/dist/bin/springkg.js install --target=claude --yes
test -f "$TMPHOME/.claude.json" && echo "installed OK"
HOME=$TMPHOME node ./packages/springkg-cli/dist/bin/springkg.js uninstall --target=claude --yes
! test -s "$TMPHOME/.claude.json" 2>/dev/null && echo "uninstalled OK" || cat "$TMPHOME/.claude.json"

# 5. Run all Team A tests
npx vitest run __tests__/team-a/
# → all passed

# 6. Confidence column sanity
TMP2=$(mktemp -d)
node --input-type=module -e "
  import { SpringDatabase } from './packages/springkg-core/dist/db/spring-db.js';
  const db = SpringDatabase.initialize('$TMP2');
  const col = db.getDb().prepare('PRAGMA table_info(spring_symbols)').all().find(r => r.name === 'confidence');
  console.log('confidence col:', JSON.stringify(col));  // → type:'REAL', dflt_value:'1.0'
  db.close();
"
```

---

## 8. Out of Scope (for clarity)

Team A explicitly does **NOT** deliver:

- Any per-resolver logic (annotation-engine, mybatis-xml-extractor, NacosConfigResolver, etc.) — Teams B/C/D.
- Community detection algorithms (Louvain, label propagation) — Team F.
- The 14 `spring_*` MCP tools — Team E.
- The example `springcloud-demo` project or e2e tests — Team G.
- The 5 documentation files or CHANGELOG — Team G.
- Cursor / opencode installer real implementations — Team E (Team A ships stubs).
- `springkg init` / `springkg index` / `springkg status` / `springkg watch` / `springkg rebuild-community` / `springkg uninit` CLI commands — Team E (only `install` / `uninstall` are ours).
- Modifications to `src/**` (CodeGraph upstream) — **never**.

If a stakeholder asks Team A for any of the above, redirect to the responsible team per the main plan's "Team Structure" table.

---

## 9. Appendix — Reference: real CodeGraph API contracts (no fabrication)

This appendix documents the EXACT CodeGraph methods/types Team A's `SpringKg` calls. **Do NOT invent alternatives.** All paths are from the existing repo on `main`.

### `CodeGraph` class (from `src/index.ts:132`)

```typescript
// From src/index.ts
class CodeGraph {
  static init(projectRoot: string, options?: { index?: boolean; onProgress?: (p: IndexProgress) => void }): Promise<CodeGraph>;
  static open(projectRoot: string, options?: { sync?: boolean; readOnly?: boolean }): Promise<CodeGraph>;
  static initSync(projectRoot: string): CodeGraph;
  static openSync(projectRoot: string): CodeGraph;
  static isInitialized(projectRoot: string): boolean;

  // Indexing
  indexAll(options?: { onProgress?: (p: IndexProgress) => void; signal?: AbortSignal; verbose?: boolean }): Promise<IndexResult>;
  indexFiles(filePaths: string[]): Promise<IndexResult>;
  sync(options?: { onProgress?: (p: IndexProgress) => void }): Promise<SyncResult>;
  isIndexing(): boolean;

  // Watching
  watch(options?: WatchOptions): boolean;
  unwatch(): void;
  isWatching(): boolean;
  isWatcherDegraded(): boolean;        // #876
  getWatcherDegradedReason(): string | null;
  getPendingFiles(): PendingFile[];    // ← Task 4's CRITICAL call
  waitUntilWatcherReady(timeoutMs?: number): Promise<void>;
  getChangedFiles(): { added: string[]; modified: string[]; removed: string[] };

  // Sync result shape (from src/extraction)
  // SyncResult = { filesChecked, filesAdded, filesModified, filesRemoved, nodesUpdated, durationMs, changedFilePaths? }

  // Node queries
  getNode(id: string): Node | null;
  getNodesInFile(filePath: string): Node[];
  getNodesByKind(kind: NodeKind): Node[];
  getNodesByName(name: string): Node[];
  searchNodes(query: string, options?: SearchOptions): SearchResult[];

  // Edge queries
  getOutgoingEdges(nodeId: string): Edge[];
  getIncomingEdges(nodeId: string): Edge[];
  getEdgesForNodes(nodeIds: string[], kinds?: EdgeKind[]): Edge[];

  // Files
  getFile(filePath: string): FileRecord | null;
  getFiles(): FileRecord[];

  // Traversal
  traverse(startId: string, options?: TraversalOptions): Subgraph;
  getCallGraph(nodeId: string, depth?: number): Subgraph;
  getCallers(nodeId: string, maxDepth?: number): Array<{ node: Node; edge: Edge }>;
  getCallees(nodeId: string, maxDepth?: number): Array<{ node: Node; edge: Edge }>;
  getImpactRadius(nodeId: string, maxDepth?: number): Subgraph;
  findPath(fromId: string, toId: string, edgeKinds?: EdgeKind[]): Array<{ node: Node; edge: Edge | null }> | null;
  getAncestors(nodeId: string): Node[];
  getChildren(nodeId: string): Node[];

  // Context
  getCode(nodeId: string): Promise<string | null>;
  buildContext(input: TaskInput, options?: BuildContextOptions): Promise<TaskContext | string>;

  // Lifecycle
  optimize(): void;
  clear(): void;
  uninitialize(): void;
  close(): void;
  getProjectRoot(): string;
  getBackend(): SqliteBackend;
  getJournalMode(): string;
  getLastIndexedAt(): number | null;
  getIndexBuildInfo(): { version: string | null; extractionVersion: number | null };
  isIndexStale(): boolean;
}
```

### `WatchOptions` (from `src/sync/watcher.ts:149-185`)

```typescript
interface WatchOptions {
  debounceMs?: number;                                         // default 2000
  onSyncComplete?: (result: { filesChanged: number; durationMs: number }) => void;
  onSyncError?: (error: Error) => void;
  onDegraded?: (reason: string) => void;
  inertForTests?: boolean;                                     // test-only
}
```

**Note**: `onSyncComplete` does NOT receive a `changedFilePaths` field. To get paths, use `cg.getPendingFiles()` (returns `PendingFile[]`) AFTER the sync callback fires.

### `PendingFile` (from `src/sync/watcher.ts:206-219`)

```typescript
interface PendingFile {
  path: string;              // project-relative POSIX (e.g. "src/foo.ts")
  firstSeenMs: number;       // Date.now() at first event
  lastSeenMs: number;        // Date.now() at most recent event
  indexing: boolean;         // true if in-flight sync will pick it up
}
```

### `SyncResult` (from `src/extraction/orchestrator.ts` — `IndexResult`-shaped)

```typescript
interface SyncResult {
  filesChecked: number;
  filesAdded: number;
  filesModified: number;
  filesRemoved: number;
  nodesUpdated: number;
  durationMs: number;
  changedFilePaths?: string[];    // only when git info available
}
```

### `DatabaseConnection` exports from `@colbymchenry/codegraph` (from `src/index.ts:62` and `src/db/index.ts:43`)

The public re-exports include `DatabaseConnection`, `getDatabasePath`, and `getCodeGraphDir`. `createDatabase` is **internal** but accessible via deep import (`@colbymchenry/codegraph/dist/db/sqlite-adapter.js` — verify exists in built dist).

For `SpringDatabase`, use the internal `createDatabase` (per Task 3) OR — safer — instantiate `DatabaseConnection.initialize(dbPath)` for a throwaway instance, then reach into `getDb()` to get the `SqliteDatabase` and close immediately. The first option is cleaner; the second is safer if the dist path changes.

### PRAGMA order (from `src/db/index.ts:30-38`)

**MUST be set in this order**, with `busy_timeout` first:

```typescript
db.pragma('busy_timeout = 5000');      // FIRST
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -64000');
db.pragma('temp_store = MEMORY');
db.pragma('mmap_size = 268435456');
```

### `node:sqlite` requirement

CodeGraph requires Node 22.5+ (the `node:sqlite` module is built-in). Springkg inherits this. Document in the README (Team G) that `springkg install` on older Node fails fast with the same error CodeGraph emits.

---

## 10. Sign-off Checklist (before merge to main)

- [x] All 15 tasks complete with passing QA Scenarios.
- [x] `npm test` (all team-a tests) green.
- [x] `npx tsc -b packages/springkg-shared packages/springkg-core packages/springkg-installer` exits 0.
- [x] No modifications to `src/**` (`git diff main -- src/` is empty).
- [x] No modifications to other teams' owned files (`packages/springkg-{semantic,data,runtime,community,mcp,cli}/src/**` only contains scaffold stubs).
- [x] CHANGELOG.md entry under `## [Unreleased]` (Team G will add the full entry, but the heading is required).
- [x] Tag created: `git tag v0.1.0-springkg-foundation` on `7d5c4fe`.
- [x] Notify Teams B/C/D/F in `docs/team-coordination.md`.
