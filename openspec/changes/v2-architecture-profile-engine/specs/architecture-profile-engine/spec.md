## ADDED Requirements

### Requirement: Profile and Facet type system
The architecture interpretation layer SHALL define stable profile and facet types that sit above the generic graph and MUST represent provenance, confidence, and evidence for every interpreted result. These types MUST support scope levels of `project`, `module`, `file`, and `node` so architecture signals can be recorded and explained at the level where they are observed without changing existing graph primitives.

#### Scenario: Project signal captures provenance and evidence
- **WHEN** the system records a profile detection signal derived from project-wide metadata or graph evidence
- **THEN** the resulting typed signal MUST include its `project` scope, provenance source, confidence value, and evidence entries describing why the signal was produced

#### Scenario: Node facet captures local interpretation
- **WHEN** the system assigns an architecture interpretation to a specific node
- **THEN** the resulting typed facet MUST include its `node` scope, provenance source, confidence value, and evidence entries tied to the observed node-level signals

### Requirement: ProfileRegistry composes profiles and facets
The architecture runtime SHALL provide a `ProfileRegistry` that MUST support registration of profile definitions and facet providers, ordered lookup across registered profiles, and deterministic fallback behavior. If no registered profile matches a project, the registry MUST resolve the active profile to a generic fallback rather than failing or leaving the architecture layer undefined.

#### Scenario: Ordered profile lookup prefers higher-priority match
- **WHEN** multiple registered profiles can interpret the same project signals
- **THEN** the registry MUST evaluate profiles in registration order or declared priority order and return the first matching profile as the active profile

#### Scenario: No profile match returns generic fallback
- **WHEN** none of the registered profiles produce a qualifying match for a project
- **THEN** the registry MUST return a generic fallback profile and MUST preserve normal architecture API behavior without throwing a profile resolution error

### Requirement: FacetEngine produces per-node facets
The architecture runtime SHALL provide a `FacetEngine` that MUST aggregate applicable signals into a `NodeArchitectureFacet` for each interpreted node. Each produced facet MUST include confidence, role, layer, module, and evidence fields so downstream APIs and UI layers can explain how the node was classified without re-running profile-specific heuristics.

#### Scenario: Multiple signals combine into a single facet
- **WHEN** a node has matching signals from annotations, naming, path, or resolver-derived evidence
- **THEN** the facet engine MUST aggregate those signals into one `NodeArchitectureFacet` containing the resolved role, layer, module, confidence, and combined evidence list

#### Scenario: Partial signal set still yields explainable facet
- **WHEN** a node has enough evidence for a role or layer assignment but not for every architecture field
- **THEN** the facet engine MUST return a `NodeArchitectureFacet` with the resolved fields populated, unresolved fields left in default form, and evidence retained for every populated classification

### Requirement: Generic graph is read-only to architecture layer
The architecture layer SHALL treat the generic CodeGraph database and graph model as read-only interpretation input. It MUST NOT mutate `NodeKind` or `EdgeKind` values, repurpose existing graph semantics, or alter existing core tables in order to represent architecture metadata.

#### Scenario: Architecture classification uses additive metadata only
- **WHEN** the architecture layer computes profile or node facet results
- **THEN** it MUST represent those results through additive architecture metadata rather than by rewriting node kinds, edge kinds, or core traversal outputs

#### Scenario: Existing graph primitives remain stable during interpretation
- **WHEN** architecture APIs are invoked for a project that has already been indexed
- **THEN** the architecture layer MUST read from the existing graph and tables without changing previously indexed generic graph records
