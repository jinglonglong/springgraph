## ADDED Requirements

### Requirement: Spring Cloud layers and roles
The built-in Spring Cloud architecture profile SHALL define exactly six layers named `entry`, `remote`, `business`, `data`, `model`, and `infra`. The profile MUST also support the role set `controller`, `controller-advice`, `scheduler`, `event-listener`, `filter`, `websocket`, `feign-client`, `service`, `service-impl`, `mapper`, `repository`, `entity`, `config`, `component`, and `app`, and MUST use only those layer and role values when emitting Spring-specific architecture facets.

#### Scenario: Spring role is mapped into one of the six layers
- **WHEN** a Spring class is classified with a supported Spring Cloud role
- **THEN** the resulting facet MUST assign that class to exactly one of the six declared Spring Cloud layers

#### Scenario: Unsupported Spring role names are rejected from output
- **WHEN** a classifier encounters a signal that suggests a role outside the declared Spring Cloud role list
- **THEN** the emitted Spring profile facet MUST use a supported role from the declared list or fall back to generic behavior instead of inventing a new role value

### Requirement: Project-level profile detection
Spring profile detection SHALL aggregate signals from the `spring-annotation`, `maven-module`, `spring-naming`, and `spring-bean-wiring` facets to determine whether a project matches the Spring Cloud profile. The detection result MUST include a confidence score and an evidence list that identifies which of those facet sources contributed to the profile decision.

#### Scenario: Multiple Spring signals produce a confident match
- **WHEN** the project contains Spring annotations, Maven module structure, Spring-oriented naming, and bean wiring signals
- **THEN** the profile detection result MUST mark the Spring Cloud profile as active and MUST include confidence and evidence entries referencing the contributing facet sources

#### Scenario: Weak Spring signal set remains explainable
- **WHEN** only a subset of the Spring detection facets produce evidence for a project
- **THEN** the profile detection result MUST still report its computed confidence and evidence list so callers can understand why the project did or did not match the Spring Cloud profile

### Requirement: Role assignment for Spring classes
The Spring Cloud profile SHALL assign `Controller`, `Service`, `Mapper`, `Entity`, `Config`, and `Application` classes using Spring annotations, naming conventions, and path-based heuristics. When signals conflict, the classifier MUST choose the highest-confidence role assignment and MUST surface evidence that explains the tie-breaking decision used to resolve the conflict.

#### Scenario: Annotation-first role assignment classifies a controller
- **WHEN** a class has controller-oriented Spring annotations and supporting naming or path evidence
- **THEN** the classifier MUST assign the corresponding controller role with confidence and evidence showing the contributing annotation, naming, and path signals

#### Scenario: Conflicting service and mapper signals are tie-broken explicitly
- **WHEN** a class matches more than one supported Spring role through competing annotations, naming patterns, or paths
- **THEN** the classifier MUST choose the highest-confidence role and MUST include evidence that explains why the selected role won over the conflicting alternative

### Requirement: Failure degrades to generic profile
If the system does not observe sufficient Spring-specific signals, the architecture runtime SHALL degrade cleanly to generic behavior. In that case it MUST return `activeProfile: "generic"` and MUST preserve default architecture behavior without emitting misleading Spring role or layer assignments.

#### Scenario: Non-Spring project returns generic profile
- **WHEN** the project lacks qualifying Spring annotations, naming signals, module structure, and bean wiring evidence
- **THEN** the active architecture profile MUST be `generic` and Spring-specific role classification MUST NOT be applied

#### Scenario: Sparse incidental Spring references do not force Spring mode
- **WHEN** the project contains isolated or ambiguous Spring-related symbols that do not meet the profile detection threshold
- **THEN** the system MUST return `activeProfile: "generic"` with default behavior rather than forcing a low-confidence Spring Cloud profile match
