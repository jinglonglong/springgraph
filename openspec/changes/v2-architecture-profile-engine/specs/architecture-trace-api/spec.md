## ADDED Requirements

### Requirement: GET /api/architecture/trace
The server SHALL provide `GET /api/architecture/trace` as an additive architecture endpoint. The endpoint MUST accept `from`, `to`, and `query` inputs, MUST wrap existing `findPath`, `getCallees`, and `getCallers` graph capabilities rather than replacing them, and MUST return entrypoint metadata, path results with confidence per hop, and warnings describing any architecture-level uncertainty or omitted ambiguity.

#### Scenario: Direct from and to trace returns path with hop confidence
- **WHEN** a client requests `GET /api/architecture/trace` with explicit `from` and `to` values that resolve in the indexed graph
- **THEN** the response MUST include entrypoint metadata, one or more paths, confidence data for each hop, and any applicable warnings

#### Scenario: Query-based trace resolves through architecture wrapper
- **WHEN** a client requests `GET /api/architecture/trace` with a `query` value instead of explicit node identifiers
- **THEN** the endpoint MUST resolve the query through the wrapped traversal capabilities and return the same structured trace shape with entrypoint metadata, path hops, confidence, and warnings

### Requirement: Trace respects provenance and confidence
The architecture trace endpoint SHALL preserve provenance and confidence semantics from the architecture layer. Heuristic edges below the configured confidence threshold MUST be marked with their provenance, and ambiguous hops MUST be surfaced in warnings rather than appearing in the default returned paths unless the caller explicitly requests broader ambiguity handling.

#### Scenario: Low-confidence heuristic edge is marked in trace output
- **WHEN** a returned path includes a hop derived from heuristic architecture evidence below the confidence threshold
- **THEN** that hop MUST be marked with its provenance information in the response so clients can distinguish it from higher-confidence traversal results

#### Scenario: Ambiguous hop is omitted from default path list
- **WHEN** traversal encounters multiple plausible architecture hops that cannot be resolved into a default path confidently
- **THEN** the response MUST place that ambiguity in the warnings list and MUST NOT include the ambiguous hop in the default path set

### Requirement: Trace returns empty result gracefully
The architecture trace endpoint SHALL handle unresolved inputs gracefully. If a supplied `query` cannot be resolved, the endpoint MUST return a structured not-found result with warnings or explanatory metadata and MUST NOT throw an unstructured server error.

#### Scenario: Unknown query returns structured not found response
- **WHEN** a client requests `GET /api/architecture/trace` with a `query` that does not resolve to a known symbol or node
- **THEN** the endpoint MUST return a structured not-found response with an empty path set and explanatory warnings instead of throwing

#### Scenario: Missing path returns empty paths without transport failure
- **WHEN** the `from` and `to` inputs resolve individually but no traversable path exists between them
- **THEN** the endpoint MUST return a successful structured response with empty paths and explanatory warnings rather than a thrown error
