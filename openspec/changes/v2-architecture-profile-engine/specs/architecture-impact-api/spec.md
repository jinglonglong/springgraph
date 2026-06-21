## ADDED Requirements

### Requirement: GET /api/architecture/impact
The server SHALL provide `GET /api/architecture/impact` as an additive architecture endpoint. The endpoint MUST accept `nodeId`, `query`, and `depth`, MUST wrap the existing `getImpactRadius` capability, and MUST return an architecture-oriented breakdown covering entrypoint, service, mapper, sql, field, and config surfaces together with an overall risk level.

#### Scenario: NodeId-based impact returns architecture breakdown
- **WHEN** a client requests `GET /api/architecture/impact` with a resolvable `nodeId`
- **THEN** the response MUST include the wrapped impact result, a breakdown across entrypoint, service, mapper, sql, field, and config categories, and an overall risk level

#### Scenario: Query-based impact resolves before aggregation
- **WHEN** a client requests `GET /api/architecture/impact` with a `query` instead of an explicit node identifier
- **THEN** the endpoint MUST resolve the query through the indexed graph and return the same structured architecture impact breakdown with a risk level

### Requirement: Impact bounds depth and excludes reverse-contains explosion
The architecture impact endpoint SHALL bound traversal depth and avoid structural explosion from containment edges. The `depth` parameter MUST default to `3`, and `contains` relationships MUST NOT be followed backwards from the target node when computing architecture impact results.

#### Scenario: Missing depth uses default bound
- **WHEN** a client omits the `depth` parameter on `GET /api/architecture/impact`
- **THEN** the endpoint MUST execute impact analysis using a default depth of `3`

#### Scenario: Reverse contains traversal is suppressed
- **WHEN** impact analysis begins from a target node that is contained by broader parent structures
- **THEN** the traversal MUST NOT follow `contains` edges backwards from the target in a way that explodes the impact surface through enclosing files, modules, or containers

### Requirement: Impact recommended regression set
The architecture impact response SHALL include a `recommendedTests` array that is derived from affected entrypoints, services, and mappers so clients can use the impact result to prioritize regression validation. The recommendation logic MUST be additive to the existing impact traversal and MUST return a stable structured array even when the affected set is small.

#### Scenario: Affected entrypoints and services generate recommendations
- **WHEN** impact analysis identifies affected entrypoints, services, or mappers for the target change
- **THEN** the response MUST include a `recommendedTests` array derived from those affected architecture surfaces

#### Scenario: Minimal impact still returns structured recommendations field
- **WHEN** impact analysis finds only a small or empty affected architecture surface
- **THEN** the response MUST still include a `recommendedTests` array in structured form, using an empty array when no recommendations can be derived
