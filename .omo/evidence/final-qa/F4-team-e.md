# F4 Team E — MCP Tools + CLI Audit

**Team**: E (MCP Tools + CLI)
**Owned**: `packages/springkg-mcp/src/**`, `packages/springkg-cli/src/**`
**Tasks**: 20 | **Done**: 10/20 | **Status**: ⚠️ PARTIAL + CONTAMINATED

## Task Completion

### Phase E1 (Sprint 1) — ✅ Done (10/10)

| # | Task | Status | File Evidence |
|---|------|--------|---------------|
| T10 | CLI init/index/status | ✅ | `springkg-cli/src/index.ts` |
| T17 | MCP server | ✅ | `springkg-mcp/src/server.ts` |
| T18 | spring_find_entry | ✅ | `tools/find-entry.ts` |
| T19 | spring_find_feign | ✅ | `tools/find-feign.ts` |
| T20 | spring_assets_overview | ✅ | `tools/assets-overview.ts` |
| T21 | spring_trace_flow | ✅ | `tools/trace-flow.ts` |
| T60 | server-instructions.ts | ✅ | `server-instructions.ts` |
| T61 | CLI watch | ✅ | `commands/watch.ts` |
| T62 | CLI inspect | ✅ | `commands/inspect.ts` |
| T64 | CLI rebuild-community + uninit | ✅ | `commands/rebuild-community.ts` + `uninit.ts` |

### Phase E2-E3 (Sprint 2-4) — ❌ Missing (0/10)

| # | Task | Status | File Evidence |
|---|------|--------|---------------|
| T33 | spring_find_mapper | ❌ | Not implemented |
| T34 | spring_trace_flow extended | ❌ | Not implemented |
| T44 | spring_find_config | ❌ | Not implemented |
| T45 | spring_nacos_overview + gateway_route | ❌ | Not implemented |
| T51 | spring_search_feature | ❌ | Not implemented |
| T52 | spring_method_impact + field_impact | ❌ | Not implemented |
| T53 | spring_module_summary | ❌ | Not implemented |
| T54 | spring_find_change_surface | ❌ | Not implemented |
| T55 | spring_runtime_dependency | ❌ | Not implemented |
| T56 | spring_env_diff | ❌ | Not implemented |

## Violations

### Cross-team contamination (Team G → Team E)

**File**: `packages/springkg-mcp/src/server.ts`
**Diff**: +2025 lines, -227 lines (2458 total lines of diff)

Team G injected self-seeding logic (T68 from their plan) into Team E's MCP server:
- Added `SeedSymbol`, `SeedEdge`, `SeedEndpoint`, `SeedFeignClient`, `SeedSqlStatement` interfaces
- Added `CodeGraphContext` interface and full implementation
- Removed original file header comment
- Added `import { createHash } from 'crypto'`

**Team G's plan explicitly prohibits**: `❌ 不修改 packages/springkg-mcp/** (Team E owns)`

## Evidence

- 9/15 MCP tools confirmed via `tools/list` in F3 QA
- 6 missing tools: method_impact, field_impact, module_summary, find_change_surface, runtime_dependency, env_diff
- `server-instructions.ts` exists and references all 15 tools (including 6 not yet implemented)
- `springkg-cli/` has 9 commands implemented
