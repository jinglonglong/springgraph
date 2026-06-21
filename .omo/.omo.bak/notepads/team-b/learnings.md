# Team B Learnings

## [2026-06-19] Local stub strategy for springkg-semantic

### Decision: local shared-types stub

Team A Phase 1 (packages/springkg-shared, packages/springkg-core, root workspaces) has not landed yet, so any import of @codegraph-springcloud/springkg-shared would fail at build time.

**Workaround:** packages/springkg-semantic/src/shared-types.ts defines the minimal types Team B needs right now:
- SpringKgNodeKind, SpringKgEdgeKind (literal union types for Spring stereotypes)
- CodegraphNodeLike, CodegraphEdgeLike (compatible with the root src/types.ts shapes Team A will wrap)
- SpringKgNode, SpringKgEdge, SpringKgEnhanceInput, SpringKgEnhanceOutput, Resolver

When Team A lands, replace the local stub with the real @codegraph-springcloud/springkg-shared package — the interface shapes are designed to be compatible.

### Config gotchas

- **tsconfig.json must NOT extend the root tsconfig.** The root tsconfig has references pointing to packages/springkg-shared, packages/springkg-core, etc. — none of which exist yet. If this package's tsconfig extends the root, the reference resolution fails and the whole composite build breaks. Solution: copy the compilerOptions locally and set composite: false.
- **package.json must NOT declare "type": "module"** unless paired with an explicit .cjs output or a separate build step. The root uses commonjs module mode, and mixing module modes without explicit build config causes Cannot use import statement errors at runtime. Keep package.json silent on type (defaults to commonjs) and match the root's module: commonjs.
- **references in tsconfig are not needed** for a self-contained package that does not depend on other local packages outputs. Skipping them avoids the broken-reference problem entirely.
- **Vitest config** mirrors root conventions: globals: true, environment: node, include: __tests__/**/*.test.ts.

### Files created

packages/springkg-semantic/
  package.json          — name, scripts (test, typecheck), minimal devDeps
  tsconfig.json         — self-contained, no root refs
  vitest.config.ts      — node env, globals true, test include
  src/
    shared-types.ts    — local stub types
    index.ts          — public barrel (expands as resolvers land)
  __tests__/           — placeholder for future tests
---
## [2026-06-19 later] Shared-types contract corrections

### What was wrong

The first skeleton attempt had three concrete problems:

1. CodegraphNodeLike used wrong field names. It had file: string and location?: { startLine, endLine } instead of the plan flat filePath, startLine, endLine. This would cause type mismatches when Team B resolvers pass these nodes to functions expecting the real root src/types.ts shapes.
2. SpringKgNode incorrectly extended CodegraphNodeLike. The plan specifies SpringKgNode as a standalone shape with its own explicit fields (id, kind, codegraphNodeId, confidence, createdAt, updatedAt, etc.) - it is NOT an extension of the CodeGraph node. Inheriting from the wrong shape would silently propagate the wrong fields upstream.
3. node_modules artifact. The original package.json had devDependencies declared, which caused npm to create a package-local node_modules/ under packages/springkg-semantic/. This must never happen - the package must be dependency-free so it stays lightweight and does not pollute the workspace.

### What was corrected

- CodegraphNodeLike now uses flat fields matching root src/types.ts: id, kind, name, qualifiedName, filePath, language, startLine, endLine, decorators, signature, returnType, visibility, isExported, isStatic, isAbstract, updatedAt, metadata
- CodegraphEdgeLike uses source, target, kind, metadata, line, column
- SpringKgNode is a standalone interface with explicit fields: id, kind, codegraphNodeId, name, qualifiedName, filePath, startLine, endLine, metadata, confidence, createdAt, updatedAt
- SpringKgEdge uses id, sourceId, targetId, kind, metadata, confidence, createdAt
- SpringKgEnhanceInput is codegraphNodes: CodegraphNodeLike[]; codegraphEdges: CodegraphEdgeLike[]; changedFiles?: string[]
- SpringKgEnhanceOutput is symbolsAdded: number; edgesAdded: number; byKind: Record string number; nodes: SpringKgNode[]; edges: SpringKgEdge[]
- Resolver is an interface with name: string; enhance(input): Promise SpringKgEnhanceOutput, not a bare function type
- src/index.ts removed the misleading resolver-path comments - barrel only exports what exists now
- packages/springkg-semantic/node_modules deleted entirely

---
## [2026-06-19] T68 policy contract for local Team B work

- `packages/springkg-semantic/src/policy.ts` now treats decorator matching as **case-insensitive substring matching**, because plan fixtures include full decorator strings like `@FeignClient(name="user-svc")` rather than bare annotation names.
- ADD wins over REUSE on conflicts (`@Component` + `@Mapper` => ADD), which keeps Team B from emitting a reused component row when Team C-owned mapper semantics are present.
- `ReusePolicy.dedup()` intentionally uses a tiny local `hasSymbol(kind, codegraphNodeId)` contract instead of a real DB dependency so T68 stays pure and testable until Team A lands the actual `spring_symbols` query surface.

---

## [2026-06-19] T12 annotation-engine implementation notes

- `AnnotationSemanticEngine` uses the existing `shouldReuse()`, `shouldAdd()`, and `handoffTeam()` helpers as the policy gate, then applies a local ordered classifier so `@Component` only wins when a more specific stereotype or ADD decorator did not match first.
- Spring KG node ids and `BELONGS_TO` edge ids are deterministic `sha256(...).slice(0, 32)` hashes prefixed by kind, which keeps test output concrete and aligns with the plan's idempotent row strategy.
- `@FeignClient(...)` metadata extraction currently parses `name="..."` first, then `value="..."`, which covers the T12 contract without pulling in the later T14 resolver responsibilities.

---

## [2026-06-19] T14 feign-resolver implementation notes

- `FeignResolver` stays package-local and pure: it only consumes `codegraphNodes` plus `contains` edges and returns `SpringKgEnhanceOutput`, with no dependency on Team A persistence surfaces.
- Feign target service resolution follows the plan priority exactly (`name` -> `value` -> `contextId` -> kebab-cased interface name), while `remote_service` rows are deduped per `targetServiceName` within one enhance pass.
- Spring MVC mapping parsing for Feign methods must support both named attributes (`path="/x"`, `value="/x"`) and the positional shorthand (`@GetMapping("/x")`), otherwise `feignPath` silently collapses to `/` in realistic Java interface fixtures.

---

## [2026-06-19] T13 endpoint-resolver implementation notes

- `EndpointResolver` stays fully codegraph-driven: controller ownership and parameter membership come only from `contains` edges, handler-to-callee fanout comes only from existing `calls` edges, and DTO ids are read best-effort from node metadata (`typeNodeId`, `returnTypeNodeId`) rather than reparsing Java.
- Spring mapping decorators needed a small scanner instead of a single regex because Team B fixtures mix Spring's normal `name = "x"` syntax with object-literal-style test shapes like `value: ["/a", "/b"]`. The local helper now extracts arrays, quoted strings, and bare annotation arguments deterministically from decorator text.
- Endpoint node ids and `HANDLED_BY`/`CALLS` edge ids use the same deterministic `sha256(...).slice(0, 32)` prefix pattern as T12 so repeated runs stay idempotent.
- Package-local endpoint tests pass under `npx vitest run --config packages/springkg-semantic/vitest.config.ts packages/springkg-semantic/__tests__/endpoint-resolver.test.ts`.
- Package typecheck is currently blocked by pre-existing errors in `packages/springkg-semantic/src/feign-resolver.ts` (`MethodResolution` nullability / optional `returnType` mismatch). T13 did not modify that file, and Team B's must-not-touch scope for this task excludes fixing it here.

---

## [2026-06-19] T42 feign-dto implementation notes

- `FeignRequestResponseType` stays purely in-memory: it infers Feign DTO bindings only from `codegraphNodes` plus `contains` edges, preferring the Feign interface -> method -> parameter path over any persisted `feign_method` Spring node dependency.
- DTO emission is intentionally metadata-driven and narrow: request DTOs come only from the single `@RequestBody` parameter when that parameter exposes `metadata.typeNodeId`, while response DTOs come from method `returnType` plus `metadata.returnTypeNodeId`.
- Primitive/simple return types are skipped with a lightweight filter that covers direct built-ins plus obvious generic containers like `List<String>`, `Set<Integer>`, and `Map<String, String>`, which keeps T42 focused on DTO binding instead of introducing broader Java type resolution.

---

## [2026-06-19] Evidence files captured from verified fixtures

All six Team B evidence files were created under `.omo/evidence/team-b/` using fixture-derived
outputs from the package-local verified test suite (packages/springkg-semantic/__tests__/).
Team A persistence / springkg.db integration has not landed yet, so all evidence is
explicitly marked as fixture-derived, not live-database output.

Files created:
  .omo/evidence/team-b/task-12-annotation-engine.json  — 9 annotation cases + BELONGS_TO summary
  .omo/evidence/team-b/task-13-endpoint-resolver.sql    — endpoint spring_symbols + HANDLED_BY/CALLS
  .omo/evidence/team-b/task-14-feign-resolver.sql       — feign_client/remote_service/feign_method + BELONGS_TO
  .omo/evidence/team-b/task-41-feign-provider-bridge.sql — TARGETS_ENDPOINT edges (same-monorepo + cross-service)
  .omo/evidence/team-b/task-42-feign-dto.sql            — dto rows + USES_DTO edges
  .omo/evidence/team-b/task-68-policy.md               — REUSE/ADD/HANDOFF tables, conflict rule, dedup contract
