## Why

CodeGraph already has a strong generic knowledge graph, traversal engine, MCP surface, and a working WebUI, but its current architecture-aware experience is still tied to SpringCloud-specific heuristics embedded directly in the web layer. That makes the UI harder to extend, duplicates interpretation logic across backend and frontend, and limits the graph's ability to answer architecture-level questions such as end-to-end traces and change impact in a reusable, profile-driven way.

This change turns architecture awareness into a first-class interpretation layer on top of the existing graph rather than a special-case mode inside the UI. The opportunity is to keep CodeGraph's generic graph and public APIs stable while adding a pluggable Profile and Facet engine that can detect project architecture, explain nodes in architectural terms, and power trace, impact, and visualization workflows for Spring-centric Java systems first and other architectures later.

## What Changes

- Introduce a Profile and Facet runtime that interprets the existing generic graph as architecture semantics without changing core graph primitives.
- Add a Spring Cloud profile as the first concrete architecture profile, including project detection, layer assignment, role classification, and confidence-scored evidence.
- Define annotation adapter contracts and built-in adapters so framework- and project-specific annotations can contribute architecture signals without hardcoding them into the web server.
- Add architecture trace and impact APIs that wrap existing traversal capabilities in architecture-oriented responses.
- Refactor the WebUI to consume profile-driven architecture metadata, remove duplicated Spring role inference from the frontend, and support richer architecture views and layouts.
- Hook architecture recomputation into full indexing, incremental sync, watch mode, and delete cleanup so architecture state stays aligned with the graph.
- Strengthen resolver coverage for Spring bean wiring, interface-to-implementation dispatch, MyBatis XML, Java field impact, and Spring configuration impact so trace and impact results are useful at architecture level.
- Split web architecture response-building into dedicated server-side modules so `server.ts` becomes a thinner router and architecture behavior is easier to evolve.
- Preserve existing library APIs, CLI semantics, MCP tool compatibility, and current overview response shapes while exposing architecture data only through additive fields and new endpoints.

## Capabilities

### New Capabilities

- `architecture-profile-engine`: Core type system and runtime for registering profiles, composing facets, assigning architecture roles, and exposing interpreted architecture metadata from the generic graph.
- `spring-cloud-profile`: First built-in architecture profile for Spring-centric Java systems, including layers, roles, naming and annotation heuristics, and confidence-based project detection.
- `annotation-adapters`: Adapter contract and built-in adapter set, plus rule-driven extension points for custom annotation interpretation without changing core architecture logic.
- `architecture-trace-api`: Architecture-aware trace endpoint that packages `findPath`, `getCallees`, and `getCallers` results into entry-to-dependency flow responses.
- `architecture-impact-api`: Architecture-aware impact endpoint that wraps `getImpactRadius` and aggregates results by role, layer, and affected architecture surface.
- `architecture-webui`: Profile-driven architecture UI with dynamic profile presentation, profile-based navigation and color semantics, new architecture tabs, dagre layout with fallback, and no frontend `classifySpringRole` logic.
- `architecture-incremental-sync`: Incremental architecture recomputation integrated with `indexAll`, `sync`, and `watch`, including per-file recompute, global profile re-detection triggers, and delete cleanup.
- `web-architecture-api`: Server-side architecture API split that separates request routing, architecture response assembly, and graph-to-web response shaping.
- `spring-bean-wiring`: Spring dependency injection resolver covering field and constructor injection, qualifier-based selection, resource-name lookup, and explicit ambiguity handling for multi-implementation wiring.
- `interface-impl-dispatch`: Interface-to-implementation dispatch resolver that synthesizes call and impact paths across overloaded, generic, and multi-implementation scenarios.
- `mybatis-xml-impact`: MyBatis XML extractor and resolver that links mapper XML namespaces and statements to methods, entities, tables, columns, and downstream impact paths.
- `java-field-impact`: Java field impact synthesis that connects fields through getters, setters, Lombok, MapStruct, MyBatis XML column usage, and `@JsonProperty` mappings.
- `spring-config-impact`: Spring configuration impact support that links `@Value`, `@ConfigurationProperties`, and application configuration files into graph-based impact analysis.

### Modified Capabilities

## Impact

- Graph model and traversal: The generic graph remains the system of record. `NodeKind` and `EdgeKind` strings stay unchanged, and existing traversal semantics for `indexAll`, `sync`, `watch`, `searchNodes`, `getCallers`, `getCallees`, `getImpactRadius`, `findPath`, `buildContext`, and `codegraph affected` remain intact.
- Architecture layer: A new architecture interpretation subsystem is added above extraction and resolution, introducing profiles, facets, signals, role assignment, and confidence-scored heuristic metadata without replacing the underlying graph.
- Java and Spring resolution: Spring bean wiring, interface dispatch, MyBatis XML, field-linking, and configuration-linking coverage expand so architecture traces and impact analysis can cross framework boundaries that are currently incomplete.
- Web server and HTTP APIs: The web backend gains dedicated architecture endpoints and response builders, while existing overview modes such as `?mode=springcloud|modules|layered` keep their current response shape and expose `facets` only as an additive field.
- WebUI and visualization: The frontend moves from hardcoded SpringCloud logic to profile-driven rendering, dynamic sidebars, and architecture-specific tabs, while preserving a `generic` fallback for repositories that do not match any profile.
- Incremental indexing and watch behavior: Architecture recomputation becomes part of full and incremental indexing, including file-scoped recompute on sync, project-level re-detection for global signals, and cleanup when indexed files are removed.
- Library, CLI, and MCP compatibility: Existing public APIs, CLI commands, MCP tool names, and current tool outputs remain backward compatible; architecture information is surfaced only through additive fields and new endpoints rather than by changing existing payload meanings.
- Profile matching behavior: Projects without a matching architecture profile fall back to `generic`, ensuring the new engine enhances profile-aware projects without regressing unsupported codebases.
