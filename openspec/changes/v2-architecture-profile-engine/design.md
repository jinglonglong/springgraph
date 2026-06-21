## Context

CodeGraph already has the hard parts needed for architecture-aware analysis: a generic tree-sitter extraction pipeline, a SQLite-backed graph, stable traversal primitives, a public `CodeGraph` API, a CLI, MCP tools, and a working WebUI. The current architecture-aware experience for Spring projects is useful but fragile because Spring role and layer semantics are hardcoded in `src/web/server.ts` and `src/web/public/app.js`, which duplicates inference logic and makes the web layer the de facto owner of semantics that should live above the graph.

This change introduces a V2 architecture interpretation layer that sits on top of the existing graph instead of replacing it. Its first concrete target is Spring-centric Java systems, including mixed projects that combine Spring MVC, Spring Cloud, MyBatis, Lombok, MapStruct, validation, and configuration binding. The design must preserve the existing public surface: `NodeKind` and `EdgeKind` strings remain stable, existing SQL tables remain the system of record, `CodeGraph` methods such as `indexAll`, `sync`, `watch`, `searchNodes`, `getCallers`, `getCallees`, `getImpactRadius`, `findPath`, and `buildContext` keep their semantics, current CLI commands keep their meaning, and MCP tools keep their shape. The main stakeholders are engineers extending CodeGraph, users relying on current graph behavior, and WebUI users who need architecture views that are more accurate than the current Spring-specific heuristics.

## Goals / Non-Goals

**Goals:**
- Add an architecture interpretation layer that can classify projects and nodes without changing the underlying generic graph model.
- Support composable detection so one project can simultaneously express Spring MVC, Spring Cloud, MyBatis, Lombok, MapStruct, and related facets.
- Make server-side facet data the single source of truth for architecture roles, layers, modules, and entrypoints consumed by the WebUI.
- Expose architecture-oriented overview, trace, and impact endpoints by packaging existing traversal primitives with profile-aware aggregation.
- Improve architecture trace and impact accuracy for Spring dependency injection, interface-to-implementation dispatch, MyBatis XML, field impact, and configuration binding.
- Keep the system rollback-friendly by making all architecture metadata additive, cacheable, and removable without database migration.
- Preserve backward compatibility for the existing library API, CLI behavior, MCP surface, and generic WebUI mode.

**Non-Goals:**
- Replacing `NodeKind`, `EdgeKind`, or the existing graph traversal model with architecture-specific node or edge types.
- Introducing a mandatory SQL schema migration or persisting profile/facet state in the database for the first version.
- Building a new graph algorithm for trace or impact instead of reusing `findPath`, `getCallers`, `getCallees`, and `getImpactRadius`.
- Materializing every derived framework behavior, especially Lombok-generated members, as first-class graph nodes.
- Supporting many production-ready profiles beyond the initial Spring-centric profile before the spring-cloud path is stable.
- Letting the frontend invent or override architecture semantics independently of the backend.
- Expanding current CLI or MCP command semantics in a way that breaks existing callers or scripts.

## Decisions

### 1. Profile/Facet Composition Model
Choice: Model architecture interpretation as `Profile = Facet[] + layer rules + role rules`, where each `Facet` is a detector that emits scored evidence at project, module, file, or node scope.

Rationale: Real Java projects are mixtures, not single templates. A composable model allows the same repository to match Spring MVC, Spring Cloud, MyBatis, Lombok, MapStruct, scheduling, and config-binding at once, while still producing one active profile view for presentation. This keeps detection granular and lets evidence stay explainable instead of collapsing everything into one opaque classification.

Alternatives considered: A single-template detector was rejected because it forces one lossy label onto projects that clearly span multiple frameworks. A rule-engine DSL was rejected because it adds dependency and maintenance cost for marginal expressivity over TypeScript interfaces plus registered detectors.

### 2. Generic Graph Remains Unchanged
Choice: Profiles and facets do not change existing `NodeKind` or `EdgeKind` values, do not replace current tables, and do not redefine traversal semantics. They only emit `AnnotationFact` records and synthesized edges annotated with `provenance: heuristic`, `confidence`, and `evidence`.

Rationale: The existing graph is already the compatibility boundary for the library, CLI, MCP tools, and current WebUI. Keeping it unchanged avoids a migration, preserves rollback, and prevents architecture-specific concepts from leaking into every query path. It also enforces a clean contract: the graph stores generic facts, while the architecture layer interprets them.

Alternatives considered: Storing architecture-specific node or edge kinds in the core graph was rejected because it would couple one profile family to the system of record and make compatibility much harder to reason about.

### 3. Runtime-Derived Facets With Cache, Not Persistence
Choice: Compute profile matches, facets, and derived architecture metadata at runtime and cache them in memory rather than persisting them to SQL in the first version.

Rationale: Runtime derivation avoids a schema migration and lets the rules evolve without forcing reindexing every time a detector changes. A cache still keeps requests fast, while invalidation tied to `indexAll`, `sync`, `watch`, and delete handling keeps derived state aligned with the current working tree.

Alternatives considered: Persisting facets in the database was deferred because it introduces staleness risk, migration cost, and versioning complexity before the model has stabilized.

### 4. AnnotationAdapterRegistry Owns Annotation and Codegen Semantics
Choice: Centralize framework annotation and code-generation logic behind an `AnnotationAdapter` interface and registry covering Spring, MapStruct, Lombok, MyBatis, validation, OpenAPI, and rule-based custom adapters.

Rationale: Annotation parsing is a cross-cutting concern that otherwise leaks into extractors, resolvers, profile logic, and the WebUI. A registry makes adapter outputs uniform, keeps the rest of the system dependent on normalized `AnnotationFact` records instead of raw annotation strings, and creates an extension point for company-specific annotations such as `@DomainService` or `@RpcClient` without editing core architecture code.

Alternatives considered: Parsing each framework directly inside resolvers or profiles was rejected because it duplicates logic and hardens framework knowledge in the wrong layers. Hardcoding custom annotation support in core code was rejected because it scales poorly for user-specific conventions.

### 5. WebUI Is Purely a Renderer
Choice: Move all role, layer, service, module, and entrypoint inference to the server, return `state.facets` and related breakdowns from the backend, and delete the frontend `classifySpringRole()` logic.

Rationale: The frontend should visualize server-owned semantics, not manufacture them. Making the backend the only producer removes drift between browser and server, simplifies testing, and keeps profile logic available equally to APIs and UI. The UI still decides how to present data, but not what the data means.

Alternatives considered: Keeping a lightweight frontend fallback classifier was rejected because even a “temporary” duplicate tends to drift and become production behavior.

### 6. Trace and Impact Stay Thin Wrappers Around Existing Traversal
Choice: Implement `/api/architecture/trace` as a wrapper around `findPath`, `getCallees`, and `getCallers`, and implement `/api/architecture/impact` as a wrapper around `getImpactRadius`, adding aggregation, warnings, breakdowns, and profile-aware formatting but no new traversal engine.

Rationale: CodeGraph already has the correctness-critical traversal primitives. Reusing them keeps architecture APIs aligned with the rest of the product and reduces the risk of building a second traversal system with subtly different answers. The architecture layer should explain and package results, not reinterpret graph reachability from scratch.

Alternatives considered: A dedicated architecture traversal engine was rejected because it would duplicate core logic and create more places for trace and impact semantics to diverge.

### 7. Spring DI Ambiguity Is Explicit, Not Guessed
Choice: When Spring dependency injection resolves multiple possible implementations and no `@Qualifier` or `@Resource(name)` disambiguates the target, mark the relationship as `ambiguous`, exclude it from the default trace path, and surface a warning in the response.

Rationale: Architecture trace is only useful if users can trust it. Silent guessing across multiple implementations produces false confidence and turns the UI into a persuasive but incorrect story. Warnings preserve visibility into the uncertainty without polluting the default path with arbitrary edges.

Alternatives considered: Picking the first implementation by naming convention or source order was rejected because it creates unstable, misleading traces that appear precise but are not justified by evidence.

### 8. Lombok Emits Facts, Not Materialized Nodes
Choice: Represent Lombok behaviors such as `@Getter`, `@Setter`, and `@Data` as `AnnotationFact` records of kind `generated-method` or `generated-property`, and only synthesize crossing edges when trace or impact actually needs them.

Rationale: Lombok-heavy codebases can explode in node count if every implied accessor becomes a real `method` node. The architecture layer only needs enough information to keep traces and impact paths from breaking. Facts plus on-demand synthesized edges preserve that utility while keeping the core graph compact and predictable.

Alternatives considered: Fully materializing generated members was rejected because it bloats the graph, slows indexing, and overstates the certainty of source that does not exist verbatim in the codebase.

### 9. Incremental Recompute Follows Existing Index Lifecycle
Choice: Recompute architecture state in step with current indexing behavior: `indexAll` triggers full project-level recompute, `sync` recomputes only the changed set unless global files such as `pom.xml`, `build.gradle`, or application config require project-level re-detection, and delete events evict stale facets and synthesized edges.

Rationale: Architecture interpretation must track the same truth boundary as the graph itself. Reusing the current indexing lifecycle keeps the mental model simple, avoids a second synchronization mechanism, and ensures watch mode and catch-up sync continue to produce current answers.

Alternatives considered: Recomputing everything after every sync was rejected because it does unnecessary work on large repositories. Updating only on request without invalidation hooks was rejected because it makes stale results too easy to serve.

### 10. Web Server Responsibilities Are Split Deliberately
Choice: Move architecture endpoint handling into `src/web/architecture-api.ts`, move graph serialization and breakdown helpers into `src/web/graph-response.ts`, and keep `src/web/server.ts` focused on routing and request orchestration.

Rationale: `server.ts` already has too much embedded behavior. Explicit module boundaries make it harder for Spring role inference to drift back into the router, make the architecture APIs easier to test, and let response-shaping logic stay reusable across overview, trace, and impact endpoints.

Alternatives considered: Keeping all architecture API code inside `server.ts` was rejected because it would preserve the same gravity well that produced the current hardcoded role logic.

### 11. Edge Style Conveys Provenance in the UI
Choice: Use visual edge style as a first-class provenance signal: solid for static tree-sitter edges, dotted for `references`, dashed for heuristic synthesized edges, blue for `overrides` and `implements`, and purple or orange for config and field-impact relationships.

Rationale: Users should be able to see why a hop exists without opening a detail panel. Provenance in line style makes uncertainty and mechanism visible directly in the graph, which is especially important once heuristic edges cross Spring DI, interface dispatch, or generated-code boundaries.

Alternatives considered: Showing provenance only in side-panel metadata was rejected because it hides a crucial trust signal behind extra clicks and makes the main graph overstate certainty.

### 12. Profile Fail-Safe Defaults to Generic
Choice: If no profile matches, the system returns `activeProfile: "generic"` and preserves the existing generic WebUI behavior.

Rationale: Architecture awareness is an enhancement layer, not a prerequisite for using CodeGraph. A generic fallback prevents unsupported repositories from being blocked by profile detection and keeps the user experience safe while additional profiles are still immature.

Alternatives considered: Returning no active profile or failing architecture endpoints when detection is inconclusive was rejected because it turns a missing enhancement into a user-visible regression.

## Risks / Trade-offs

- [Inaccurate heuristic edges make the UI a convincing but wrong story] → Attach `provenance`, `confidence`, and evidence to every synthesized edge, render heuristic hops distinctly, and prefer omission plus warnings over speculative linking.
- [Spring DI multi-implementation miswiring produces false traces] → Require explicit disambiguators such as `@Qualifier` or `@Resource(name)` for high-confidence selection, mark unresolved fan-out as `ambiguous`, and exclude it from the default trace path.
- [Impact explosion on large dependency blobs overwhelms users] → Keep architecture impact as a wrapper around bounded `getImpactRadius`, default depth conservatively, suppress noisy reverse-expansion paths, and aggregate results by role, layer, and surface instead of dumping every reachable node.
- [WebUI logic re-inflates if facets are not the single source of truth] → Remove frontend inference code, make backend facets mandatory for architecture views, and keep tests focused on server-produced role, layer, and filter behavior.
- [Premature profile proliferation dilutes the first stable implementation] → Ship one hardened Spring-centric profile first, keep the registry extensible but leave additional profiles as future work until the spring-cloud path is proven on real repos.
- [UI exposes buttons or tabs backed by no real behavior] → Only render controls that have wired state, backend support, and observable output; hide or disable placeholder actions rather than presenting dead interactions.
- [Async initialization race causes the first architecture request to see empty or stale data] → Lock lazy cache construction, make handlers wait for required initialization or return an explicit pending state, and add first-request tests around startup and catch-up sync.
- [Filter parameters drift from actual facet data] → Drive search and overview filters from the same backend facet dataset the UI renders, and add tests for both valid and nonexistent role, layer, module, and decorator filters.
- [Profile/facet drift after incremental sync serves stale interpretation] → Invalidate or recompute cache entries on `indexAll`, `sync`, `watch`, and delete events, and treat build/config file changes as project-level re-detection triggers.
- [V2 breaks existing public APIs or command semantics] → Keep architecture metadata additive, preserve current meanings for `CodeGraph` methods, CLI commands, and MCP tools, and treat architecture endpoints as new wrappers instead of semantic replacements.
- [Adapter over-materialization recreates a node-explosion problem, especially for Lombok] → Keep generated members as facts by default, synthesize only the edges needed for trace or impact traversal, and add tests that watch node growth on field-heavy samples.
- [New annotation values require core-code edits and become a maintenance trap] → Route framework and company-specific annotation semantics through `AnnotationAdapterRegistry` and rule-based adapters so most additions are configuration or new adapter work rather than edits across resolver, profile, and UI layers.
- [Delete events leave stale facets or synthesized edges in cache] → Treat file removal as an explicit eviction path for derived state keyed by file and node ownership, and cover delete handling in sync and watcher tests.
