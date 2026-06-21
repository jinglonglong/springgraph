## ADDED Requirements

### Requirement: Field injection edges
Spring field injection using `@Autowired` or `@Resource` MUST emit `references` edges that model the dependency from the owning bean to the injected bean. Each synthesized field-injection edge SHALL carry `synthesizedBy: spring-bean-wiring` and `injection: field` metadata so downstream trace and architecture consumers can distinguish the edge from extracted source-level references.

#### Scenario: Autowired field emits injection edge
- **WHEN** a Spring bean declares a field annotated with `@Autowired`
- **THEN** indexing MUST emit a `references` edge with `synthesizedBy: spring-bean-wiring` and `injection: field`

#### Scenario: Resource field emits injection edge
- **WHEN** a Spring bean declares a field annotated with `@Resource`
- **THEN** indexing MUST emit a `references` edge with `synthesizedBy: spring-bean-wiring` and `injection: field`

### Requirement: Constructor injection edges
Spring constructor injection MUST synthesize dependency edges for explicit constructors and for Lombok-generated constructor patterns represented by `@RequiredArgsConstructor`. The emitted dependency edges SHALL model constructor-based bean wiring so traces and impact queries can cross constructor injection boundaries without changing the existing graph primitive kinds.

#### Scenario: Explicit constructor emits injection edges
- **WHEN** a Spring bean declares an explicit constructor that receives bean dependencies
- **THEN** indexing MUST emit constructor injection `references` edges for those dependencies

#### Scenario: RequiredArgsConstructor emits injection edges
- **WHEN** a Spring bean uses `@RequiredArgsConstructor` for dependency injection
- **THEN** indexing MUST emit constructor injection edges for the required dependencies

### Requirement: Qualifier boosts confidence, ambiguity does not connect
Qualifier metadata such as `@Qualifier` and `@Resource(name=...)` MUST increase wiring confidence when selecting a concrete bean target. If multiple candidate implementations exist without a qualifier, the wiring result MUST be marked `ambiguous` and SHALL be excluded from default trace expansion so the graph does not invent a single definitive dependency where none can be justified.

#### Scenario: Qualifier increases selection confidence
- **WHEN** constructor or field injection includes `@Qualifier` or `@Resource(name=...)`
- **THEN** the resolved bean wiring MUST record boosted confidence for the selected target

#### Scenario: Ambiguous multi-implementation wiring does not default-connect
- **WHEN** multiple bean implementations match an injection target and no qualifier resolves the ambiguity
- **THEN** the wiring MUST be marked `ambiguous` and excluded from default trace expansion

### Requirement: Field injection recognizes final field + Lombok constructor
`@RequiredArgsConstructor` applied to a bean with a `final` dependency field MUST be interpreted as constructor injection rather than field injection. The resulting synthesized dependency edge SHALL carry `injection: constructor` so the architecture layer reflects the effective runtime wiring semantics rather than the field declaration form.

#### Scenario: Final field with RequiredArgsConstructor uses constructor metadata
- **WHEN** a bean has a `final` dependency field and `@RequiredArgsConstructor`
- **THEN** the synthesized wiring edge MUST be emitted with `injection: constructor`

#### Scenario: Lombok constructor path is not mislabeled as field injection
- **WHEN** the resolver handles `@RequiredArgsConstructor`-based wiring for final fields
- **THEN** it MUST NOT emit the resulting edge with `injection: field`
