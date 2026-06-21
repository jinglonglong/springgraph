## 1. Phase 0 — Baseline lock & cleanup

- [x] 1.1 Record current WebAPI endpoints: `/api/modules`, `/api/overview?mode=springcloud|modules|layered` in `docs/design/architecture-profile-webui-baseline.md`
- [x] 1.2 Record current dzjc/RuoYi module + role statistics in the same baseline doc
- [x] 1.3 Add `__tests__/web-architecture-profile.test.ts` covering the existing SpringCloud WebAPI behavior
- [x] 1.4 Verify current `GraphTraverser` API surface (`getCallers`, `getCallees`, `getImpactRadius`, `findPath`, `getCallGraph`) in baseline doc
- [x] 1.5 Run `git status --short`, `git diff`, `git diff --cached` and isolate unrelated changes (`.codegraph_bak/`, `.omo/.omo.bak/`, `.omo/evidence/`, `.playwright-mcp/page-*.yml`, `examples/**/target/`, `webui-*.png`, temp screenshots/logs/exports); recover any accidentally-deleted source files
- [x] 1.6 Confirm `npm run build` and `npm test` pass on the current branch before any refactor

## 2. Phase 1 — Architecture profile engine types

- [x] 2.1 Create `src/architecture/types.ts` with `ArchitectureProfile`, `ArchitectureFacet`, `ArchitectureSignal`, `NodeArchitectureFacet`, `ArchitectureLayer`, `ArchitectureRole`, `ArchitectureProfileMatch`
- [x] 2.2 Create `src/architecture/profile-registry.ts` with `ProfileRegistry` (register, ordered lookup, generic fallback)
- [x] 2.3 Create `src/architecture/facet-engine.ts` with `FacetEngine` (signal aggregation, confidence scoring, evidence collection)
- [x] 2.4 Create `src/architecture/profile-detector.ts` running every registered profile's `detect()` over project-level signals
- [x] 2.5 Create `src/architecture/role-assignment.ts` with conflict-priority resolution for competing role signals
- [x] 2.6 Add `__tests__/architecture-profile.test.ts` covering type system, registry composition, and engine aggregation
- [x] 2.7 Add `__tests__/architecture-facets.test.ts` covering per-node facet computation and confidence scoring
- [x] 2.8 Export architecture-engine handle from `src/index.ts` WITHOUT changing existing public API

## 3. Phase 2 — Annotation adapter framework

- [ ] 3.1 Create `src/architecture/adapters/types.ts` with `AnnotationAdapter`, `AnnotationAdapterRegistry`, `AnnotationFact`, `SynthesizedEdge`, `RuleBasedAdapter`
- [ ] 3.2 Create `src/architecture/adapters/registry.ts` initializing all built-in adapters in registration order
- [ ] 3.3 Implement `src/architecture/adapters/spring-annotations.ts` (Component, Service, Repository, Controller, RestController, Configuration, Bean, Autowired, Qualifier, Resource, Value, ConfigurationProperties)
- [ ] 3.4 Implement `src/architecture/adapters/spring-web.ts` (RequestMapping, GetMapping, PostMapping, PutMapping, DeleteMapping, PatchMapping)
- [ ] 3.5 Implement `src/architecture/adapters/spring-schedule-event.ts` (Scheduled, EventListener, ApplicationListener)
- [ ] 3.6 Implement `src/architecture/adapters/mapstruct.ts` (Mapper, Mapping, Mappings, BeanMapping, IterableMapping, uses, componentModel)
- [ ] 3.7 Implement `src/architecture/adapters/lombok.ts` (Getter, Setter, Data, Builder, NoArgsConstructor, AllArgsConstructor, RequiredArgsConstructor, Slf4j, Accessors)
- [ ] 3.8 Implement `src/architecture/adapters/mybatis-annotations.ts` (Select, Insert, Update, Delete, Param, Results, Result)
- [ ] 3.9 Implement `src/architecture/adapters/validation.ts` (NotNull, NotBlank, Valid, Validated, Size, Pattern)
- [ ] 3.10 Implement `src/architecture/adapters/openapi.ts` (Operation, Tag, ApiOperation, ApiModelProperty)
- [ ] 3.11 Implement `src/architecture/adapters/rule-based.ts` for company-specific annotations
- [ ] 3.12 Add `__tests__/annotation-adapters.test.ts` (registry ordering, unknown annotations ignored, rule additions don't touch core)
- [ ] 3.13 Add `__tests__/mapstruct-adapter.test.ts` (source/target types, uses references, componentModel=spring bean role)
- [ ] 3.14 Add `__tests__/lombok-adapter.test.ts` (RequiredArgsConstructor constructor injection, no node explosion)
- [ ] 3.15 Add `__tests__/spring-annotation-adapter.test.ts` (bean/injection/endpoint facts)
- [ ] 3.16 Add `__tests__/custom-annotation-rules.test.ts` (rule registration without core changes)

## 4. Phase 3 — Spring Cloud profile

- [ ] 4.1 Create `src/architecture/profiles/spring-cloud.ts` defining six layers (entry/remote/business/data/model/infra) and 15 roles from the plan
- [ ] 4.2 Implement `spring-naming` facet (`*Controller`, `*ServiceImpl`, `*Mapper`, `*Entity`, etc.)
- [ ] 4.3 Implement `spring-annotation` facet delegating to the Spring adapters
- [ ] 4.4 Implement `maven-module` facet (pom.xml/Gradle multi-module boundary detection)
- [ ] 4.5 Implement `spring-entrypoint` facet (Controller/Scheduler/EventListener/Filter/WebSocket detection)
- [ ] 4.6 Wire profile-level `detect()` aggregating facet signals with confidence + evidence
- [ ] 4.7 Implement fallback to `activeProfile: "generic"` when no Spring signals are present
- [ ] 4.8 Add `__tests__/spring-cloud-profile.test.ts` (detection, layer/role assignment, generic fallback, confidence)

## 5. Phase 4 — Relationship synthesis resolvers

- [ ] 5.1 Create `src/resolution/spring-bean-wiring.ts` emitting `references` edges for field injection (`@Autowired`, `@Resource`, constructor)
- [ ] 5.2 Boost confidence on `@Qualifier` / `@Resource(name=...)`; mark multi-impl without qualifier as `ambiguous` excluded from default trace
- [ ] 5.3 Recognize `@RequiredArgsConstructor` + `final` field as constructor injection
- [ ] 5.4 Create `src/resolution/interface-impl-dispatch.ts` emitting `overrides` edges (overloaded, generic interfaces, multi-impl ambiguity, confidence scoring)
- [ ] 5.5 Create `src/extraction/mybatis-extractor.ts` extracting `<mapper namespace>`, `<select|insert|update|delete id=...>`, table/column hints
- [ ] 5.6 Create `src/resolution/frameworks/mybatis.ts` linking Java Mapper method → XML statement by name and Entity field → XML column via `@TableField` / naming
- [ ] 5.7 Add `src/extraction/config-extractor.ts` for `application.yml` / `.properties`
- [ ] 5.8 Create `src/architecture/java-field-impact.ts` synthesizing field-impact `references` edges (getter/setter, Lombok, MapStruct source/target, MyBatis XML column, `@JsonProperty`)
- [ ] 5.9 Create `src/architecture/spring-config-impact.ts` for `@Value("${key}")` + `@ConfigurationProperties(prefix=...)`
- [ ] 5.10 Wire new synthesizers into `src/resolution/index.ts` resolver pipeline
- [ ] 5.11 Add `__tests__/spring-bean-wiring.test.ts` (field/constructor injection, qualifier, ambiguity)
- [ ] 5.12 Add `__tests__/spring-interface-impl.test.ts` (overloaded, generic, multi-impl)
- [ ] 5.13 Add `__tests__/mybatis-xml-impact.test.ts` (namespace, statement, table/column linking)
- [ ] 5.14 Add `__tests__/java-field-impact.test.ts` (getter/setter, Lombok, MapStruct, XML column, `@JsonProperty`)
- [ ] 5.15 Add `__tests__/spring-config-impact.test.ts` (`@Value`, `@ConfigurationProperties`, missing-key warning)

## 6. Phase 5 — Trace & Impact APIs

- [ ] 6.1 Create `src/architecture/trace.ts` wrapping `findPath` + `getCallees` + `getCallers` with confidence, provenance, warnings
- [ ] 6.2 Exclude `ambiguous` hops from default trace; surface them in `warnings`
- [ ] 6.3 Create `src/architecture/impact.ts` wrapping `getImpactRadius` with role/layer aggregation and risk level
- [ ] 6.4 Bound default depth to 3; exclude `contains` reverse explosion from the target
- [ ] 6.5 Derive `recommendedTests` array from affected entrypoints + services + mappers
- [ ] 6.6 Return graceful empty result for unknown `query` (structured response, not throw)
- [ ] 6.7 Add unit tests covering happy path, ambiguity, depth bound, recommended-regression derivation

## 7. Phase 6 — Server split (architecture-api, graph-response)

- [ ] 7.1 Create `src/web/graph-response.ts` with `serializeNodeWithFacet`, `serializeEdgeWithMetadata`, `buildBreakdowns`
- [ ] 7.2 Create `src/web/architecture-api.ts` with `handleArchitectureProfiles`, `handleArchitectureOverview`, `handleArchitectureTrace`, `handleArchitectureImpact`
- [ ] 7.3 Remove `classifySpringRole()` and `SC_ROLE_TIER` from `src/web/server.ts`
- [ ] 7.4 Refactor `buildOverviewGraph()` and `buildLayeredGraph()` in `server.ts` to read node facets from the architecture engine
- [ ] 7.5 Update `/api/overview` response to include `activeProfile`, `profileConfidence`, `facets`, `roleBreakdown`, `layerBreakdown`, `moduleBreakdown` (additive; existing shape preserved)
- [ ] 7.6 Add `__tests__/web-architecture-api.test.ts` covering the four new endpoints and the additive `/api/overview` change
- [ ] 7.7 Verify `__tests__/web-architecture-profile.test.ts` baseline still passes after refactor

## 8. Phase 7 — WebUI dynamic adaptation

- [ ] 8.1 Add Profile pill + confidence + "检测依据" button to `src/web/public/index.html`
- [ ] 8.2 Replace `classifySpringRole()` in `src/web/public/app.js` with backend-facet consumption (function deleted)
- [ ] 8.3 Update `state` to `profileId`, `activeProfile`, `profileConfidence`, `facets`, `groupBy`, `colorBy`, `activeRoleFilters`, `activeLayerFilters`, `selectedTrace`, `selectedImpact`
- [ ] 8.4 Render sidebar sections from `profile.roles` / `profile.layers` (replace fixed SpringCloud section)
- [ ] 8.5 Apply profile-driven Cytoscape colors: `colorBy=role|layer|module`; heuristic edges dashed/dotted per provenance
- [ ] 8.6 Add 架构 / 调用链 / 影响 tabs to detail panel; wire to `/api/architecture/trace` and `/api/architecture/impact`
- [ ] 8.7 Register `cytoscape-dagre` plugin (`cytoscape.use(window.cytoscapeDagre)`); layered view attempts dagre, falls back to `breadthfirst`, surfaces fallback state
- [ ] 8.8 Wire filter chips (role/layer/module/decorator) to filter params that hit the server — UI MUST NOT silently filter full result set
- [ ] 8.9 Hide or disable any visible button without real backend behavior (no decorative affordances)
- [ ] 8.10 Add CSS: `.profile-pill`, `.profile-confidence`, `.arch-section`, `.arch-role-chip`, `.arch-layer-chip`, `.trace-path`, `.trace-node`, `.trace-edge`, `.impact-summary`, `.impact-risk-low|medium|high`, `.evidence-list`
- [ ] 8.11 Verify `[hidden] { display: none !important }` rule still applies
- [ ] 8.12 Browser-based manual QA: profile auto-detect, mode switching, Controller/Service/Mapper drill-down, endpoint trace, field impact, console-error-free, every visible button has observable behavior

## 9. Phase 8 — Incremental sync hooks

- [ ] 9.1 Hook `indexAll()` to recompute project-level facets under a lock; cache the result
- [ ] 9.2 Hook `sync()` to recompute only changed files; evict stale facets for deleted files
- [ ] 9.3 Detect changes to `pom.xml`, `build.gradle`, `application.yml`, `application.properties` and trigger project-level profile re-detect
- [ ] 9.4 Hook `watch()` auto-sync so `/api/architecture/*` returns updated facets within the debounce window
- [ ] 9.5 Add `__tests__/architecture-incremental-sync.test.ts` (add/modify/delete coverage, global file re-detect)
- [ ] 9.6 Extend `__tests__/watcher.test.ts` and `__tests__/mcp-catchup-gate.test.ts` for facet freshness

## 10. Phase 9 — Test suite & regression coverage

- [ ] 10.1 Run all baseline capability regression tests (`__tests__/sync.test.ts`, `__tests__/watcher.test.ts`, `__tests__/graph.test.ts`, `__tests__/integration/full-pipeline.test.ts`, `__tests__/mcp-catchup-gate.test.ts`, `__tests__/mcp-staleness-banner.test.ts`) at every milestone
- [ ] 10.2 Confirm `indexAll()`, `sync()`, `watch()`, `searchNodes()`, `getCallers()`, `getCallees()`, `getImpactRadius()`, `findPath()`, `buildContext()`, `codegraph affected` semantics unchanged
- [ ] 10.3 Add filter-consistency tests: `GET /api/search?q=...&role=controller`, `&layer=entry`, `&module=ruoyi-system`, `&decorator=NoSuchDecorator` (latter MUST return empty)
- [ ] 10.4 Add first-request race test: handler MUST wait for index/seed init or return pending, never stale empty data
- [ ] 10.5 Add `npm run eval` evaluation runner regression test for spring-cloud profile on a synthetic project

## 11. Phase 10 — Real project validation & docs

- [ ] 11.1 Validate on dzjc / RuoYi (multi-module SpringCloud / monolith): SpringCloud auto-detect, modules, layer/role stats >90% accuracy, Controller→Service→Mapper→XML chain intact, WebUI no JS error
- [ ] 11.2 Validate on mall / mall-tiny (SpringBoot + MyBatis): Controller→Service→Mapper→XML chain
- [ ] 11.3 Validate on halo / realworld-spring: DI / interface / route coverage
- [ ] 11.4 Capture answers to the 10 trace + 5 impact sample questions from `资料/v2/architecture-profile-execution-plan.md` § 8.2; record in `docs/design/architecture-profile-webui-baseline.md` validation log
- [ ] 11.5 Confirm ideal criteria (single-call trace, field-impact affected entrypoints, no grep/read needed)
- [ ] 11.6 Update `CHANGELOG.md` under `## [Unreleased]` per CLAUDE.md house rules (friendly notes, no internal paths / symbol names / benchmark numbers)
- [ ] 11.7 Verify `npm run build` and `npm test` pass end-to-end
