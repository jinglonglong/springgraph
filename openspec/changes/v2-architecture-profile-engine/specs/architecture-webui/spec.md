## ADDED Requirements

### Requirement: Profile pill and evidence drawer
The WebUI top bar MUST display the active architecture profile identifier, the profile confidence, and a `检测依据` control that opens an evidence modal. The evidence modal SHALL present the profile detection evidence returned by the backend so users can inspect why the current profile was selected without relying on frontend-only inference.

#### Scenario: Active profile shown in top bar
- **WHEN** the WebUI loads architecture data with an `activeProfile` and confidence value
- **THEN** the top bar MUST show the active profile and its confidence alongside the architecture controls

#### Scenario: Detection evidence opened from top bar
- **WHEN** the user activates the `检测依据` control
- **THEN** the UI MUST open an evidence modal populated from backend profile evidence for the active project

### Requirement: Sidebar driven by profile.roles / profile.layers
The sidebar MUST render role, layer, module, entrypoint, and edge-type sections from backend-provided architecture facets derived from `profile.roles` and `profile.layers`. The frontend MUST NOT compute Spring role categories locally, and any prior `classifySpringRole()`-style logic SHALL be removed from sidebar rendering.

#### Scenario: Sidebar sections come from backend facets
- **WHEN** the backend returns architecture facets for roles, layers, modules, entrypoints, and edge types
- **THEN** the sidebar MUST render those sections directly from the returned facet data

#### Scenario: Sidebar does not infer Spring roles locally
- **WHEN** the frontend renders architecture navigation for a Spring project
- **THEN** it MUST NOT call a frontend `classifySpringRole()` function or any equivalent local Spring role classifier

### Requirement: Profile-driven Cytoscape colors and edge styles
The Cytoscape graph MUST color nodes according to the active `colorBy` mode of `role`, `layer`, or `module`, using profile-driven semantics rather than hardcoded Spring-only colors. Heuristic edges MUST render with dashed or dotted styles according to their provenance metadata so synthesized relationships remain visually distinct from primary graph edges.

#### Scenario: Node colors respond to selected color mode
- **WHEN** the user changes `colorBy` between `role`, `layer`, and `module`
- **THEN** node colors MUST update to reflect the selected profile-driven grouping mode

#### Scenario: Heuristic edges are visually distinct
- **WHEN** the graph includes heuristic edges with provenance metadata
- **THEN** those edges MUST render with dashed or dotted styling based on provenance instead of using the default solid style

### Requirement: New tabs in detail panel
The node detail panel MUST add `架构`, `调用链`, and `影响` tabs that call the new architecture endpoints and present architecture-oriented data separate from generic node details. These tabs SHALL use the backend architecture API as the system of record for traces, impact, and profile-specific interpretation.

#### Scenario: Architecture tab available in detail panel
- **WHEN** the user opens the detail panel for a node in architecture mode
- **THEN** the panel MUST include a `架构` tab that loads architecture metadata from the new architecture endpoints

#### Scenario: Trace and impact tabs call architecture endpoints
- **WHEN** the user selects `调用链` or `影响` in the detail panel
- **THEN** the UI MUST request the corresponding architecture trace or impact data from the new architecture endpoints

### Requirement: Dagre layout with fallback
The layered architecture view MUST attempt to render with the `dagre` layout first. If `dagre` layout application fails, the UI MUST fall back to `breadthfirst` layout and SHALL surface the fallback state visibly so users know the preferred layered layout was unavailable.

#### Scenario: Dagre layout succeeds
- **WHEN** the user enters the layered architecture view and `dagre` layout completes successfully
- **THEN** the graph MUST render using the layered `dagre` arrangement

#### Scenario: Dagre layout falls back visibly
- **WHEN** `dagre` layout fails during layered view rendering
- **THEN** the UI MUST switch to `breadthfirst` layout and display that a fallback layout is being used

### Requirement: Profile-aware state and removed frontend classifySpringRole
Frontend architecture state MUST expose `profileId`, `facets`, `groupBy`, and `colorBy` as first-class state inputs for rendering and interactions. The legacy frontend `classifySpringRole()` function MUST be deleted so architecture state and rendering rely exclusively on backend profile interpretation and facet payloads.

#### Scenario: Profile-aware state available to architecture UI
- **WHEN** architecture data is loaded into frontend state
- **THEN** the state model MUST include `profileId`, `facets`, `groupBy`, and `colorBy` for use across the architecture UI

#### Scenario: Legacy Spring role classifier removed
- **WHEN** the frontend codebase is updated for the profile engine
- **THEN** the old `classifySpringRole()` function MUST no longer exist in the frontend implementation
