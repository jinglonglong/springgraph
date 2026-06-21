## ADDED Requirements

### Requirement: Server split
`src/web/architecture-api.ts` MUST own the four `/api/architecture/*` request handlers, and `src/web/graph-response.ts` MUST own graph serialization and architecture response breakdown assembly. `src/web/server.ts` SHALL remain a thin registration surface and MUST NOT contain Spring role knowledge or architecture-specific response-building logic.

#### Scenario: Architecture handlers live in dedicated module
- **WHEN** the web server serves any `/api/architecture/*` request
- **THEN** the request handling MUST be implemented by `src/web/architecture-api.ts`

#### Scenario: Server file does not embed Spring role knowledge
- **WHEN** architecture behavior is implemented after the refactor
- **THEN** `src/web/server.ts` MUST NOT contain Spring role classification or Spring-specific architecture interpretation logic

### Requirement: Backward-compatible /api/overview
Existing `/api/overview` responses for `?mode=springcloud`, `?mode=modules`, and `?mode=layered` MUST preserve their current response shape so existing clients remain compatible. Any architecture facet data exposed through `/api/overview` SHALL be additive through a `facets` field and MUST NOT rename, remove, or reinterpret existing fields.

#### Scenario: Existing overview modes keep current shape
- **WHEN** a client requests `/api/overview?mode=springcloud`, `/api/overview?mode=modules`, or `/api/overview?mode=layered`
- **THEN** the response MUST keep its existing shape for pre-existing fields

#### Scenario: Facets are additive on overview responses
- **WHEN** architecture facet data is included in an overview response
- **THEN** it MUST appear as an additive `facets` field without changing the meaning of existing response fields

### Requirement: Filter params hit server
Role, layer, module, and decorator filter chips selected in the UI MUST be applied server-side by the architecture endpoints and overview handlers that support architecture filtering. The UI MUST NOT silently fetch a full result set and perform the authoritative filtering only in the browser.

#### Scenario: Role or layer filters constrain server results
- **WHEN** the client sends role or layer filter parameters to an architecture endpoint
- **THEN** the server MUST apply those filters before returning the result set

#### Scenario: UI does not silently filter complete result set locally
- **WHEN** filter chips for role, layer, module, or decorator are active
- **THEN** the browser MUST rely on server-filtered responses rather than treating a full unfiltered payload as authoritative

### Requirement: Endpoint registration surface
The four architecture endpoints MUST be discoverable and registerable through a single registration call from `server.ts`. That registration surface SHALL be the only place in `server.ts` that wires architecture HTTP routes, ensuring the endpoint set is centralized and easy to evolve without spreading architecture route knowledge across the server file.

#### Scenario: Single registration call wires architecture endpoints
- **WHEN** `server.ts` initializes HTTP routes
- **THEN** it MUST register all four architecture endpoints through a single architecture registration call

#### Scenario: Architecture route surface stays centralized
- **WHEN** a maintainer inspects route registration in `server.ts`
- **THEN** the architecture endpoints MUST be discoverable from one centralized registration surface rather than multiple scattered route declarations
