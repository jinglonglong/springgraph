## ADDED Requirements

### Requirement: indexAll triggers full recompute
After `indexAll` completes, project-level architecture facets MUST be available for the indexed project, including profile detection outputs needed by the architecture APIs and WebUI. Full architecture recomputation SHALL be guarded by a lock so concurrent indexing or sync activity cannot expose partially recomputed project-level architecture state.

#### Scenario: Full index populates project-level facets
- **WHEN** a project finishes `indexAll`
- **THEN** project-level architecture facets MUST be available for subsequent architecture queries

#### Scenario: Full recompute is lock-guarded
- **WHEN** architecture recomputation runs as part of `indexAll`
- **THEN** the recompute MUST be protected by a lock that prevents concurrent readers from observing partial project-level architecture state

### Requirement: sync recomputes only changed files
After `sync`, architecture recomputation MUST update only the files affected by the incremental change unless a project-level trigger requires broader detection. A file added by `sync` SHALL gain architecture facets, a modified file SHALL have refreshed facets reflecting current source contents, and a deleted file SHALL have all stale architecture facets evicted.

#### Scenario: Added file gains facets after sync
- **WHEN** `sync` processes a newly added file
- **THEN** architecture facets for that file MUST be available after the sync completes

#### Scenario: Modified file reflects latest architecture state
- **WHEN** `sync` processes a modified file
- **THEN** the file's architecture facets MUST reflect the updated source rather than the previous indexed state

#### Scenario: Deleted file facets are evicted
- **WHEN** `sync` processes a deleted file
- **THEN** any stale architecture facets for that file MUST be removed from stored architecture state

### Requirement: Global file changes trigger project-level re-detect
Changes to global architecture signal files such as Maven, Gradle, or YAML configuration artifacts MUST trigger project-level profile re-detection rather than only file-scoped facet recomputation. Responses served after such a sync MUST NOT return a stale `activeProfile`, even when the project’s detected architecture changes because of those global file updates.

#### Scenario: Build or config file change re-runs profile detection
- **WHEN** `sync` processes a changed `pom`, build, or YAML file that contributes architecture detection signals
- **THEN** the architecture engine MUST re-run project-level profile detection

#### Scenario: Active profile is not stale after re-detect trigger
- **WHEN** a global signal change causes profile detection to run during sync
- **THEN** subsequent architecture responses MUST return the newly detected `activeProfile` instead of stale profile metadata

### Requirement: WebUI sees fresh facets without restart
After `watch()` triggers an automatic sync, the architecture API surface MUST return refreshed architecture facets within the configured debounce window without requiring a process restart or manual UI refresh sequence beyond the normal request flow. The WebUI SHALL observe updated architecture results from `/api/architecture/*` after auto-sync settles.

#### Scenario: Watch-triggered sync refreshes architecture API
- **WHEN** `watch()` detects a file change and auto-sync completes after the debounce window
- **THEN** `/api/architecture/*` MUST return updated facets for the changed project state

#### Scenario: WebUI does not require restart for fresh architecture data
- **WHEN** the WebUI requests architecture data after a watch-triggered sync has settled
- **THEN** it MUST receive fresh facets without restarting the backend or reinitializing the project
