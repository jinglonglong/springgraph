# Team B — Spring Annotation Semantic Layer

> **Scope**: Resolvers that translate Spring/Java code into `springkg.db` symbols and edges from the **annotation layer** (controllers, services, Feign clients, endpoints). Database access, MyBatis, runtime config, MCP tools, and demos are owned by other teams — see `springcloud.md` for the master plan.

---

## Team Overview

Team B is the **semantic bridge** between the CodeGraph baseline (which already extracts `@RestController`, `@Service`, `@GetMapping`, etc. via tree-sitter) and the SpringCloud domain model that Team E exposes over MCP. We own:

- **Annotation classification** (which Spring stereotype is which)
- **Endpoint extraction** (merged class-level + method-level `@RequestMapping`)
- **Feign client detection** (`@FeignClient` interface + Spring MVC mapping)
- **Feign→Provider bridging** (`feign_method` → `endpoint` routing)
- **Feign DTO inference** (request/response DTOs from Feign signatures)
- **Add vs Reuse policy** (which Spring annotations deserve a fresh `spring_symbols` row vs. a `codegraph_node_id` pointer to the existing CodeGraph row)

Everything we write is **append-only** to `springkg.db` — we never delete or modify rows owned by Teams A, C, D, or F, and we never touch CodeGraph's own tables.

---

## Owned Files

**Only Team B may modify these paths.** Any change outside this list is a contract violation; coordinate via `docs/team-coordination.md` (Team G) before crossing team boundaries.

| Path | Purpose |
|---|---|
| `packages/springkg-semantic/src/annotation-engine.ts` | T12 — `AnnotationSemanticEngine` |
| `packages/springkg-semantic/src/endpoint-resolver.ts` | T13 — `EndpointResolver` |
| `packages/springkg-semantic/src/feign-resolver.ts` | T14 — `FeignResolver` |
| `packages/springkg-semantic/src/feign-provider-bridge.ts` | T41 — `FeignProviderBridge` |
| `packages/springkg-semantic/src/feign-dto.ts` | T42 — `FeignRequestResponseType` |
| `packages/springkg-semantic/src/policy.ts` | T68 — Add vs Reuse policy |
| `packages/springkg-semantic/src/index.ts` | Barrel export (resolvers wired to `Resolver` interface) |
| `packages/springkg-semantic/__tests__/annotation-engine.test.ts` | T12 tests (8 cases) |
| `packages/springkg-semantic/__tests__/endpoint-resolver.test.ts` | T13 tests (5 cases) |
| `packages/springkg-semantic/__tests__/feign-resolver.test.ts` | T14 tests (5 cases) |
| `packages/springkg-semantic/__tests__/feign-provider-bridge.test.ts` | T41 tests (2 cases) |
| `packages/springkg-semantic/__tests__/feign-dto.test.ts` | T42 tests (1 case) |
| `packages/springkg-semantic/__tests__/policy.test.ts` | T68 dedup verification |
| `packages/springkg-semantic/package.json` | Package manifest (add `@colbymchenry/codegraph` as a peer/dev dep on the SpringJava extractor path) |
| `packages/springkg-semantic/tsconfig.json` | TypeScript config (extends repo root) |
| `packages/springkg-semantic/vitest.config.ts` | Test runner config |

We **read** (but never write):
- `packages/springkg-shared/src/**` — `Resolver`, `SpringKgNode`, `SpringKgEdge`, `SpringKgEnhanceInput`/`Output`, `SpringKgNodeKind`, `SpringKgEdgeKind` (Team A)
- `packages/springkg-core/src/**` — `SpringKg` class, schema migrations, `db.ts` (Team A)

---

## Cross-team Contracts

### Input (consumed from Team A)

```typescript
import type {
  SpringKgEnhanceInput,   // { codegraphNodes: Node[], codegraphEdges: Edge[], changedFiles: string[] }
  SpringKgEnhanceOutput,  // { symbolsAdded, edgesAdded, byKind: Record<string, number> }
  SpringKgNode,           // our own row shape (we build it)
  SpringKgEdge,           // our own row shape (we build it)
  Resolver,               // { name: string; enhance(input): Promise<output> }
} from '@codegraph-springcloud/springkg-shared';
```

`codegraphNodes` come from CodeGraph's Java extractor — each node has `decorators: string[]` (already populated by CodeGraph's Spring framework pattern, see `src/resolution/frameworks/spring.ts`). We do **not** parse Java source ourselves; we consume the CodeGraph node stream and reclassify.

### Output (consumed by Team E MCP tools)

Team E builds `spring_find_entry`, `spring_trace_flow`, `spring_find_feign`, `spring_assets_overview`, etc. on top of rows we write. After Team B finishes, the following MUST be populated by an `indexAll` pass:

| `spring_symbols.kind` | Team B source | Team E consumer tool |
|---|---|---|
| `controller` | T12 | `spring_find_entry({controller:"*"})` |
| `service` | T12 | `spring_trace_flow` (intermediate hop) |
| `repository` | T12 | `spring_assets_overview` |
| `component` | T12 | `spring_assets_overview` |
| `configuration` | T12 | (rarely queried) |
| `feign_client` | T14 | `spring_find_feign` |
| `feign_method` | T14 | `spring_find_feign` (members) |
| `endpoint` | T13 | `spring_trace_flow` (entry node), `spring_find_entry({url:"..."})` |
| `remote_service` | T14 | `spring_find_feign` (target service) |

| `spring_edges.kind` | Team B source | Team E consumer |
|---|---|---|
| `HANDLED_BY` | T13 (endpoint → method) | `spring_trace_flow` |
| `CALLS` | T13 (controller method → service method via Java AST) | `spring_trace_flow` |
| `BELONGS_TO` | T12 (method → class), T14 (feign_method → feign_client) | aggregation |
| `CALLS_FEIGN` | T14 (caller method → feign_method) | `spring_trace_flow` |
| `TARGETS_ENDPOINT` | T41 (feign_method → endpoint) | `spring_find_feign` (target_endpoint) |

### Append-only discipline

- We only INSERT into `spring_symbols` and `spring_edges`. Never `DELETE`/`UPDATE` rows we did not write.
- Hash-based node IDs (`${kind}:${sha256truncated_32chars}`) are **deterministic** so re-running on the same source is idempotent — second run is a no-op.
- We never create rows under kind names owned by other teams (`mapper`, `sql_statement`, `entity`, `table`, `column`, `config_property`, `middleware`, `nacos_*`, `gateway_route`, `feature_community`, `feature_community_member`).

---

## Task List

Each task follows TDD: write failing test → minimal implementation → green → refactor. Save evidence to `.omo/evidence/team-b/task-{N}-{slug}.{ext}` (SQL dumps, test output, fixture files).

### Annotation classification map (shared)

All six tasks share this fixture convention. From a CodeGraph `Node` (kind=`class`, `decorators: string[]`), the classifiers in this table drive routing. The classifier is `pure` — no DB access — so it can be unit-tested in isolation.

| Decorator (substring match, case-insensitive) | `spring_symbols.kind` | Reuse or Add |
|---|---|---|
| `@RestController` | `controller` | **REUSE** (CodeGraph already extracted the class) |
| `@Controller` | `controller` | **REUSE** |
| `@Service` | `service` | **REUSE** |
| `@Repository` | `repository` | **REUSE** |
| `@Component` (and not a more specific stereotype) | `component` | **REUSE** |
| `@Configuration` (without `@Bean` methods) | `configuration` | **ADD** (CodeGraph does not surface `@Configuration`) |
| `@Mapper` (MyBatis) | `mapper` | **ADD** — shared kind with Team C; we emit it so Team C can attach SQL metadata |
| `@FeignClient` | `feign_client` | **ADD** — interface, not a regular class; CodeGraph's extractor may not label it |
| `@Bean` (on a method inside `@Configuration`) | `bean` | **ADD** — Team B emits the parent `configuration`; Team C may pick up beans |
| `@ConfigurationProperties` (on a class) | `config_property` | **ADD** — declared but **owned by Team D**; we do not emit (cross-team boundary). The policy documents this hand-off. |

`REUSE` = `codegraph_node_id` pointer, content fields (`path`, `body_hash`, `signature`) are null on the `spring_symbols` row.
`ADD` = full row with path/body_hash/signature computed by us.

---

- [ ] 1. [B] AnnotationSemanticEngine in `packages/springkg-semantic/src/annotation-engine.ts` — classify Spring stereotypes, REUSE for CodeGraph-known, ADD for unknown
- [ ] 2. [B] EndpointResolver in `packages/springkg-semantic/src/endpoint-resolver.ts` — merge class+method `@RequestMapping`, fan out multi-path, extract request/response DTOs
- [ ] 3. [B] FeignResolver in `packages/springkg-semantic/src/feign-resolver.ts` — detect `@FeignClient` interfaces, parse attributes, emit feign_method nodes
- [ ] 4. [B] FeignProviderBridge in `packages/springkg-semantic/src/feign-provider-bridge.ts` — match feign_method to provider endpoint (same-monorepo exact, cross-service by name)
- [ ] 5. [B] FeignRequestResponseType in `packages/springkg-semantic/src/feign-dto.ts` — extract request/response DTOs from Feign method signatures
- [ ] 6. [B] Add vs Reuse policy in `packages/springkg-semantic/src/policy.ts` — enforce REUSE/ADD lists, implement dedup, document hand-offs to Team C/D

---

### 1. [B] AnnotationSemanticEngine (T12)

**File**: `packages/springkg-semantic/src/annotation-engine.ts`

**Public API**:
```typescript
export class AnnotationSemanticEngine implements Resolver {
  readonly name = 'annotation-engine';
  enhance(input: SpringKgEnhanceInput): Promise<SpringKgEnhanceOutput>;
}

export type SpringEntity = {
  kind: SpringKgNodeKind;       // 'controller' | 'service' | 'repository' | 'component' | 'configuration' | 'mapper' | 'feign_client' | 'bean'
  codegraphNodeId: string;     // points to nodes.codegraph
  name: string;
  filePath: string;
  reuse: boolean;              // true if CodeGraph already has this row
  metadata?: Record<string, unknown>;  // e.g. { feignName, feignPath } for feign_client
};
```

**Behavior** (per Metis C7 / T68):
- Input: `Node[]` from `input.codegraphNodes` (CodeGraph Java extractor output).
- For each node whose kind is `class` or `interface` and `decorators?.length > 0`:
  - Match against the **annotation classification map** above.
  - If matched AND in REUSE list (`@RestController`/`@Controller`/`@Service`/`@Repository`/`@Component`): emit a `SpringEntity` with `reuse: true`. The `spring_symbols` row written by the persistence layer uses `codegraph_node_id = node.id` and leaves content fields (`path`, `body_hash`, `signature`) **NULL**.
  - If matched AND in ADD list (`@Configuration`, `@Mapper`, `@FeignClient`): emit with `reuse: false`. Persistence layer fills `path`, `body_hash`, `signature` from the CodeGraph node.
  - If matched AND owned by another team (`@ConfigurationProperties` → `config_property`): skip silently; policy docs note Team D emits these.
- Output: `SpringEntity[]`. Persistence layer (`@codegraph-springcloud/springkg-core`) writes to `spring_symbols` with `confidence` from policy (REUSE = `1.0` since CodeGraph is authoritative, ADD = `0.9`).

**Edge emission**:
- For every class emitted as `controller`/`service`/`repository`/`component`/`configuration`, iterate its `codegraphEdges` (kind `contains`) and emit `spring_edges(kind=BELONGS_TO, source=method_node_id, target=class_node_id)` for each method/property child.

**Tests** (`annotation-engine.test.ts`, **8 cases**):

| # | Decorator set | Expected kind | Reuse? |
|---|---|---|---|
| 1 | `['@RestController']` | `controller` | yes |
| 2 | `['@Controller']` | `controller` | yes |
| 3 | `['@Service']` | `service` | yes |
| 4 | `['@Repository']` | `repository` | yes |
| 5 | `['@Component']` (alone) | `component` | yes |
| 6 | `['@Configuration']` (no `@Bean` methods) | `configuration` | **no** |
| 7 | `['@Mapper']` | `mapper` (Team C hand-off marker) | no |
| 8 | `['@FeignClient(name="user-svc")']` (interface) | `feign_client` (with `metadata.feignName='user-svc'`) | no |

Plus a 9th negative case: a class with no Spring decorators → engine returns no entity (no false positives).

**Verification**:
```bash
npx vitest run packages/springkg-semantic/__tests__/annotation-engine.test.ts
# expected: 9 tests passing
```

---

### 2. [B] EndpointResolver (T13)

**File**: `packages/springkg-semantic/src/endpoint-resolver.ts`

**Public API**:
```typescript
export class EndpointResolver implements Resolver {
  readonly name = 'endpoint-resolver';
  enhance(input: SpringKgEnhanceInput): Promise<SpringKgEnhanceOutput>;
}

export type SpringEndpoint = {
  codegraphNodeId: string;       // method-level CodeGraph node (the @GetMapping handler)
  controllerCodegraphNodeId: string;  // parent class
  httpMethod: 'GET'|'POST'|'PUT'|'DELETE'|'PATCH'|'OPTIONS'|'HEAD';
  path: string;                  // resolved full path
  classPath?: string;            // pre-merge @RequestMapping value on class
  methodPath: string;            // @GetMapping value on method
  params: SpringParam[];         // extracted from method signature
  requestDtoCodegraphNodeId?: string;
  responseDtoCodegraphNodeId?: string;
};

export type SpringParam = {
  name: string;
  kind: 'RequestParam' | 'PathVariable' | 'RequestBody' | 'RequestHeader';
  typeName?: string;             // Java type as string (from CodeGraph parameter node)
  required?: boolean;            // default true; false if `required=false`
};
```

**Behavior**:
- Iterate `Node[]` where `kind === 'method'` AND `decorators.some(d => d.includes('@') && /Mapping$/.test(d))`.
- For each method:
  - Look up the parent class via `codegraphEdges(kind=contains)` and read its `decorators` for `@RequestMapping(...)` → extract `classPath` (default `''`).
  - Read the method's decorators:
    - `@RequestMapping`, `@GetMapping`, `@PostMapping`, `@PutMapping`, `@DeleteMapping`, `@PatchMapping` → derive `httpMethod` (verb-mapping decorators fix the method; `@RequestMapping` accepts `method = RequestMethod.GET` attribute — default to GET if unspecified).
    - Extract `value` (or `path`) — array or single string. **Multi-path**: `value: ['/a', '/b']` → fan out into 2 `SpringEndpoint` rows.
    - Concatenate `classPath + methodPath` → `path` (resolve `//` → `/`, trim trailing `/` unless root).
  - Extract `params` from the method's parameters (use CodeGraph `parameter` nodes linked via `contains`):
    - For each parameter node, read its decorators for `@RequestParam`, `@PathVariable`, `@RequestBody`, `@RequestHeader` (and the `name`/`value`/`required` attributes).
  - Extract `requestDtoCodegraphNodeId` from the first `@RequestBody`-annotated parameter's type (resolve type by CodeGraph type-resolution).
  - Extract `responseDtoCodegraphNodeId` from the method's return type (resolve by CodeGraph).
- Persistence: write one `spring_symbols` row per `SpringEndpoint` with `kind='endpoint'`, `confidence=1.0` (HTTP mapping is unambiguous).
- Edge emission:
  - `spring_edges(kind=HANDLED_BY, source=endpoint_node_id, target=method_codegraph_node_id)`.
  - `spring_edges(kind=CALLS, source=method_codegraph_node_id, target=<each service/repo/component the method calls>)` — derive by walking the method's body for `calls` edges CodeGraph already extracted.

**Tests** (`endpoint-resolver.test.ts`, **5 cases**):

| # | Fixture | Expected |
|---|---|---|
| 1 | Class-level `@RequestMapping('/api/v1')` only, no method decorator | No endpoint emitted (a bare class-level mapping without verb is incomplete) |
| 2 | Method-level `@GetMapping('/users/{id}')` on a class with no class-level mapping | 1 endpoint: `GET /users/{id}` |
| 3 | Class `@RequestMapping('/api')` + method `@GetMapping('/users')` | 1 endpoint: `GET /api/users` (merged) |
| 4 | Method `@RequestMapping({ value: ['/a', '/b'], method: GET })` | 2 endpoints: `GET /a`, `GET /b` (multi-path fan-out) |
| 5 | Method `@GetMapping('/search') public List<UserDto> search(@RequestParam String q, @RequestParam(defaultValue='10') int limit)` | 1 endpoint, 2 params (`q` required, `limit` required), responseDto = `UserDto` |

**Verification**:
```bash
npx vitest run packages/springkg-semantic/__tests__/endpoint-resolver.test.ts
# expected: 5 tests passing
```

---

### 3. [B] FeignResolver (T14)

**File**: `packages/springkg-semantic/src/feign-resolver.ts`

**Public API**:
```typescript
export class FeignResolver implements Resolver {
  readonly name = 'feign-resolver';
  enhance(input: SpringKgEnhanceInput): Promise<SpringKgEnhanceOutput>;
}

export type FeignClientSpec = {
  codegraphNodeId: string;     // the interface node
  name?: string;               // @FeignClient(name="...") — primary
  value?: string;              // @FeignClient(value="...") — alias for name
  contextId?: string;          // @FeignClient(contextId="...")
  path?: string;               // @FeignClient(path="/...")
  url?: string;                // @FeignClient(url="http://...") — direct-connect
  targetServiceName: string;   // resolved: name ?? value ?? contextId (confidence 1.0)
  isDirectConnect: boolean;    // true if url attribute present
};
```

**Behavior**:
- Iterate `Node[]` where `kind === 'interface'` AND any decorator matches `@FeignClient`.
- Decorator string is regex-parsed (CodeGraph already lower-cased/stripped — match attribute strings inside parens):
  - `name\s*=\s*"([^"]+)"` → `name`
  - `value\s*=\s*"([^"]+)"` → `value`
  - `contextId\s*=\s*"([^"]+)"` → `contextId`
  - `path\s*=\s*"([^"]+)"` → `path`
  - `url\s*=\s*"([^"]+)"` → `url`, `isDirectConnect=true`
- Resolve `targetServiceName`:
  - Priority: `name` → `value` → `contextId` → `codegraphNode.name` (interface name, kebab-cased).
  - Confidence: `1.0` if name or value matched; `0.7` if fell back to contextId or interface name.
- Scan interface methods via `codegraphEdges(kind=contains)`:
  - For each method, parse Spring MVC mapping decorators (`@GetMapping`, `@PostMapping`, etc.) — **reuse the same regex set as `EndpointResolver`**.
  - Emit one `feign_method` `spring_symbols` row per method-with-mapping with `metadata.feignPath` = `${feignClient.path ?? ''}${methodPath}`, `metadata.httpMethod`, `metadata.paramTypes`, `metadata.returnType`.
- Persistence:
  - `spring_symbols(kind=feign_client)` per interface (ADD — confidence from `targetServiceName` resolution).
  - `spring_symbols(kind=remote_service)` per unique `target_service_name` (ADD — confidence 1.0 if `url` provided, else 0.8).
  - `spring_symbols(kind=feign_method)` per method (ADD).
  - `spring_edges(kind=BELONGS_TO, source=feign_method_id, target=feign_client_id)`.

**Tests** (`feign-resolver.test.ts`, **5 cases**):

| # | Decorator string | Expected fields |
|---|---|---|
| 1 | `@FeignClient(name="user-service")` | `targetServiceName='user-service'`, confidence 1.0 |
| 2 | `@FeignClient(value="order-svc")` | `targetServiceName='order-svc'`, confidence 1.0 |
| 3 | `@FeignClient(contextId="legacyX")` | `targetServiceName='legacyX'`, confidence 0.7 |
| 4 | `@FeignClient(name="x", path="/api/v2")` | `targetServiceName='x'`, `path='/api/v2'` |
| 5 | `@FeignClient(name="x", url="http://static.example.com/x")` | `targetServiceName='x'`, `isDirectConnect=true`, `url` set; emits `remote_service` row with confidence 1.0 |

Plus method-scanning assertions: a `@GetMapping("/list") UserDto[] list()` method on the interface → 1 `feign_method` row, `feignPath='/list'`, `httpMethod='GET'`, `returnType='UserDto[]'`.

**Verification**:
```bash
npx vitest run packages/springkg-semantic/__tests__/feign-resolver.test.ts
# expected: 5+ tests passing
```

---

### 4. [B] FeignProviderBridge (T41)

**File**: `packages/springkg-semantic/src/feign-provider-bridge.ts`

**Public API**:
```typescript
export class FeignProviderBridge implements Resolver {
  readonly name = 'feign-provider-bridge';
  enhance(input: SpringKgEnhanceInput): Promise<SpringKgEnhanceOutput>;
}
```

**Behavior**:
- Input: `input.codegraphNodes` (filtered to those with `kind === 'endpoint'` and `metadata.serviceHint` from same-monorepo resolution — i.e. same Java package or same Spring Boot module) **OR** rows in `spring_symbols(kind=endpoint)` we already wrote.
- Also fetch: all `spring_symbols(kind=feign_method)` rows.
- Match rules (in priority order):
  1. **Same monorepo, exact match**: `feign_method.metadata.feignPath == endpoint.path && feign_method.metadata.httpMethod == endpoint.httpMethod` → emit `spring_edges(kind=TARGETS_ENDPOINT, source=feign_method_id, target=endpoint_id, confidence=1.0, metadata={matchRule:'same-monorepo-exact'})`.
  2. **Cross-service, name-based**: `feign_method.metadata.feignPath == endpoint.path` (HTTP method may differ) → emit with `confidence=0.5`, `metadata={matchRule:'cross-service-name', targetServiceName: feign_method.parent_feign_client.target_service_name}`.
- Run AFTER FeignResolver + EndpointResolver in the resolution pipeline so all rows exist.
- Output: append-only `spring_edges(kind=TARGETS_ENDPOINT)`.

**Tests** (`feign-provider-bridge.test.ts`, **2 cases**):

| # | Setup | Expected |
|---|---|---|
| 1 | Feign method `@GetMapping('/users/{id}')` on `UserClient` (target=user-svc) + same-monorepo endpoint `GET /users/{id}` on `UserController` | 1 `TARGETS_ENDPOINT` edge, confidence 1.0, matchRule `same-monorepo-exact` |
| 2 | Feign method on `OrderClient` (target=order-svc) + cross-service endpoint `GET /orders` in a *different* monorepo manifest | 1 `TARGETS_ENDPOINT` edge, confidence 0.5, matchRule `cross-service-name`, `targetServiceName='order-svc'` |

**Verification**:
```bash
npx vitest run packages/springkg-semantic/__tests__/feign-provider-bridge.test.ts
# expected: 2 tests passing
```

---

### 5. [B] FeignRequestResponseType (T42)

**File**: `packages/springkg-semantic/src/feign-dto.ts`

**Public API**:
```typescript
export class FeignRequestResponseType implements Resolver {
  readonly name = 'feign-dto';
  enhance(input: SpringKgEnhanceInput): Promise<SpringKgEnhanceOutput>;
}

export type FeignDtoBinding = {
  feignMethodId: string;
  requestDto?: { codegraphNodeId: string; typeName: string };
  responseDto?: { codegraphNodeId: string; typeName: string };
  paramTypes: Array<{ codegraphNodeId?: string; typeName: string; decorator?: string }>;
};
```

**Behavior**:
- Iterate `spring_symbols(kind=feign_method)` rows (populated by T14).
- For each, look up the CodeGraph `method` node and read its parameter + return type via `codegraphEdges(kind=contains)` → `parameter` nodes, plus the method's `returnType` attribute (CodeGraph already extracts it for Java).
- For each parameter:
  - Resolve its Java type (e.g. `UserDto`, `PageRequest`) via CodeGraph type-resolution (walk `imports` edges → find the `class` node in `nodes.codegraph`).
  - If exactly one `@RequestBody`-decorated parameter → mark as `requestDto`.
- For the return type:
  - Resolve via CodeGraph type-resolution. Skip primitive types (`void`, `int`, `String`, `List<String>` when fully primitive).
- Persist:
  - For each non-primitive type encountered, ensure a `spring_symbols(kind=dto)` row exists (ADD — confidence 0.9). Set `metadata.fromFeignMethodId=feignMethodId` and `metadata.role='request'|'response'`.
  - `spring_edges(kind=USES_DTO, source=feign_method_id, target=dto_id)` — note: `USES_DTO` is not in Team B's owned edge kinds. Use existing `references` edge kind from CodeGraph's `spring_edges.kind` enum if `USES_DTO` is not in the shared `SpringKgEdgeKind` union; coordinate with Team A if a new edge kind is needed.

**Tests** (`feign-dto.test.ts`, **1 case**):

| # | Fixture | Expected |
|---|---|---|
| 1 | Feign method `UserDto create(@RequestBody CreateUserRequest req)` on `UserClient` | `requestDto.typeName='CreateUserRequest'`, `responseDto.typeName='UserDto'`, 2 `dto` rows in `spring_symbols`, 2 `references` edges (or `USES_DTO` if added to shared types) |

**Verification**:
```bash
npx vitest run packages/springkg-semantic/__tests__/feign-dto.test.ts
# expected: 1 test passing
```

---

### 6. [B] Add vs Reuse Policy (T68, Metis C7)

**File**: `packages/springkg-semantic/src/policy.ts`

**Public API**:
```typescript
export const REUSE_DECORATORS: readonly string[] = [
  '@RestController', '@Controller', '@Service', '@Repository', '@Component',
  '@GetMapping', '@PostMapping', '@PutMapping', '@DeleteMapping', '@PatchMapping',
  '@RequestMapping', // method-level mapping (class-level is REUSE-only via the class node)
  '@PathVariable', '@RequestParam', '@RequestHeader',
];

export const ADD_DECORATORS: readonly string[] = [
  '@FeignClient', '@Mapper', '@Configuration',
  '@Bean',                 // method-level, inside @Configuration
  // @ConfigurationProperties is documented as Team D's hand-off; do not emit
];

export const HANDOFF_DECORATORS = {
  '@ConfigurationProperties': 'team-d-runtime',  // config_property
  // add more as discovered
};

export function shouldReuse(decorators: string[]): boolean;
export function shouldAdd(decorators: string[]): boolean;
export function handoffTeam(decorators: string[]): 'team-d-runtime' | 'team-c-data' | null;

export class ReusePolicy {
  // dedup: given (kind, codegraphNodeId), returns true if a row already exists.
  // Used by AnnotationSemanticEngine before INSERT.
  dedup(kind: SpringKgNodeKind, codegraphNodeId: string, db: SpringKgDb): boolean;
}
```

**Behavior**:
- **REUSE** list is the source of truth for: "CodeGraph already has this node, do not duplicate."
- **ADD** list is the source of truth for: "CodeGraph does not surface this concept; we own the row."
- `shouldReuse` returns true iff at least one decorator matches a REUSE entry AND none match an ADD entry (ADD wins on conflict — e.g. a class with `@Component @Mapper` is treated as a `mapper` because Team C owns it).
- `handoffTeam` returns the owning team for decorators Team B recognizes but does NOT emit. Used by the engine to skip silently and log a debug-level trace.
- `ReusePolicy.dedup` is called inside `AnnotationSemanticEngine.enhance` BEFORE each INSERT:
  - Query `spring_symbols WHERE codegraph_node_id = ? AND kind = ?` — if a row exists, skip the INSERT and return `false` (no symbol added).
  - This guarantees **idempotency**: re-running `indexAll` is a no-op.

**Demo verification** (write to `__tests__/policy.test.ts` and a manual repro script):
- Index a fixture project with 10 classes: 4 `@Service`, 2 `@RestController`, 1 `@Component`, 1 `@Repository`, 2 with no Spring decorators.
- Run the engine twice (two `indexAll` calls).
- Assert: `SELECT COUNT(*) FROM spring_symbols WHERE kind IN ('service','controller','component','repository')` returns **7** (4+2+1+1), not 14. **Dedup is proven.**
- Also assert: total `spring_symbols` row count is strictly less than the count of Spring-decorated classes (because some REUSE rows leave content fields null and are still one row per class — the dedup invariant holds because each class has exactly one `codegraph_node_id`).

**Tests** (`policy.test.ts`):

- REUSE classification table (one test per entry, parameterised).
- ADD classification table.
- Conflict resolution: `@Component @Mapper` → ADD (mapper wins).
- Dedup idempotency: run enhance twice on same input, second `symbolsAdded === 0`.
- Hand-off: `@ConfigurationProperties` → `handoffTeam() === 'team-d-runtime'`, engine emits zero rows.

**Verification**:
```bash
npx vitest run packages/springkg-semantic/__tests__/policy.test.ts
# expected: ≥6 tests passing (table-driven counts as N)

# Manual demo verification on examples/springcloud-demo (Team G's project):
sqlite3 examples/springcloud-demo/.codegraph/springkg.db \
  "SELECT COUNT(*) FROM spring_symbols WHERE kind IN ('service','controller','component','repository')"
# expected: equals (count of @Service + @Controller + @RestController + @Repository + @Component classes), NOT 2x
```

---

## Sync Points

These are the **hard** dependencies on / for Team B. Skipping them blocks downstream work.

### Blocked By (upstream)

| Sync | Source | What we need before starting |
|---|---|---|
| Team A Phase 1 | `springkg-shared/src/index.ts` | `Resolver`, `SpringKgNode`, `SpringKgEdge`, `SpringKgEnhanceInput/Output` types |
| Team A Phase 1 | `springkg-core/src/db/schema.sql` | `spring_symbols` + `spring_edges` table schemas, `codegraph_node_id` FK semantics, `confidence` REAL column |
| Team A Phase 1 | `springkg-core/src/spring-kg.ts` | `SpringKg` instance — `db()`, `insertSymbol()`, `insertEdge()`, transaction boundary |

T12/T13/T14 cannot start until Team A Phase 1 lands. We will start on T68 (the policy table) and T12's classifier (pure functions, no DB) while waiting, since they only depend on the shared TypeScript types.

### Blocks (downstream)

| Sync | Consumer | What they need from us |
|---|---|---|
| **T12 must complete** | Team E | `spring_find_entry` tool — depends on `controller`/`service` rows existing |
| T13 must complete | Team E | `spring_trace_flow` tool — depends on `endpoint` rows + `HANDLED_BY` edges |
| T14 must complete | Team E | `spring_find_feign` tool — depends on `feign_client`/`feign_method`/`remote_service` rows |
| T41 must complete | Team E | `spring_find_feign` returning `target_endpoint` field — depends on `TARGETS_ENDPOINT` edges |
| T42 must complete | Team E | Feign DTO surfacing in `spring_find_feign` and `spring_field_impact` |
| T68 must complete | All teams | Dedup guarantees — prevents duplicate rows when Teams C/D run after us on the same classes |

**Hard gate**: Team E cannot begin Sprint 1 MCP tools (T18 = `spring_find_entry`, T19 = `spring_find_feign`, T20 = `spring_assets_overview`, T21 = `spring_trace_flow`) until **T12 + T13 + T14 are merged**. T41 + T42 are Sprint 1.5 — needed before Team E's Sprint 2 (`spring_method_impact`, `spring_field_impact` at T52).

### Coordination events

- Post to `docs/team-coordination.md` (Team G) when each task merges.
- Notify Team A if we need a new `SpringKgEdgeKind` value (e.g. `USES_DTO` in T42) so they can add it to the schema migration.
- Coordinate with Team C on T12's `@Mapper` emission: we emit the row first with `kind=mapper`, Team C then attaches SQL metadata via its own resolver (their `BIND_TO` edge to mapper methods). Document this hand-off in `policy.ts:HANDOFF_DECORATORS`.

---

## Verification Strategy

### Per-task verification (run before marking `[x]`)

```bash
# T12
npx vitest run packages/springkg-semantic/__tests__/annotation-engine.test.ts
# expect: 9 tests passing, coverage >= 90% for annotation-engine.ts

# T13
npx vitest run packages/springkg-semantic/__tests__/endpoint-resolver.test.ts
# expect: 5 tests passing

# T14
npx vitest run packages/springkg-semantic/__tests__/feign-resolver.test.ts
# expect: 5+ tests passing

# T41
npx vitest run packages/springkg-semantic/__tests__/feign-provider-bridge.test.ts
# expect: 2 tests passing

# T42
npx vitest run packages/springkg-semantic/__tests__/feign-dto.test.ts
# expect: 1+ tests passing

# T68
npx vitest run packages/springkg-semantic/__tests__/policy.test.ts
# expect: 6+ tests passing
```

### Cross-task verification

```bash
# Full Team B suite
npx vitest run packages/springkg-semantic
# expect: 0 failures, 0 skipped

# Build + typecheck
npx tsc --noEmit -p packages/springkg-semantic
# expect: exit 0
```

### Integration verification (after Phase 2 of main plan)

```bash
# Run on Team G's demo project (examples/springcloud-demo must be initialized by Team G first)
npx vitest run packages/springkg-semantic -- --reporter=verbose

# Inspect springkg.db after a full indexAll on demo
sqlite3 examples/springcloud-demo/.codegraph/springkg.db <<SQL
SELECT kind, COUNT(*) FROM spring_symbols WHERE kind IN (
  'controller','service','repository','component','configuration','mapper',
  'feign_client','feign_method','endpoint','remote_service','dto'
) GROUP BY kind;
SQL
# expect: every kind from Team B's owned list has >= 1 row (where demo project exercises it)

SELECT kind, COUNT(*) FROM spring_edges WHERE kind IN (
  'HANDLED_BY','CALLS','BELONGS_TO','CALLS_FEIGN','TARGETS_ENDPOINT'
) GROUP BY kind;
# expect: HANDLED_BY and BELONGS_TO have row counts; CALLS_FEIGN and TARGETS_ENDPOINT
# depend on demo having Feign clients

# Dedup verification (T68 demo)
sqlite3 examples/springcloud-demo/.codegraph/springkg.db \
  "SELECT COUNT(DISTINCT codegraph_node_id), COUNT(*) FROM spring_symbols WHERE kind IN ('service','controller','component','repository')"
# expect: the two counts are EQUAL (no duplicates per codegraph_node_id within REUSE kinds)
```

### Evidence capture

For each task, save to `.omo/evidence/team-b/task-{N}-{slug}.{ext}`:
- `task-12-annotation-engine.json` — vitest JSON output
- `task-13-endpoint-resolver.sql` — `spring_endpoints`-equivalent row dump from a fixture project
- `task-14-feign-resolver.sql` — `spring_feign_clients` + `spring_symbols(feign_method)` row dump
- `task-41-feign-provider-bridge.sql` — `spring_edges(TARGETS_ENDPOINT)` row dump
- `task-42-feign-dto.sql` — `spring_symbols(dto)` row dump
- `task-68-policy.md` — REUSE/ADD/HANDOFF table documentation + idempotency proof

---

## Definition of Done (Team B)

- [ ] All 6 tasks complete with passing tests
- [ ] `npx vitest run packages/springkg-semantic` returns 0 failures
- [ ] `npx tsc --noEmit -p packages/springkg-semantic` returns exit 0
- [ ] All 8 annotation classification cases pass (T12)
- [ ] All 5 endpoint resolution cases pass (T13)
- [ ] All 5 Feign attribute cases pass (T14)
- [ ] Both FeignProviderBridge cases pass (T41)
- [ ] Feign DTO extraction case passes (T42)
- [ ] Dedup verified: re-running enhance() is a no-op (T68)
- [ ] `spring_symbols` row count is strictly less than total Spring-decorated class count (T68 demo)
- [ ] No file outside `packages/springkg-semantic/**` modified
- [ ] No edits to `packages/codegraph/` (upstream)
- [ ] `springkg.db` lives in `.codegraph/`, not `.springkg/`
- [ ] Evidence files written to `.omo/evidence/team-b/`
- [ ] Branch `team-b-semantic` ready to merge

---

## Worktree & Branch

```bash
# After Team A Phase 1 merges to main:
git fetch origin
git worktree add -b team-b-semantic ../cg-team-b main
cd ../cg-team-b
npm ci
```

Commit at each task boundary (not per-file). Squash on merge.