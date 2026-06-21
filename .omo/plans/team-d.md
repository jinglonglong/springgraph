# Team D — Runtime / Nacos / Gateway / Config

> **Team**: D (Runtime asset extraction)
> **Owns**: `packages/springkg-runtime/src/**`, `packages/springkg-runtime/__tests__/**`
> **Branch**: `team-d-runtime`
> **Worktree**: `../cg-team-d`
> **Critical Path**: Phase 2 — must finish T15+T16 before Team E T20 (spring_assets_overview); T37+T38+T39 before Team E T44+T45
> **Sprint focus**: Sprint 1 (config + middleware), Sprint 3 (Nacos + Gateway + ConfigProperty reverse-lookup)

---

## 1. Team Overview

Team D extracts **Runtime Asset Layer** signals from a SpringCloud project — the *deployment-time* knowledge that lives next to Java sources in YAML/properties/XML/YML files. Team B owns Spring/Java annotations, Team C owns MyBatis/SQL, and Team D owns everything that answers:

- "What services does this repo deploy?"
- "What middleware (DB / Redis / MQ / ES / MinIO / xxl-job) does it talk to, and via which config?"
- "What Nacos clusters / namespaces / dataIds does it depend on?"
- "What Gateway routes does it expose, and which downstream service do they forward to?"
- "Where is `datasource.password` actually *used* in Java code (`@Value` / `@ConfigurationProperties`)?"

All output is **append-only** to `.codegraph/springkg.db`. Team D does NOT modify `codegraph.db`, does NOT modify `springkg.db` schema (Team A owns that), and does NOT read code-graph AST (Team B already produced the `*Service` / `*Mapper` nodes — Team D only writes `kind=middleware/config_property/nacos_*/gateway_route`).

### Core contract

| Direction | Contract | Owner / Consumer |
|---|---|---|
| **Input** | `SpringKg` class API + `SpringKg.upsertSymbol()` / `upsertEdge()` / `recordConfigProperty()` | Team A produces, Team D consumes |
| **Input** | `SPRINGKG_CONFIG.sensitiveKeyPatterns` regex array | Team A produces, Team D consumes (for masking) |
| **Output** | `runtime_config_properties` table rows (read by `spring_find_config`, `spring_assets_overview`) | Team E consumes |
| **Output** | `spring_symbols(kind=middleware)` + `spring_edges(kind=CONNECTS_TO)` (read by `spring_assets_overview`) | Team E consumes |
| **Output** | `spring_symbols(kind=nacos_cluster/nacos_config/nacos_service)` + `spring_edges(kind=LOADS_CONFIG)` (read by `spring_nacos_overview`) | Team E consumes |
| **Output** | `spring_symbols(kind=gateway_route)` + `spring_edges(kind=ROUTES_TO / MATCHES_PATH)` (read by `spring_gateway_route`) | Team E consumes |
| **Output** | `spring_edges(kind=USED_BY)` from `config_property` → class/method (read by `spring_find_config`) | Team E consumes |

### Why this is append-only

Per main plan §"Append-only 写 `springkg.db`": Team B writes controller/service/feign/mapper; Team C writes mapper/sql/table; Team D writes **only** `config_property`, `middleware`, `nacos_cluster`, `nacos_config`, `gateway_route` nodes and **only** `CONNECTS_TO`, `LOADS_CONFIG`, `ROUTES_TO`, `USED_BY`, `MATCHES_PATH` edges. Any other node/edge kind in this plan is a bug — flag it and route back to Team A or the owning team.

---

## 2. Owned Files (write-allowed)

```
packages/springkg-runtime/
  package.json                              # Team D owns; declares dep on springkg-core, springkg-shared, js-yaml
  tsconfig.json                             # Team D owns (extends root)
  vitest.config.ts                          # Team D owns
  src/
    index.ts                                # barrel: exports ConfigResolver, MiddlewareInventory, NacosConfigResolver, ConfigPropertyUsageTracker, GatewayRouteResolver
    config-resolver.ts                      # T15
    middleware-inventory.ts                 # T16
    nacos-config-resolver.ts                # T37
    config-usage-tracker.ts                 # T38
    gateway-route-resolver.ts               # T39
    sync-nacos.ts                           # T63 — CLI entry (lives in runtime; called from springkg-cli)
    internal/
      yaml-loader.ts                        # shared file reader (yaml + properties) — T15 internal helper, also consumed by T37/T39
      property-flatten.ts                   # flatten nested map → dotted keys (e.g. spring.datasource.url)
      key-mask.ts                           # masking helper — uses SPRINGKG_CONFIG.sensitiveKeyPatterns from Team A
  __tests__/
    config-resolver.test.ts                 # T15 (6 cases)
    middleware-inventory.test.ts            # T16 (6 cases)
    nacos-config-resolver.test.ts           # T37 (5 cases)
    config-usage-tracker.test.ts            # T38 (2 cases)
    gateway-route-resolver.test.ts          # T39 (4 cases)
    sync-nacos.test.ts                      # T63 (1 case)
    fixtures/
      application.yml                       # basic yml with 3 keys + 1 sensitive
      application-dev.yml                    # profile override
      bootstrap.yml                         # Nacos discovery block
      application-multi-datasource.yml      # 2 datasources
      gateway-routes.yml                    # 3 routes incl. lb:// and Path=
      gateway-no-routes.yml                 # empty routes array (edge case)
      nacos-shared-configs.yml              # shared-configs + extension-configs
      nacos-import.yml                      # spring.config.import=nacos: syntax
      properties/application.properties     # legacy .properties variant
      properties/bootstrap.properties       # legacy bootstrap variant
      java/UserService.java                 # has @Value("${...}") usages — T38 fixture
      java/AppProperties.java               # has @ConfigurationProperties(prefix="app") — T38 fixture
```

**Out of scope** (do NOT touch):
- `packages/springkg-core/**`, `packages/springkg-shared/**` — Team A
- `packages/springkg-semantic/**` — Team B
- `packages/springkg-data/**` — Team C
- `packages/springkg-mcp/**`, `packages/springkg-cli/src/commands/**` — Team E
  - Exception: `packages/springkg-runtime/src/sync-nacos.ts` is the *implementation* of the CLI command. Team E wires it from `packages/springkg-cli/src/commands/sync-nacos.ts` (a 3-line shim that calls `NacosConfigResolver.run()`). If Team E's CLI shim doesn't exist yet, Team D can stub the shim in `packages/springkg-cli/src/commands/sync-nacos.ts` — but the bulk of the logic stays in `packages/springkg-runtime/src/sync-nacos.ts`.

---

## 3. Input Contracts (from Team A)

### 3.1 SpringKg API (consumed)

```typescript
import { SpringKg } from 'springkg-core';

const kg = await SpringKg.open(projectPath); // .codegraph/springkg.db

// All Team D writes go through these three methods. NO raw SQL.
await kg.upsertSymbol({
  id: 'middleware:mysql:order-service',       // ${kind}:${sha256truncated_32chars}
  kind: 'middleware',
  name: 'mysql (order-db)',
  qualifiedName: 'spring.datasource.url',
  filePath: 'src/main/resources/application.yml',
  startLine: 12,
  endLine: 14,
  metadata: { middlewareKind: 'database', subtype: 'mysql', url: 'jdbc:mysql://...' },
});

await kg.upsertEdge({
  id: 'edge:...',
  sourceId: 'micro_service:order-service',
  targetId: 'middleware:mysql:order-service',
  kind: 'CONNECTS_TO',
  provenance: 'static',
  metadata: { viaConfig: 'spring.datasource.url' },
});

await kg.recordConfigProperty({
  id: 'config_property:order-service:spring.datasource.password',
  serviceId: 'order-service',
  key: 'spring.datasource.password',
  valueMasked: '***1234',        // last-4 if value length >= 4; else '***'
  valueHash: 'sha256:...',       // Team A helper, see SPRINGKG_CONFIG
  valueType: 'string',
  sourceFile: 'src/main/resources/application.yml',
  profile: 'default',
  priority: 100,                 // bootstrap=100, application=50, profile-specific=25
  isSensitive: 1,                // 1 if matches SPRINGKG_CONFIG.sensitiveKeyPatterns
  metadata: {},
});
```

### 3.2 SPRINGKG_CONFIG.sensitiveKeyPatterns (consumed)

```typescript
// From packages/springkg-shared/src/config.ts (Team A owns)
SPRINGKG_CONFIG.sensitiveKeyPatterns = [
  /password/i,
  /secret/i,
  /token/i,
  /access-key/i,
  /secret-key/i,
  /private-key/i,
  /jwt\.secret/i,
];
// And per-key explicit allowlist:
SPRINGKG_CONFIG.alwaysSensitiveKeys = [
  'spring.datasource.password',
  'spring.redis.password',
  'nacos.password',
];
```

Team D's `internal/key-mask.ts` uses these. The mask format is:
- `value.length >= 4` → `***` + `value.slice(-4)` (e.g. `s3cr3t1234` → `***1234`)
- `value.length < 4` → `***`
- empty/null → `***`

### 3.3 Read-only access to CodeGraph nodes (consumed)

For T38 (ConfigProperty → class/method USED_BY), Team D reads from `codegraph.db` (NOT from `springkg.db`):
- `nodes` table filtered by `decorators LIKE '%@Value%'` or `decorators LIKE '%@ConfigurationProperties%'`
- Match `name` / `qualifiedName` to extract the literal `${...}` and `prefix = "..."` strings

The read API:
```typescript
const cgNodes = await kg.codegraph.findNodes({
  decoratorPattern: '@Value|@ConfigurationProperties',
});
```

This is provided by Team A. If missing, T38 blocks — flag immediately.

---

## 4. Output Contracts (consumed by Team E)

### 4.1 Tables / kinds Team D writes

| Table | Kind | Required fields |
|---|---|---|
| `runtime_config_properties` | (one row per `(serviceId, key)`) | `id`, `service_id`, `key`, `value_masked`, `value_hash`, `value_type`, `source_file`, `profile`, `priority`, `is_sensitive` |
| `spring_symbols` | `config_property` | `id`, `codegraph_node_id=null`, `name=key`, `qualified_name`, `file_path`, `start_line`, `metadata_json={key, profile, sourceFile}` |
| `spring_symbols` | `middleware` | `id`, `name`, `qualified_name=key`, `file_path`, `metadata_json={middlewareKind, subtype, host, port}` |
| `spring_symbols` | `nacos_cluster` | `id`, `name=serverAddr`, `metadata_json={namespace, group, username}` |
| `spring_symbols` | `nacos_config` | `id`, `name=dataId`, `metadata_json={group, namespace, fileExtension, refreshEnabled}` |
| `spring_symbols` | `nacos_service` | `id`, `name=serviceName` (from `spring.application.name` of consumer service or FeignClient target), `metadata_json={cluster, group}` |
| `spring_symbols` | `gateway_route` | `id`, `name=routeId`, `file_path`, `start_line`, `metadata_json={uri, predicates, filters}` |
| `spring_edges` | `CONNECTS_TO` | micro_service → middleware |
| `spring_edges` | `LOADS_CONFIG` | micro_service → nacos_config / config_property |
| `spring_edges` | `ROUTES_TO` | gateway_route → micro_service (or external URL) |
| `spring_edges` | `MATCHES_PATH` | gateway_route → endpoint (path predicate) |
| `spring_edges` | `USED_BY` | config_property → class/method (T38) |

### 4.2 ID format (deterministic — Team A defines)

`${kind}:${sha256(content).slice(0, 32)}` — never random. Re-indexing the same file MUST produce the same IDs (idempotent). Team D uses:

```typescript
import { createHash } from 'node:crypto';
function nid(kind: string, content: string): string {
  return `${kind}:${createHash('sha256').update(content).digest('hex').slice(0, 32)}`;
}
// Examples:
// 'middleware:sha256_32chars...'
// 'config_property:sha256_32chars...'
```

### 4.3 Read API for Team E

```typescript
// What Team E's spring_assets_overview calls:
const services = await kg.findSymbols({ kind: 'middleware', serviceId: 'order-service' });
const props = await kg.findConfigProperties({ serviceId: 'order-service', isSensitive: 0 });
const nacos = await kg.findSymbols({ kind: { $in: ['nacos_cluster', 'nacos_config', 'nacos_service'] } });
const routes = await kg.findSymbols({ kind: 'gateway_route' });

// What Team E's spring_find_config calls:
const usages = await kg.findEdges({ sourceKind: 'config_property', targetKind: 'class', key: 'spring.datasource.url' });
```

---

## 5. Task List

> **Format**: `- [ ] N. [D] <title>` — bare numbers, no `T15.`/`Phase`/`Task-` prefixes.
> **Each task = implementation + tests + verification + evidence**. Do not mark a task complete until tests pass and evidence is saved to `.omo/evidence/team-d/task-{N}-{slug}.txt`.

### 5.1 File-scanning baseline (implicit, T15)

Both T15 and T37/T39 scan YAML/properties files. The shared scanner lives at `packages/springkg-runtime/src/internal/yaml-loader.ts` and is consumed by all three resolvers. It is NOT a separate numbered task — it is part of T15's deliverable. The scanner supports:

- `application.yml` / `application.yaml`
- `application-{profile}.yml` / `application-{profile}.yaml`
- `bootstrap.yml` / `bootstrap.yaml`
- `bootstrap-{profile}.yml`
- `application.properties`
- `application-{profile}.properties`
- `bootstrap.properties`
- `bootstrap-{profile}.properties`

Loaded via `js-yaml` (already in deps per `package.json`) and a small hand-rolled `.properties` parser (lines `key=value`, `#` comments, no escape rules beyond backslash-continuation). `property-flatten.ts` converts nested maps to dotted keys: `{ spring: { datasource: { url: 'x' } } }` → `spring.datasource.url`.

### 5.2 Tasks

- [x] 1. [D] **T15 — ConfigResolver**: implement `config-resolver.ts`
  - **What to do**:
    1. Implement `ConfigResolver.enhance(input: SpringKgEnhanceInput): Promise<SpringKgEnhanceOutput>` in `packages/springkg-runtime/src/config-resolver.ts`.
    2. Scan all matching config files (8 patterns above) under `projectPath/src/main/resources` (and `src/test/resources` if a profile name like `test` exists; skip in production paths).
    3. For each `(serviceId, key)`:
       - Compute `value_masked` via `internal/key-mask.ts` using `SPRINGKG_CONFIG.sensitiveKeyPatterns` + `SPRINGKG_CONFIG.alwaysSensitiveKeys`.
       - Compute `value_hash = 'sha256:' + sha256(value)` (Team A may provide `SpringKg.hashValue()`).
       - Determine `priority`: `bootstrap` = 100, `application` = 50, profile-specific = 25.
       - If file is `application-{profile}.yml`, set `profile = '{profile}'` (extract from filename).
    4. Required key targets (extract + assert presence when file exists):
       - `spring.application.name` → service_id
       - `server.port`
       - `server.servlet.context-path`
       - `spring.profiles.active`
       - Everything else: write to DB with `kind=config_property`.
    5. **Always-sensitive masking** for keys matching `/password|secret|token|access-key|secret-key|private-key|jwt\.secret|datasource\.password|redis\.password|nacos\.password/i` → `is_sensitive = 1`, `value_masked = '***' + last4`.
    6. Write via `kg.recordConfigProperty()` (Team A API). Do NOT raw-SQL.
    7. Upsert one `spring_symbols(kind=config_property)` per property.
    8. Upsert `spring_edges(kind=LOADS_CONFIG)` from micro_service node (Team B writes `micro_service` node from `spring.application.name`; if missing, Team D creates a stub `micro_service:${serviceId}` node — but flag this in commit message).
  - **Acceptance**:
    - `packages/springkg-runtime/__tests__/config-resolver.test.ts` covers 6 cases:
      1. Basic `application.yml` with 4 keys → 4 properties, all `is_sensitive=0`.
      2. `application.yml` with `spring.datasource.password=secret1234` → `value_masked='***1234'`, `is_sensitive=1`.
      3. `application-dev.yml` overrides `application.yml` → higher priority (25 vs 50), correct value wins.
      4. `bootstrap.yml` overrides `application.yml` → priority 100 wins.
      5. `application.properties` (legacy) parses correctly.
      6. Unknown keys still get written to `runtime_config_properties` (no key allowlist).
  - **Must NOT do**:
    - Do NOT call Nacos OpenAPI. Local-only.
    - Do NOT read Java AST (Team B owns).
    - Do NOT store plaintext sensitive values.
    - Do NOT use raw SQL — go through `kg.recordConfigProperty()`.
  - **Verification**:
    ```bash
    cd packages/springkg-runtime && npx vitest run config-resolver
    sqlite3 ../../examples/springcloud-demo/.codegraph/springkg.db \
      "SELECT key, value_masked, is_sensitive FROM runtime_config_properties WHERE is_sensitive=1"
    # expect: 0 plaintext values, only '***XXXX' format
    ```
  - **Evidence**: `.omo/evidence/team-d/task-15-config-resolver.txt` — paste test output + sqlite query result.

- [x] 2. [D] **T16 — MiddlewareInventory**: implement `middleware-inventory.ts`
  - **What to do**:
    1. Read `runtime_config_properties` (already populated by T15) filtered by keys starting with one of:
       - `spring.datasource.` → `middlewareKind='database'`, subtype inferred from `url` (`jdbc:mysql://` → `mysql`, `jdbc:postgresql://` → `postgres`, `jdbc:oracle://` → `oracle`, `jdbc:sqlserver://` → `sqlserver`).
       - `spring.redis.` → `middlewareKind='cache'`, subtype=`redis`.
       - `spring.kafka.` / `spring.rabbitmq.` → `middlewareKind='mq'`, subtype=`kafka` / `rabbitmq`.
       - `spring.elasticsearch.` → `middlewareKind='search'`, subtype=`elasticsearch`.
       - `xxl.job.` → `middlewareKind='job_scheduler'`, subtype=`xxl-job`.
       - `minio.` / `oss.` → `middlewareKind='object_storage'`, subtype=`minio` / `oss`.
    2. Group properties by prefix → produce one `spring_symbols(kind=middleware)` per group. `name` = `${subtype} (${host}:${port})` if `host`/`port` extractable from URL.
    3. Write `spring_edges(kind=CONNECTS_TO)` from micro_service → middleware.
  - **Acceptance**:
    - 6 cases in `middleware-inventory.test.ts`:
      1. `spring.datasource.url=jdbc:mysql://10.0.0.1:3306/order_db` → 1 middleware (mysql), 1 CONNECTS_TO edge.
      2. Multi-datasource (`spring.datasource.order.url`, `spring.datasource.bill.url`) → 2 distinct middleware nodes (idempotent IDs).
      3. `spring.redis.host=10.0.0.2, spring.redis.port=6379` → 1 cache/redis middleware.
      4. `spring.kafka.bootstrap-servers=10.0.0.3:9092` → 1 mq/kafka.
      5. `spring.rabbitmq.host=10.0.0.4` → 1 mq/rabbitmq.
      6. `xxl.job.admin.addresses=http://10.0.0.5:8080/xxl-job-admin` → 1 job_scheduler/xxl-job.
  - **Must NOT do**:
    - Do NOT infer middleware from Java code (e.g. `@KafkaListener` — that's a separate Sprint 3 task owned by Team B+ Team D coordination, NOT in T16 scope).
    - Do NOT write to `runtime_config_properties` (read-only; T15 owns writes).
  - **Verification**:
    ```bash
    npx vitest run middleware-inventory
    sqlite3 ../../examples/springcloud-demo/.codegraph/springkg.db \
      "SELECT kind, name, json_extract(metadata_json,'$.middlewareKind') FROM spring_symbols WHERE kind='middleware'"
    ```
  - **Evidence**: `.omo/evidence/team-d/task-16-middleware-inventory.txt`.

- [x] 3. [D] **T37 — NacosConfigResolver**: implement `nacos-config-resolver.ts`
  - **What to do**:
    1. Scan same YAML/properties files (reuse `yaml-loader.ts` + `property-flatten.ts`).
    2. Extract `spring.cloud.nacos.discovery.*` and `spring.cloud.nacos.config.*` namespaces.
    3. For each service:
       - One `nacos_cluster` node per unique `server-addr` (across all services — dedupe by ID). `metadata_json` includes `namespace`, `group`, `username`. **Password is masked**: `metadata_json.password` field uses `***` + last4 via `key-mask.ts`.
       - One `nacos_config` node per `dataId`. Sources:
         - `spring.cloud.nacos.config.ext-config[].data-id` (extension-configs).
         - `spring.cloud.nacos.config.shared-configs[].data-id` (shared-configs).
         - `file-extension` (default `properties`) → determines implicit dataId = `${spring.application.name}.${file-extension}`.
         - `spring.config.import=nacos:dataId?group=...&namespace=...` syntax (split by `nacos:`, parse query string).
       - One `nacos_service` node per `spring.application.name` that has Nacos config → `kind=nacos_service` (this is the *registered* view, distinct from `micro_service` which Team B writes).
    4. Write `LOADS_CONFIG` edges: micro_service → nacos_config.
  - **Acceptance**:
    - 5 cases in `nacos-config-resolver.test.ts`:
      1. Single `bootstrap.yml` with `discovery.server-addr=10.0.0.1:8848, config.namespace=dev, config.ext-config[0].data-id=order.yaml` → 1 nacos_cluster, 1 nacos_config, 1 nacos_service, 1 LOADS_CONFIG.
      2. `shared-configs[2]` with 2 entries → 2 nacos_config nodes.
      3. `spring.config.import=nacos:order-dev.yaml?group=DEFAULT_GROUP` → 1 nacos_config with `group=DEFAULT_GROUP` parsed from query string.
      4. Two services with same `server-addr` → 1 nacos_cluster (deduped by ID), 2 nacos_service.
      5. `nacos.password=secret1234` → metadata `password='***1234'`, never plaintext.
  - **Must NOT do**:
    - Do NOT call Nacos OpenAPI (local-only).
    - Do NOT include any plaintext password in any output (MCP, DB, logs).
  - **Verification**:
    ```bash
    npx vitest run nacos-config-resolver
    sqlite3 ../../examples/springcloud-demo/.codegraph/springkg.db \
      "SELECT kind, name, metadata_json FROM spring_symbols WHERE kind LIKE 'nacos_%'"
    ```
  - **Evidence**: `.omo/evidence/team-d/task-37-nacos.txt`.

- [x] 4. [D] **T38 — ConfigPropertyUsageTracker**: implement `config-usage-tracker.ts`
  - **What to do**:
    1. Query `codegraph.db.nodes` (NOT `springkg.db`) via Team A's `kg.codegraph.findNodes({ decoratorPattern: '@Value|@ConfigurationProperties' })`.
    2. For `@Value("${some.key}")`:
       - Extract literal key via regex `/@Value\s*\(\s*"\$\{([^}]+)\}"/`.
       - Match against `runtime_config_properties.key` (T15 wrote them).
       - Write `spring_edges(kind=USED_BY)` from `config_property:<serviceId>:<key>` → `codegraph_node_id` (the class or method using it). If method-level → edge target is the method node; if class-level (field) → target is the field/class node.
    3. For `@ConfigurationProperties(prefix = "app.datasource")`:
       - Extract prefix.
       - Match all `runtime_config_properties.key` starting with `app.datasource.`.
       - Write one `USED_BY` edge per matching key → class node.
    4. If a `@Value` key does NOT exist in `runtime_config_properties`, log a warning (do NOT silently drop) — this surfaces misconfigured properties.
  - **Acceptance**:
    - 2 cases in `config-usage-tracker.test.ts`:
      1. Fixture `java/UserService.java` with `@Value("${spring.datasource.url}")` on `private String dbUrl;` field → 1 `USED_BY` edge `config_property:order-service:spring.datasource.url` → `field:UserService.dbUrl`.
      2. Fixture `java/AppProperties.java` with `@ConfigurationProperties(prefix = "app.datasource")` on class, and `runtime_config_properties` has `app.datasource.max-pool-size`, `app.datasource.min-idle` → 2 `USED_BY` edges to class node.
  - **Must NOT do**:
    - Do NOT modify `codegraph.db` (read-only).
    - Do NOT duplicate edges if re-run (idempotent — use deterministic edge ID from `(source, target, kind)`).
  - **Verification**:
    ```bash
    npx vitest run config-usage-tracker
    sqlite3 ../../examples/springcloud-demo/.codegraph/springkg.db \
      "SELECT s.name AS prop, json_extract(e.metadata_json,'$.usageKind') AS kind FROM spring_edges e JOIN spring_symbols s ON e.source_id=s.id WHERE e.kind='USED_BY'"
    ```
  - **Evidence**: `.omo/evidence/team-d/task-38-config-usage.txt`.

- [x] 5. [D] **T39 — GatewayRouteResolver**: implement `gateway-route-resolver.ts`
  - **What to do**:
    1. Scan all `application.yml` / `bootstrap.yml` (any service whose `spring.application.name` is `*-gateway` OR which has `spring.cloud.gateway` block) for `spring.cloud.gateway.routes[]`.
    2. For each route entry:
       - `id` → `gateway_route.id = sha256('gateway_route:' + routeId).slice(0,32)`.
       - `uri`:
         - If `lb://service-name` → write `ROUTES_TO` edge to `micro_service:<service-name>` (create stub micro_service node if not present, like T15 does).
         - If `http(s)://...` → write `ROUTES_TO` to a `route_target:external:${host}` node (kind=`route_target`, this is a Team D-exclusive kind for external URIs).
         - If `ws(s)://...` → same as `lb://` but kind tag `websocket` in metadata.
       - `predicates[]`: extract `Path=/api/**` → write `MATCHES_PATH` edge to `endpoint:${serviceName}:${path}`. Other predicates (`Method=GET,POST`, `Host=...`, `Header=...`) go into `metadata_json` only (no extra edges in v1).
       - `filters[]`: each filter goes into `metadata_json.filters` only (e.g. `StripPrefix=1`, `AddRequestHeader=X-Foo, Bar`).
    3. Output:
       - `spring_symbols(kind=gateway_route)` with `name=routeId`, `file_path`, `start_line`, `metadata_json={uri, predicates, filters}`.
       - `spring_edges(kind=ROUTES_TO)` from gateway_route → micro_service / external target.
       - `spring_edges(kind=MATCHES_PATH)` from gateway_route → endpoint.
  - **Acceptance**:
    - 4 cases in `gateway-route-resolver.test.ts`:
      1. Single route `id=order_route, uri=lb://order-service, predicates=[Path=/api/order/**]` → 1 gateway_route, 1 ROUTES_TO (to order-service micro_service), 1 MATCHES_PATH.
      2. Three routes, two with `lb://`, one with `https://api.example.com` → 3 gateway_routes, 2 ROUTES_TO (to micro_service), 1 ROUTES_TO (to external `route_target:external:api.example.com`).
      3. Multi-predicate `predicates=[Path=/api/order/**, Method=GET,POST]` → 1 MATCHES_PATH, Method captured in metadata_json.
      4. Empty `routes: []` → 0 gateway_routes (no errors).
  - **Must NOT do**:
    - Do NOT parse Java code for `@Route` / route definitions (Team B + E handles Controller endpoints).
    - Do NOT generate edges to endpoints whose service does not exist in DB (drop with warning).
  - **Verification**:
    ```bash
    npx vitest run gateway-route-resolver
    sqlite3 ../../examples/springcloud-demo/.codegraph/springkg.db \
      "SELECT s.name, json_extract(s.metadata_json,'$.uri') AS uri, e.kind AS edge_kind, t.name AS target FROM spring_symbols s JOIN spring_edges e ON e.source_id=s.id JOIN spring_symbols t ON e.target_id=t.id WHERE s.kind='gateway_route'"
    ```
  - **Evidence**: `.omo/evidence/team-d/task-39-gateway.txt`.

- [x] 6. [D] **T63 — `springkg sync-nacos [path]` CLI command**: implement `sync-nacos.ts`
  - **What to do**:
    1. Implement `runSyncNacos(projectPath: string, options: { dryRun?: boolean; profile?: string }): Promise<{ scanned: number; added: number; updated: number; removed: number }>` in `packages/springkg-runtime/src/sync-nacos.ts`.
    2. This is a thin wrapper around `NacosConfigResolver.enhance()` (T37) — invokes the resolver, reports counts by kind, exits 0 on success / 1 on error.
    3. Logging: per-resolver `INFO` line `[springkg] sync-nacos scanned=12 added=8 updated=2 removed=0 duration=143ms`.
    4. **CLI shim**: if Team E has not yet created `packages/springkg-cli/src/commands/sync-nacos.ts`, Team D creates a minimal stub there (≤10 lines): `import { runSyncNacos } from 'springkg-runtime/sync-nacos'; export default async (args) => { ... }`. Document this in commit message: `[team-d] CLI shim for T63 — replace with Team E wiring in Phase 4`.
  - **Acceptance**:
    - 1 case in `sync-nacos.test.ts`:
      1. Run `runSyncNacos(fixturesDir)` on a fixture project with `bootstrap.yml` (1 nacos_cluster, 1 nacos_config) → `scanned >= 1, added >= 2, errors = []`. `dryRun=true` → no DB writes but `scanned` count is same.
  - **Must NOT do**:
    - Do NOT call Nacos OpenAPI.
    - Do NOT modify Team E's CLI dispatch logic (only the shim file).
  - **Verification**:
    ```bash
    npx vitest run sync-nacos
    npx tsx packages/springkg-runtime/src/sync-nacos.ts examples/springcloud-demo --dry-run
    # expect: scanned=... added=... duration=...
    ```
  - **Evidence**: `.omo/evidence/team-d/task-63-sync-nacos.txt`.

---

## 6. Sync Points (cross-team)

### 6.1 Sync point A — Phase 2 / Sprint 1 gate

**Before Team E can start T20 (spring_assets_overview)**:

| Must be DONE | Owner | Verification |
|---|---|---|
| SpringKg class API (upsertSymbol, upsertEdge, recordConfigProperty, codegraph.findNodes) | Team A | `npm run build` in springkg-core |
| `SPRINGKG_CONFIG.sensitiveKeyPatterns` exported | Team A | unit test |
| T15 ConfigResolver — writes `runtime_config_properties` + `config_property` symbols + `LOADS_CONFIG` edges | Team D | `npx vitest run config-resolver` |
| T16 MiddlewareInventory — writes `middleware` symbols + `CONNECTS_TO` edges | Team D | `npx vitest run middleware-inventory` |

**Communication**: Team D posts `.omo/evidence/team-d/task-{15,16}-*.txt` to the team-coordination channel. Team E unblocks T20 only after seeing those evidence files.

### 6.2 Sync point B — Sprint 3 gate

**Before Team E can start T44 (spring_find_config) and T45 (spring_nacos_overview + spring_gateway_route)**:

| Must be DONE | Owner | Verification |
|---|---|---|
| T37 NacosConfigResolver | Team D | `npx vitest run nacos-config-resolver` |
| T38 ConfigPropertyUsageTracker | Team D | `npx vitest run config-usage-tracker` |
| T39 GatewayRouteResolver | Team D | `npx vitest run gateway-route-resolver` |
| CodeGraph node accessor for `@Value` / `@ConfigurationProperties` | Team A | unit test on `kg.codegraph.findNodes` |
| `endpoint` symbols exist for MATCHES_PATH targets | Team B | `SELECT COUNT(*) FROM spring_symbols WHERE kind='endpoint'` |

### 6.3 Sync point C — Final verification

**Before V1 sign-off (Phase 7, Team G runs)**:

| Must be DONE | Owner |
|---|---|
| T63 `springkg sync-nacos` CLI | Team D |
| All 6 tasks have passing tests | Team D |
| `.omo/evidence/team-d/` has 6 evidence files | Team D |
| No plaintext sensitive values anywhere in `springkg.db` | Team D + Team G audit |

### 6.4 What Team D needs from other teams

| From | When | What |
|---|---|---|
| Team A | Phase 1 | `SpringKg` class + `SPRINGKG_CONFIG.sensitiveKeyPatterns` + `kg.codegraph.findNodes` |
| Team B | Phase 2 | `micro_service` symbols (so T15/T16 can write `LOADS_CONFIG` / `CONNECTS_TO` edges) |
| Team B | Phase 3 (Sprint 3) | `endpoint` symbols (so T39 can write `MATCHES_PATH`) |
| Team E | Sprint 3 | CLI dispatch in `springkg-cli` (or Team D writes 10-line shim) |
| Team G | Phase 7 | final audit + example project fixture validation |

### 6.5 What Team D provides to other teams

| To | What | When |
|---|---|---|
| Team E (T20) | `middleware`, `config_property` symbols + `CONNECTS_TO`, `LOADS_CONFIG` edges | Sprint 1 |
| Team E (T44) | `USED_BY` edges + reverse lookup | Sprint 3 |
| Team E (T45) | `nacos_cluster`, `nacos_config`, `nacos_service`, `gateway_route` symbols + `LOADS_CONFIG`, `ROUTES_TO`, `MATCHES_PATH` edges | Sprint 3 |
| Team F | (no direct dependency; community builder reads symbols indirectly) | Sprint 4 |
| Team G | Evidence files + sqlite snapshots | Phase 7 |

---

## 7. Verification Strategy

### 7.1 Test commands (run from repo root)

```bash
# Per-task (during dev)
cd packages/springkg-runtime && npx vitest run config-resolver
cd packages/springkg-runtime && npx vitest run middleware-inventory
cd packages/springkg-runtime && npx vitest run nacos-config-resolver
cd packages/springkg-runtime && npx vitest run config-usage-tracker
cd packages/springkg-runtime && npx vitest run gateway-route-resolver
cd packages/springkg-runtime && npx vitest run sync-nacos

# Full Team D suite
cd packages/springkg-runtime && npx vitest run

# Typecheck (must be zero errors)
cd packages/springkg-runtime && npx tsc --noEmit
```

### 7.2 Integration validation (against `examples/springcloud-demo`)

After Team G's example project is bootstrapped:

```bash
# 1. Build
npm run build

# 2. Run Team D resolvers on the demo
npx tsx packages/springkg-runtime/src/config-resolver.ts examples/springcloud-demo
npx tsx packages/springkg-runtime/src/middleware-inventory.ts examples/springcloud-demo
npx tsx packages/springkg-runtime/src/nacos-config-resolver.ts examples/springcloud-demo
npx tsx packages/springkg-runtime/src/gateway-route-resolver.ts examples/springcloud-demo

# 3. Verify rows in springkg.db
sqlite3 examples/springcloud-demo/.codegraph/springkg.db <<'SQL'
-- Config properties
SELECT COUNT(*) FROM runtime_config_properties;
-- expect >= 10 in demo

-- Sensitive masking (must be 0 plaintext)
SELECT COUNT(*) FROM runtime_config_properties
WHERE is_sensitive=1 AND value_masked NOT LIKE '***%';
-- expect: 0

-- Middleware
SELECT kind, COUNT(*) FROM spring_symbols
WHERE kind IN ('middleware', 'config_property', 'nacos_cluster', 'nacos_config', 'gateway_route')
GROUP BY kind;

-- Edges
SELECT kind, COUNT(*) FROM spring_edges
WHERE kind IN ('CONNECTS_TO', 'LOADS_CONFIG', 'ROUTES_TO', 'MATCHES_PATH', 'USED_BY')
GROUP BY kind;
SQL
```

### 7.3 Cross-team contract smoke test

Before declaring T15 done, confirm with Team A that `kg.upsertSymbol()` + `kg.recordConfigProperty()` actually persist (read-back a known record). Before declaring T38 done, confirm with Team A that `kg.codegraph.findNodes({ decoratorPattern: '...' })` returns the expected nodes.

### 7.4 QA scenarios (per task — paste into evidence file)

For each task, the evidence file must contain:

1. `npx vitest run <task>` output (last 20 lines, must be `PASS`).
2. `npx tsc --noEmit` output (must be empty / zero errors).
3. SQLite read-back of the relevant table/kind.
4. The fixture file path that triggered the case.
5. If sensitive masking: explicit confirmation that `is_sensitive=1` rows have `value_masked` matching `^\*\*\*.{0,4}$` (no plaintext).

### 7.5 Forbidden patterns (auto-fail in F4 review)

| Pattern | Where checked | Penalty |
|---|---|---|
| Plaintext password/secret/token in `runtime_config_properties.value_masked` | `sqlite3` query | FAIL |
| Plaintext in `spring_symbols.metadata_json` for sensitive keys | grep + jq | FAIL |
| Raw SQL writes bypassing `kg.upsertSymbol/upsertEdge/recordConfigProperty` | grep for `INSERT INTO spring_symbols` in `packages/springkg-runtime/src/**` | FAIL |
| Touching `packages/springkg-{core,shared,semantic,data,mcp,cli}/**` | git diff | FAIL |
| Touching `packages/codegraph/**` (CodeGraph upstream) | git diff | FAIL |
| `console.log` left in production paths | grep | WARN (allowed in tests only) |
| `as any` / `@ts-ignore` | grep | WARN, document in commit |

---

## 8. Commit & Merge Strategy

### 8.1 Commit granularity

One commit per task — `task 15: ConfigResolver`, etc. Format:

```
[D] task 15: ConfigResolver

- Implement packages/springkg-runtime/src/config-resolver.ts
- Implement internal/yaml-loader.ts + property-flatten.ts + key-mask.ts
- 6 vitest cases pass
- Masking verified: 0 plaintext sensitive values
- Evidence: .omo/evidence/team-d/task-15-config-resolver.txt
Refs: #T15 (Team D plan)
```

### 8.2 Merge points

| After | Action |
|---|---|
| T15 + T16 done + tests pass | PR `team-d-runtime` → `main`, **wait for sync-point A** (Team E unblocks T20) |
| T37 + T38 + T39 + T63 done + tests pass | PR `team-d-runtime` → `main`, **wait for sync-point B** (Team E unblocks T44/T45) |
| F1-F4 final verification APPROVE | Tag `v0.4.0-springkg-runtime` |

### 8.3 Worktree reminder

```bash
# Setup (Team G runs once, then hands to Team D)
git fetch && git worktree add -b team-d-runtime ../cg-team-d main

# Daily
cd ../cg-team-d
git pull origin main --rebase
git rebase main
git push -u origin team-d-runtime

# Before PR
npx vitest run     # all tests pass
npx tsc --noEmit   # zero errors
git diff --stat main  # only packages/springkg-runtime/** and .omo/evidence/team-d/**
```

---

## 9. Risk & Mitigation

| Risk | Mitigation |
|---|---|
| Team A's `SpringKg` API is not stable during Phase 2 | Wrap all Team A API calls in a thin `internal/db.ts` adapter — when Team A changes the API, only one file to update |
| `@ConfigurationProperties` with custom `@AliasFor` may not resolve prefix correctly | First version: regex-only on `(prefix\s*=\s*"([^"]+)")` literal. Document limitation in evidence file. V2 enhancement later. |
| Nacos `spring.config.import=nacos:` syntax has multiple variants | Support `nacos:dataId`, `nacos:dataId?group=X`, `nacos:dataId?group=X&namespace=Y`, `nacos:dataId?refreshEnabled=false`. Skip if unsure, log warning. |
| Gateway `lb://` URI but no matching `micro_service` symbol in DB | Create stub `micro_service:<serviceName>` with `metadata_json.stub=true` (so the edge is still queryable). Flag stub in commit. |
| File watcher fires during indexing, causing duplicate writes | Use `BEGIN IMMEDIATE` transaction wrapping per-resolver run; rely on deterministic IDs for idempotency. |
| Sensitive value appears in `metadata_json` of `nacos_cluster` (e.g. `nacos.password`) | Always run `key-mask.ts` over any value field stored in `metadata_json` before write. Add a defensive test in each resolver that includes a sensitive fixture. |

---

## 10. Definition of Done (Team D)

- [x] All 6 tasks (T15, T16, T37, T38, T39, T63) implemented with tests passing.
- [x] 6 evidence files in `.omo/evidence/team-d/`.
- [x] `npx vitest run` in `packages/springkg-runtime` → 0 failures.
- [x] `npx tsc --noEmit` → 0 errors.
- [ ] Demo project (`examples/springcloud-demo`) integration test passes — sqlite has rows in `runtime_config_properties` and `spring_symbols(kind IN {config_property, middleware, nacos_*, gateway_route})`.
- [ ] Zero plaintext sensitive values in DB (verified via `sqlite3` query).
- [x] Only writes `config_property`, `middleware`, `nacos_cluster`, `nacos_config`, `nacos_service`, `gateway_route` kinds (no other teams' kinds leaked).
- [x] Only writes `CONNECTS_TO`, `LOADS_CONFIG`, `ROUTES_TO`, `MATCHES_PATH`, `USED_BY` edges (no other teams' edges leaked).
- [x] `packages/codegraph/**` UNTOUCHED (verified by `git diff main -- packages/codegraph/`).
- [x] No files outside `packages/springkg-runtime/**` modified (except the optional 10-line CLI shim in `packages/springkg-cli/src/commands/sync-nacos.ts`).
- [ ] PR `team-d-runtime` reviewed by at least one Team A reviewer (for API contract compliance).

**Note**: Items 5-6 (Demo project integration test and sensitive value verification) require `examples/springcloud-demo` to be set up, which is Team G's responsibility. Item 9 requires Team A code review.**