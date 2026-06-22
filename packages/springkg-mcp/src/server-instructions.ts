/**
 * Server-instructions — the single source of truth for agent-facing
 * tool guidance, returned in the MCP `initialize` response.
 *
 * Constraints (per CLAUDE.md and team-e.md plan):
 *   - < 220 lines (MCP SDK truncates beyond that)
 *   - One or two sentences per tool, capability-only (no "you should" / "please")
 *   - Workflow hints are bulleted, not imperative
 *   - Inactive-workspace guidance for unindexed projects
 *   - Sensitive-value handling rule
 *   - NO "please prefer X" / steering — agents under-pick on steering
 */

// -----------------------------------------------------------------------------
// Tool catalog — must stay in sync with TOOL_REGISTRY in server.ts
// -----------------------------------------------------------------------------

const TOOL_SUMMARIES: ReadonlyArray<readonly [string, string]> = [
  ['spring_find_entry', 'Locate entry points by URL, controller class, Feign name, MQ topic, or scheduled task. Returns the endpoint symbol, handler file:line, and call-chain head.'],
  ['spring_assets_overview', 'Survey of services, middlewares, and sensitive config properties. Sensitive values are never returned — only key, file:line, and a sensitivity flag.'],
  ['spring_trace_flow', 'Trace the call flow from an HTTP endpoint, controller, service, repository, mapper, SQL, and table. Depth 1-3 returns 2-4 levels; depth 5 returns the full Endpoint→Controller→Service→Mapper→SQL→Table chain.'],
  ['spring_method_impact', 'Analyze a method\'s callers, callees, endpoints, transaction boundary, exception handlers, and downstream SQL operations.'],
];

// -----------------------------------------------------------------------------
// Composed instructions text
// -----------------------------------------------------------------------------

const TOOL_LIST = TOOL_SUMMARIES.map(([name, desc]) => `- **${name}** — ${desc}`).join('\n');

export const SPRINGKG_SERVER_INSTRUCTIONS = `# SpringKg MCP

SpringKg is a read-only knowledge graph for Spring Boot projects. It answers structural questions about HTTP endpoints, Feign clients, MyBatis mappers, runtime config, and inter-service call flows — backed by a SQLite index in \`.springgraph/springkg.db\`.

## Available tools

${TOOL_LIST}

## Workflows

- **"How does request X reach the database?"** — \`spring_trace_flow\` with the URL and depth 5. One call returns the full Endpoint → Controller → Service → Mapper → SQL → Table chain.
- **"Where is endpoint X handled?"** — \`spring_find_entry\` with the URL or controller class. Returns the handler file:line.
- **"What does Feign client X call?"** — fall back to the upstream \`springgraph_search\` / \`springgraph_explore\` for the Feign interface; the indexed target service is in the interface's javadoc / `@FeignClient(name=...)` attribute.
- **"What breaks if I change method or field X?"** — \`spring_method_impact\` for the Spring-aware callers/callees/transaction/exception breakdown. For non-Spring-specific impact, the upstream \`springgraph_impact\` covers the rest.
- **"Show me services, middlewares, and secrets"** — \`spring_assets_overview\`. Sensitive config keys are listed with file:line and a sensitivity flag — values are never returned.

## Output format

Every tool returns sectioned markdown with headers (\`## Endpoint\`, \`## Controller\`, \`## Mapper\`, etc.). Each section is self-contained — jump to the header you need; don't re-read the whole response.

## Sensitive data

Configuration properties matching password/secret/token/api-key patterns are stored as \`value_hash\` only. \`spring_assets_overview\` never returns the value column for sensitive rows — only the key, file:line, and \`is_sensitive=true\`. If you need the actual value, Read the source file at the listed file:line.

## If the project is not indexed

If the workspace has no \`.springgraph/springkg.db\`, every tool returns a SUCCESS-shaped response with guidance: "Project not indexed. Run \`springkg init && springkg index\` first." This is by design — the server stays queryable, never returns \`isError: true\` for the not-indexed case. The user decides when to index; you don't.

## Trust the results

The index is rebuilt by the file watcher within ~2s of a save, and \`springkg watch\` can be started for explicit auto-sync. \`springkg status\` reports the current symbol and edge counts. If a tool returns zero results, the database is the source of truth — there is no fallback grep that would find more.
`;
