# F3 Real Manual QA — SpringCloud final verification

VERDICT: FAIL

`V1 [0/10] | MCP tools [9/14] | Integration [4/5] | FAIL`

## Scope executed
- Built fresh artifacts with `npm run build` at repo root and `npm run build` in `packages/springkg-mcp`.
- Read the authoritative tool registry in `packages/springkg-mcp/src/server.ts`.
- Ran the real `packages/springkg-mcp/dist/bin/springkg-mcp.js` server against `examples/springcloud-demo`.
- Sent stdio JSON-RPC `initialize`, `tools/list`, and 15 `tools/call` requests (9 implemented + 6 expected-but-missing analysis tools).
- Saved raw MCP responses and post-startup DB counts under `.omo/evidence/final-qa/`.

## Tool coverage summary
Implemented and invoked successfully (9):
- `spring_find_entry`
- `spring_find_feign`
- `spring_find_mapper`
- `spring_find_config`
- `spring_nacos_overview`
- `spring_gateway_route`
- `spring_search_feature`
- `spring_assets_overview`
- `spring_trace_flow`

Expected by plan but missing from MCP registry (counted as failures toward the 14-tool target):
- `spring_method_impact`
- `spring_field_impact`
- `spring_module_summary`
- `spring_find_change_surface`
- `spring_runtime_dependency`
- `spring_env_diff`

Notes on the denominator:
- The user requested a 14-tool target.
- The plan text in the prompt enumerated 15 names.
- The actual server advertises 9 tools in `tools/list`.
- Final score uses the requested 14-target framing: 9 implemented / 14 expected.

## V1 acceptance summary
- V1 §1 FAIL — trace stops at service; no mapper/SQL/table chain.
- V1 §2 FAIL — Feign client/provider mapping not seeded.
- V1 §3 FAIL — `spring_field_impact` missing.
- V1 §4 FAIL — no MQ demo artifacts and `mq` argument unsupported.
- V1 §5 FAIL — scheduled tasks exist in source, but `spring_find_entry({scheduled:"*"})` is unsupported and returns a normal endpoint.
- V1 §6 FAIL — `spring_method_impact` missing.
- V1 §7 FAIL — config key lookup works, but reverse lookup to `@Value` usage location does not.
- V1 §8 FAIL — Chinese feature query `订单` returns no communities.
- V1 §9 FAIL — `spring_method_impact` missing.
- V1 §10 FAIL — `spring_field_impact` missing.

See `v1-1.md` through `v1-10.md` for criterion-level detail.

## Runtime seeding findings
Before server startup, the demo `springkg.db` tables were empty. After one real MCP session, the server logged and persisted:
- `spring_symbols: 17`
- `spring_edges: 12`
- `spring_endpoints: 1`
- `spring_feign_clients: 0`
- `spring_sql_statements: 0`
- `runtime_config_properties: 14`
- `feature_communities: 4`
- `feature_community_members: 9`

This partial seeding explains most failures:
- only `/api/orders/summary` exists as an endpoint row; `/api/users` is missing
- controller→service edges exist
- mapper and SQL layers are not materialized into executable flow data
- Feign linkage is absent despite source annotations

## Cross-team integration assessment
Cross-team domain coverage exists for controller, service, mapper, config, and community tables, but the end-to-end flow is broken.

Observed best-case chain from tool output:
- `GET /api/orders/summary`
- `OrderController.summary`
- `OrderService.getOrderSummary`

Missing from runtime graph:
- mapper method resolution
- SQL statement rows
- table extraction
- Feign client target endpoint linkage

See `integration.md` plus `post-session-db-counts.json`, `criteria-session-stdout.json`, and `mcp-session-stderr.txt`.

## Evidence index
- `mcp-session-stdout.json` — full initial MCP run including `tools/list` and all tool calls
- `mcp-session-stderr.txt` — runtime seeding summary and server startup log
- `tool-list.json` — advertised MCP tools
- `tool-spring_*.json` — per-tool request/response captures
- `criteria-session-stdout.json` — criterion-focused second pass
- `post-session-db-counts.json` — DB counts after runtime seeding
- `v1-1.md` … `v1-10.md` — acceptance criterion evidence
- `integration.md` — cross-team integration evidence
