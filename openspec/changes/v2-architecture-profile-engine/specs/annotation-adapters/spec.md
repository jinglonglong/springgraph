## ADDED Requirements

### Requirement: AnnotationAdapter contract
The architecture layer SHALL expose an `AnnotationAdapter` contract that interprets framework and project annotations into architecture signals. An adapter MUST emit one or more of `AnnotationFact`, synthesized edge, or facet assignment outputs as additive interpretation results, and it MUST NOT mutate the underlying graph directly while doing so.

#### Scenario: Adapter emits architecture facts without graph mutation
- **WHEN** an adapter recognizes a supported annotation on a node
- **THEN** it MUST return additive interpretation outputs such as `AnnotationFact`, synthesized edge, or facet assignment and MUST NOT rewrite nodes, edges, or existing graph tables directly

#### Scenario: Adapter emits only supported output forms
- **WHEN** an adapter contributes annotation-derived architecture information
- **THEN** the contribution MUST be expressed through the adapter contract output forms rather than through profile-specific side effects outside the contract

### Requirement: Built-in adapter coverage
The system SHALL provide built-in annotation adapters that MUST support Spring, Spring web, Spring schedule and event annotations, MapStruct, Lombok, MyBatis, validation, and OpenAPI annotations so those annotations can contribute architecture signals without being hardcoded into web-layer classification logic.

#### Scenario: Spring web annotation produces request-layer facts
- **WHEN** a supported Spring web annotation is present on a class or method
- **THEN** the built-in adapter set MUST emit architecture facts or facet assignments that can be consumed by the Spring profile and architecture APIs

#### Scenario: Mapper and validation annotations contribute non-web facts
- **WHEN** supported MapStruct, MyBatis, Lombok, validation, or OpenAPI annotations are present
- **THEN** the built-in adapter set MUST emit the corresponding additive facts needed for architecture classification and API response enrichment

### Requirement: Rule-based adapter for custom annotations
The annotation adapter system SHALL support rule-based registration for custom annotations. Registering a new annotation rule MUST NOT require changes to resolver logic, profile engine internals, or WebUI classification code in order for the new annotation to contribute architecture facts.

#### Scenario: New custom rule is registered without engine changes
- **WHEN** a caller registers a new annotation rule that maps a custom annotation to architecture facts
- **THEN** the system MUST make that rule available through the adapter pipeline without requiring code changes in the resolver, profile engine, or WebUI

#### Scenario: Custom rule participates in downstream classification
- **WHEN** a registered custom annotation rule matches a node during architecture interpretation
- **THEN** the resulting facts MUST be consumable by profiles and facets using the same adapter output pipeline as built-in rules

### Requirement: Unknown annotation is ignored
Adapters SHALL ignore annotations they do not recognize. For any unrecognized annotation, the adapter pipeline MUST return an empty fact list and MUST NOT throw, fail profile detection, or degrade unrelated architecture interpretation.

#### Scenario: Unrecognized annotation returns no facts
- **WHEN** an adapter evaluates an annotation that has no built-in or registered rule
- **THEN** the adapter pipeline MUST return an empty fact list for that annotation

#### Scenario: Unknown annotation does not fail architecture processing
- **WHEN** a file or node contains unrecognized annotations alongside recognized ones
- **THEN** the system MUST continue architecture interpretation normally and MUST process the recognized annotations without throwing because of the unknown annotation
