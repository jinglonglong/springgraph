# Architecture Profile Engine - Types Design & Learnings

## Design Decisions

1. **Alignment with Core Types**:
   - `ArchitectureLayer` is defined as a union of strings (`'entry' | 'remote' | 'business' | 'data' | 'model' | 'infra' | 'unknown'`) rather than an enum to maintain consistency with `NodeKind` and `EdgeKind` which are defined as string unions.
   - `ArchitectureRole` is defined as a string type alias `type ArchitectureRole = string` to allow open-ended and profile-specific custom roles (e.g., `"Controller"`, `"ServiceImpl"`, `"Mapper"`, `"Entity"` for `spring-cloud`).
   - Imported `Node` from `../types` and `DatabaseConnection` from `../db` to establish strong references to the core graph and storage layers in the new type system.

2. **Integration of Execution Plan and Task Specifications**:
   - The specs for `ArchitectureSignal` and `NodeArchitectureFacet` in the prompt list specific properties (`facetName`, `profileName`, `confidence` as a 0-1 float, `evidence` as a `string[]` list of human-readable proof).
   - We designed the types to encompass both the user requirements and the compatibility fields from `architecture-profile-execution-plan.md` (e.g. `isEntrypoint`, `packageName`, `profileId`, `module`, etc.) using optional properties.
   - For `FacetSignalAggregator`, we defined it as a pure interface with method signatures (`addSignal`, `addSignals`, `aggregate`) allowing different implementations of signal aggregation (e.g., class-based) without embedding runtime logic.

3. **Active Profile Detection & Conflict Resolution**:
   - `RoleConflict` is structured to hold the target `nodeId`, a list of competing `roles` (along with their confidence and detecting facet), and the final `resolvedRole` to facilitate prioritization rules in `role-assignment.ts`.
   - `ProfileDetectionResult` represents the overall result containing the active profile name, matches sorted by confidence, and error/warning strings.

## Type Definition Summary

The created file `src/architecture/types.ts` contains the following types/interfaces:
* `ArchitectureLayer`
* `ArchitectureRole`
* `ArchitectureContext`
* `ArchitectureSignal`
* `NodeArchitectureFacet`
* `ArchitectureProfileMatch`
* `ProfileDetectionResult`
* `RoleConflict`
* `FacetSignalAggregator`
* `ArchitectureFacet`
* `ArchitectureProfile`

## Role Conflict Resolution Implementation (2026-06-21)

### Key Achievements
- **Standardized Layers & Roles**: Built `getLayerForRole` to map logical Spring Cloud and generic roles (e.g., `controller`, `service`, `mapper`, `entity`, `config`, etc.) to exactly one of the six logical layers: `entry`, `remote`, `business`, `data`, `model`, or `infra`.
- **Annotation vs Naming Priority**: Defined priority levels where annotations (Tiers 1-5) strictly win over naming suffixes (Tier 6).
- **Tie-Breaker Strategy**: When multiple roles exist in the same priority tier, the signal with the highest confidence score wins.
- **Traceable Decision Logging**: If a role conflict is resolved, a detailed explanation is automatically appended to the `evidence` array of the mutated facets (e.g. `Resolved role conflict: selected 'RestController' over 'ServiceImpl' based on priority rules...`).
- **Comprehensive Unit Testing**: Created a dedicated test file `__tests__/role-assignment.test.ts` verifying all priority tiers, fallback layers, non-conflicting multi-facet aggregation, and tie-breaker decisions.

### Priority Level Reference
1. `@Controller` / `@RestController` / `@ControllerAdvice` (entry layer)
2. `@Service` / `@ServiceImpl` (business layer)
3. `@Repository` / `@Mapper` (data layer)
4. `@Entity` / `@Table` (model layer)
5. `@Configuration` / `@Component` / `@Config` (infra layer)
6. Naming suffixes (e.g., matching ClassName suffixes like `*Controller`, `*ServiceImpl`, `*Mapper`, `*Entity`, `*Component`)

## Profile Registry Implementation (2026-06-21)

### Key Achievements
- **Registry Design**: Implemented the `ProfileRegistry` class supporting profile registration, ordered retrieval, name/ID lookup, and fallback resolution.
- **Ordered Preservation**: Verified profiles are registered and returned in registration order without deduplication to support priority-based resolution.
- **Built-in Fallback**: Defined the fallback `genericProfile` with a confidence score of `0.1` and an `unknown` layer tier `99` to resolve undefined paths cleanly.
- **Unit Testing**: Created a dedicated test file `__tests__/architecture-profile.test.ts` verifying all registry methods, singleton status, and fallback confidence properties.

## Facet Engine Implementation (2026-06-21)

### Key Achievements
- **Dynamic Facet Registry**: Created a registry system in `facet-engine.ts` where individual facet implementations can be registered and retrieved by ID.
- **Signal Aggregation**: Implemented the `runFacets` method which creates a project-wide `ArchitectureContext` from the database path and node list, executes the `detect()` logic of each facet, aggregates their signals, and returns resolved, conflict-free `NodeArchitectureFacet` results.
- **Per-Node Facet Computation**: Implemented `computeNodeFacet` to construct per-node classifications. It resolves competing role, layer, and module assignments from multiple signals by selecting the one with the highest confidence, setting the final facet confidence to the maximum signal confidence.
- **Role Resolution Integration**: Wired the priority-based conflict resolver (`resolveRole`) directly into `runFacets` to ensure that computed facets have clean, resolved role and layer fields.
- **Signal Flattening**: Implemented `aggregateSignals` to return a flattened list of all signals associated with the processed facets, including global/project-level signals.
- **Unit Testing**: Created `__tests__/architecture-facets.test.ts` verifying facet running, aggregation, signal flattening, and confidence scoring. Verified that the test suite runs and compiles with zero warnings or errors.

## Profile Detector Implementation (2026-06-21)

### Key Achievements
- **Standardized Profile Detection**: Created `src/architecture/profile-detector.ts` implementing `detectArchitectureProfile`. It runs all registered profiles, executes their facets synchronously using `FacetEngine`, aggregates the resulting signals, and sorts the matches by confidence descending.
- **Fallback Resolution**: If no registered profiles match, it defaults to the `'generic'` profile with a clean, empty matches list.
- **Project Root Determination**: Derives the project root path dynamically from the database connection's path to correctly initialize `ArchitectureContext`.
- **Unit Testing**: Created `__tests__/profile-detector.test.ts` to test mock profiles, facets, confidence calculations, breakdowns, and generic fallback paths. Verified that the new tests and the entire build compile and execute successfully with zero errors.

## Public API Export (2026-06-21)

### Key Achievements
- **Exported Architecture Types**: Added re-exports of all architecture types (`ArchitectureProfile`, `ArchitectureFacet`, `ArchitectureSignal`, `NodeArchitectureFacet`, `ArchitectureLayer`, `ArchitectureRole`, `ArchitectureProfileMatch`, `ProfileDetectionResult`, `RoleConflict`, `FacetSignalAggregator`) from `./architecture/types` in `src/index.ts`.
- **Exported Detection Functions**: Added re-export of `detectArchitectureProfile` from `./architecture/profile-detector`.
- **Exported Registry**: Added re-exports of `profileRegistry` singleton and `ProfileRegistry` class from `./architecture/profile-registry`.
- **Non-Breaking Change**: All exports added to the "Re-export types for consumers" section without modifying any existing class or method signatures.
- **Build Verification**: Verified TypeScript compilation succeeds with zero errors after adding exports.

## MyBatis Annotation Adapter Implementation (2026-06-21)

### Key Achievements
- **New Adapter**: Created `src/architecture/adapters/mybatis-annotations.ts` implementing the `AnnotationAdapter` interface.
- **Detection Coverage**: Recognizes the core MyBatis Java annotations:
  - SQL statement annotations: `@Select`, `@Insert`, `@Update`, `@Delete`
  - Result mapping annotations: `@Results`, `@Result`
  - Parameter binding annotation: `@Param`
- **Fact Generation**:
  - SQL annotations emit a `sql-statement` fact carrying `statementType` (`SELECT`/`INSERT`/`UPDATE`/`DELETE`) and the extracted SQL string.
  - `@Results` emits a `mapping` fact with an array of `resultMappings` (`property` -> `column`, plus optional `javaType`, `jdbcType`, `id`).
  - `@Result` emits a `mapping` fact with a single `resultMapping`.
  - `@Param` emits a `mapping` fact with the bound `paramName`.
- **Facet Assignment**: `assignFacet` consistently classifies any matched node as `role: 'Mapper'`, `layer: 'data'`, `confidence: 0.85`, aligning MyBatis mapper interfaces/methods with the data-access tier in the architecture profile engine.
- **Evidence Signals**: Each fact carries a proper `ArchitectureSignal` object (facet/profile/confidence/evidence/scope/filePath) so the facet engine can aggregate and resolve conflicts consistently with other architecture facets.

### Design Notes
- The adapter consumes the `decorators` field on `Node`, which is the canonical place where extracted annotations are surfaced to the architecture layer.
- Annotation strings are parsed with lightweight regexes that handle both simple marker forms (`@Select`) and invocation forms (`@Select("...")`), as well as property-assignment bodies for `@Result` / `@Results`.
- The implementation is intentionally stateless and synchronous so it can be invoked per-node by the facet engine without side effects.

### Exported Artifacts
- `MyBatisAnnotationsAdapter` — the adapter class (`id = 'mybatis-annotations'`, `framework = 'mybatis'`).
- `mybatisAnnotationsAdapter` — a singleton instance ready for registration in the annotation adapter registry.

## Lombok Annotation Adapter Implementation (2026-06-21)

### Key Achievements
- **New Adapter**: Created `src/architecture/adapters/lombok.ts` exporting `lombokAdapter: AnnotationAdapter`.
- **Annotation Detection**: Recognizes `@Getter`, `@Setter`, `@Data`, `@Builder`, `@NoArgsConstructor`, `@AllArgsConstructor`, `@RequiredArgsConstructor`, `@Slf4j`, and `@Accessors` (supports both simple and `@lombok.*` qualified forms).
- **No Materialized Method Nodes**: Emits only lightweight `AnnotationFact` objects; generated getters/setters/constructors are never added as graph `Node`s.
- **Fact Mapping**:
  - `@Getter` / `@Setter` / `@Data` -> `kind: 'generated-property'`, `metadata.generates` tracks which accessors are produced.
  - `@NoArgsConstructor` / `@AllArgsConstructor` -> `kind: 'generated-method'`, `metadata.generates: 'constructor'`.
  - `@RequiredArgsConstructor` on a class with at least one non-static `final` field -> `kind: 'generated-method'`, `metadata.role: 'ConstructorInjection'` (ready for Spring bean-wiring facets).
  - `@Slf4j` -> `kind: 'lifecycle'`, `metadata.generates: 'logger'`.
  - `@Builder` / `@Accessors` -> recognized but produce no facts; they shape generated code without carrying an architectural role.
- **Final-Field Check**: Because the current `Node` type does not expose field modifiers, the adapter performs a bounded source-text scan of the class body to confirm the presence of a non-static `final` field before emitting the constructor-injection fact.

### Design Notes
- `AnnotationFact` has no top-level `role` field, so `ConstructorInjection` is carried in `metadata.role` for downstream facets to consume.
- Evidence signals are emitted with the `lombok` facet/profile names so they integrate cleanly with the existing `FacetSignalAggregator` flow.

## MapStruct Annotation Adapter Implementation (2026-06-21)

### Key Achievements
- **Adapter File**: Created `src/architecture/adapters/mapstruct.ts` implementing the `AnnotationAdapter` interface.

## Spring Annotations Adapter Implementation (2026-06-21)

### Key Achievements
- **Adapter File**: Created `src/architecture/adapters/spring-annotations.ts` exposing `springAnnotationsAdapter` with `id = 'spring-annotations'` and `framework = 'spring'`.
- **Detection Coverage**: Supports `@Component`, `@Service`, `@Repository`, `@Controller`, `@RestController`, `@Configuration`, `@Bean`, `@Autowired`, `@Qualifier`, `@Resource`, `@Value`, and `@ConfigurationProperties`.
- **Fact Kinds**:
  - Stereotype class annotations (`@Component`/`@Service`/`@Repository`/`@Controller`/`@RestController`/`@Configuration`) → `kind: 'bean'` with mapped role and `0.9` confidence.
  - `@Bean` on methods → `kind: 'bean'`, `role: 'FactoryBean'`, bean name resolved from explicit `name=` argument or method name.
  - `@Autowired`/`@Resource` on fields/properties → `kind: 'injection'`, bean type extracted from field signature, `0.7` confidence.
  - `@Qualifier("name")` → `kind: 'injection'` with `metadata.qualifier` extracted from annotation arguments.
  - `@Value("${key}")` → `kind: 'config-binding'` with `metadata.propertyKey`.
  - `@ConfigurationProperties` → `kind: 'config-binding'` with `metadata.prefix` extracted from `prefix=` or the first string literal argument.
- **Facet Assignment**: `assignFacet` produces a `Partial<NodeArchitectureFacet>` with role, logical layer, and confidence:
  - `Controller`/`RestController` → `entry`
  - `Service` → `business`
  - `Repository` → `data`
  - `Configuration`/`Component`/`FactoryBean`/`InjectionPoint`/`ConfigBinding`/`ConfigProperties` → `infra`
- **Argument Parsing**: Added a small, self-contained annotation parser that strips leading `@`, handles fully-qualified names, and extracts quoted string literals and named attributes (`prefix=`, `name=`).
- **Lombok Safety**: The adapter only reads existing nodes and emits facts; it never materializes synthetic Lombok-generated methods as graph nodes.
- **Type Safety**: Verified that the adapter imports from `../../types` and `../types`, conforms to the `AnnotationAdapter` interface, and uses `AnnotationFact` correctly.
- **Detection Coverage**: Detects MapStruct annotations `@Mapper`, `@Mapping`, `@Mappings`, `@BeanMapping`, and `@IterableMapping` from a node's `decorators` array.
- **Bean Fact Extraction**: `@Mapper` on an interface emits a `bean` fact with role `Mapper` and layer `data`.
- **Attribute Parsing**: Parses annotation attribute bodies for `uses` (single class or array of `.class` references), `componentModel`, `source`, `target`, and `elementTargetType`.
- **Spring Integration**: When `componentModel="spring"` is present, emits an additional `bean` fact representing a Spring-managed component role.
- **Synthesized Edges**: Optional `synthesizeEdges` implementation creates heuristic `references` edges from a mapper to each mapper listed in its `uses` attribute, tagged with `synthesizedBy: 'mapstruct-uses'`.
- **Facet Assignment**: `assignFacet` returns `{ role: 'Mapper', layer: 'data', confidence: 0.85 }` for mapper beans and `{ role: 'Component', layer: 'infra', confidence: 0.8 }` for the Spring-derived fact.

### Design Notes
- Kept the adapter framework-agnostic (`framework = 'mapstruct'`) while still recognizing the Spring-specific `componentModel` attribute.
- Annotation parsing is tolerant of leading `@`, quoted values, and array-style `uses = { A.class, B.class }` declarations.
- Evidence signals carry node scope and file path so downstream facet engines can trace decisions.

## Spring Web Annotation Adapter Implementation (2026-06-21)

### Key Achievements
- **Adapter File**: Created `src/architecture/adapters/spring-web.ts` implementing the `AnnotationAdapter` interface.
- **Adapter Identity**: Exposes `springWebAdapter` with `id = 'spring-web'` and `framework = 'spring'`.
- **Detection Coverage**: Supports Spring Web mapping annotations `@RequestMapping`, `@GetMapping`, `@PostMapping`, `@PutMapping`, `@DeleteMapping`, and `@PatchMapping` from a node's `decorators` array.
- **Fact Extraction**: Each mapping annotation emits a `kind: 'bean'` fact with `role: 'Endpoint'` and `layer: 'entry'`.
  - URL path is extracted from `value=`, `path=`, or the first string literal argument.
  - HTTP method is derived from the annotation class name (`GetMapping` → `GET`, `PostMapping` → `POST`, etc.).
  - For `@RequestMapping`, the method is resolved from `method = RequestMethod.X` when present, otherwise defaults to `*`.
- **Facet Assignment**: `assignFacet` returns a `Partial<NodeArchitectureFacet>` with `{ role: 'Endpoint', layer: 'entry', isEntrypoint: true, confidence: 0.95 }`.
- **Evidence Signals**: Each fact carries an `ArchitectureSignal` with node scope, file path, detected annotation, path, and method for traceable downstream decisions.
- **Type Safety**: Verified the adapter conforms to `AnnotationAdapter`, uses `AnnotationFact` correctly, and imports from `../../types` and `../types`.

## Spring Schedule & Event Adapter Implementation (2026-06-21)

### Key Achievements
- **Adapter File**: Created `src/architecture/adapters/spring-schedule-event.ts` implementing the `AnnotationAdapter` interface.
- **Adapter Identity**: `id = 'spring-schedule-event'`, `framework = 'spring'`.
- **Detection Coverage**: Supports Spring scheduling and event annotations from a node's `decorators` array:
  - `@Scheduled`
  - `@EventListener`
  - `ApplicationListener` (interface-style listener detection)
- **Fact Kinds**:
  - `@Scheduled` → `kind: 'lifecycle'`, `role: 'ScheduledJob'`, `layer: 'entry'`, `isEntrypoint: true`.
  - `@EventListener` / `ApplicationListener` → `kind: 'lifecycle'`, `role: 'EventListener'`, `layer: 'entry'`.
- **Name Matching**: `hasDecoratorNamed` helper matches simple annotation names (`Scheduled`) as well as fully-qualified names (`org.springframework.scheduling.annotation.Scheduled`).
- **Facet Assignment**: `assignFacet` returns a `Partial<NodeArchitectureFacet>` with `role`, `layer`, `isEntrypoint`, and `confidence: 0.9`, flattening the fact's evidence signals into human-readable proof.
- **Type Safety**: Verified the adapter imports `Node` from `../../types`, `ArchitectureContext` from `../types`, and `AnnotationAdapter`/`AnnotationFact` from `./types`.

## OpenAPI/Swagger Annotation Adapter Implementation (2026-06-21)

### Key Achievements
- **New Adapter**: Created `src/architecture/adapters/openapi.ts` implementing the `AnnotationAdapter` interface.
- **Adapter Identity**: Exposes `openApiAdapter` with `id = 'openapi'` and `framework = 'openapi'`.
- **Detection Coverage**: Recognizes OpenAPI 3.x and Swagger 2.x annotations from a node's `decorators` array:
  - `@Operation` (OpenAPI 3.x)
  - `@ApiOperation` (Swagger 2.x)
  - `@Tag` (OpenAPI 3.x)
  - `@ApiModelProperty` (Swagger 2.x)
- **Fact Extraction**:
  - `@Operation` → `kind: 'bean'`, metadata carries `summary`, `description`, and `tags` array.
  - `@ApiOperation` → `kind: 'bean'`, metadata carries `summary` (from `value`/`summary`), `description` (from `notes`/`description`), and `tags` array.
  - `@Tag` → `kind: 'mapping'`, metadata carries `tagName` extracted from `name=`.
  - `@ApiModelProperty` → `kind: 'generated-property'`, metadata carries `description` (from `value`/`notes`) and `example`.
- **Argument Parsing**: Lightweight regex-based parser handles simple marker forms, fully-qualified names, named attributes (`summary=`, `description=`, `value=`, `notes=`, `example=`), and array-style `tags = { "a", "b" }` declarations.
- **Facet Assignment**: `assignFacet` returns a `Partial<NodeArchitectureFacet>` with `{ role: 'Endpoint', layer: 'entry', confidence: 0.7 }` for every matched fact, as specified for the OpenAPI adapter contract.
- **Evidence Signals**: Each fact carries a proper `ArchitectureSignal` (facet/profile/confidence/evidence/scope/filePath) so the facet engine can aggregate and resolve conflicts consistently with other architecture facets.
- **Type Safety**: Verified the adapter imports `Node` from `../../types`, `ArchitectureContext` from `../types`, and `AnnotationAdapter`/`AnnotationFact` from `./types`.

### Exported Artifacts
- `OpenApiAdapter` — the adapter class (`id = 'openapi'`, `framework = 'openapi'`).
- `openApiAdapter` — a singleton instance ready for registration in the annotation adapter registry.

## Bean Validation Adapter Implementation (2026-06-21)

### Key Achievements
- **New Adapter**: Created `src/architecture/adapters/validation.ts` implementing the `AnnotationAdapter` interface.
- **Adapter Identity**: Exposes `validationAdapter` with `id = 'validation'` and `framework = 'bean-validation'`.
- **Detection Coverage**: Supports Jakarta/Java Bean Validation annotations from a node's `decorators` array:
  - `@NotNull`
  - `@NotBlank`
  - `@Valid`
  - `@Validated`
  - `@Size`
  - `@Pattern`
- **Fact Kinds**:
  - `@NotNull` / `@NotBlank` → `kind: 'config-binding'` with `metadata.constraint` set to `'not-null'` / `'not-blank'`.
  - `@Valid` / `@Validated` → `kind: 'lifecycle'` with `metadata.propagatesValidation: true`, indicating validation should cascade to nested objects.
  - `@Size` → `kind: 'config-binding'` with extracted `metadata.min` and `metadata.max` numeric bounds.
  - `@Pattern` → `kind: 'config-binding'` with extracted `metadata.regex` string.
- **Facet Assignment**: `assignFacet` consistently classifies any matched node as `role: 'Component'`, `layer: 'infra'`, `confidence: 0.6`, aligning validation constraints with infrastructure concerns in the architecture profile engine.
- **Evidence Signals**: Each fact carries an `ArchitectureSignal` with node scope, file path, detected annotation, and extracted metadata for traceable downstream decisions.
- **Type Safety**: Verified the adapter imports `Node` from `../../types`, `ArchitectureContext`/`NodeArchitectureFacet` from `../types`, and `AnnotationAdapter`/`AnnotationFact` from `./types`, and conforms to the `AnnotationAdapter` interface.

### Design Notes
- Annotation parsing tolerates leading `@`, fully-qualified names, and invocation-style arguments (`@Size(min = 1, max = 100)`).
- The adapter is stateless and synchronous so it can be invoked per-node by the facet engine without side effects.

## Rule-Based Annotation Adapter Implementation (2026-06-21)

### Key Achievements
- **New Adapter**: Created `src/architecture/adapters/rule-based.ts` implementing the `RuleBasedAdapter` interface (an extension of `AnnotationAdapter`).
- **Adapter Identity**: Exposes `ruleBasedAdapter` with `id = 'rule-based'` and `framework = 'custom'`.
- **Runtime Extensibility**: Provides `registerRule(rule)` to add company-specific or custom annotation mappings at runtime without modifying core adapters.
- **Default Rules**: Ships with an empty rule set; all mappings are opt-in via `registerCustomRule(rule)` or direct `ruleBasedAdapter.registerRule(rule)`.
- **Detection Coverage**: `supports()` returns true when a node carries any decorator whose simple name matches a registered rule's `annotation`.
- **Fact Generation**: Each matching rule emits a `kind: 'bean'` `AnnotationFact` carrying the produced `role`, `layer`, and optional `tags` from `rule.produces` inside `metadata`.
- **Evidence Signals**: Each fact carries an `ArchitectureSignal` with node scope, file path, matched annotation, and produced role/layer/tags for traceable downstream decisions.
- **Facet Assignment**: `assignFacet` maps the rule's `role` and `layer` to a `Partial<NodeArchitectureFacet>`, validating `layer` against the known `ArchitectureLayer` union and defaulting unknown layers to `'unknown'`.
- **Exported Artifacts**:
  - `ruleBasedAdapter: AnnotationAdapter` — singleton instance ready for registration.
  - `registerCustomRule(rule)` — convenience function to register rules against the singleton.

### Design Notes
- Annotation matching normalizes decorator strings by stripping a leading `@`, discarding invocation arguments, and comparing only the simple name (last segment of fully-qualified names).
- `RuleBasedAdapterRule.adapterId` is treated as the rule/profile identifier and is surfaced in the evidence signal's `profileName` and the facet's `profileId`.
- The adapter is synchronous and stateful only in its rule list, so it can be invoked per-node by the facet engine while remaining safe for runtime extension.

## Annotation Adapter Framework Tests (2026-06-21)

### Key Achievements
- **New Test File**: Created `__tests__/annotation-adapters.test.ts` covering the annotation adapter framework end-to-end.
- **Registry Contract**: Verified `AnnotationAdapterRegistry` preserves insertion order, returns adapters by id, returns defensive copies, and clears cleanly.
- **Unknown Annotation Safety**: Confirmed unsupported annotations and missing `decorators` arrays are silently ignored — no thrown errors and zero emitted facts.
- **Rule-Based Extensibility**: Implemented an inline `RuleBasedAdapter` to verify `registerRule` and custom annotation detection, plus independence from core adapters (rule additions do not mutate core singleton behavior).
- **Singleton Exports**: Verified every adapter (`spring-annotations`, `mybatis-annotations`, `spring-web`, `spring-schedule-event`, `lombok`, `mapstruct`, `validation`, `openapi`, `rule-based`) exports a defined singleton instance with unique ids, frameworks, and `supports`/`collectFacts` methods.
- **Test Run**: All 13 tests pass with zero errors.

### Design Notes
- Adapters use manual `Node` mocks rather than `vi.mock`, keeping tests deterministic and free of Node/fs side effects.
- The `RuleBasedAdapter` is tested through a local test implementation to avoid mutating the exported singleton's rule list, while the singleton itself is still covered by the export contract test.
