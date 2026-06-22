/**
 * The marker-fenced agent-instructions block the installer writes into each
 * agent's instructions file (CLAUDE.md / AGENTS.md / GEMINI.md).
 *
 * History: pre-#529 the installer wrote a full usage playbook here, which
 * duplicated the MCP `initialize` instructions for the main agent — so it
 * was removed and `mcp/server-instructions.ts` became the single source of
 * truth. A much smaller block returned for #704, because the MCP
 * instructions cannot reach two audiences that the instructions FILE does
 * reach:
 *
 *  - **Task-tool subagents** — they receive the project instructions file
 *    in their context but NOT the MCP initialize instructions. They hold
 *    the springgraph MCP tools only as deferred names and rarely think to
 *    load them: measured on a forced-delegation flow question (excalidraw,
 *    sonnet, high effort), subagents loaded + used springgraph in ~1 of 9
 *    runs without this block, and consistently with it — including runs
 *    with zero Read/grep fallback.
 *  - **Non-MCP harnesses** — agents with no MCP client at all can still
 *    run the `springgraph explore` / `springgraph node` CLI, which prints the
 *    same output as the MCP tools.
 *
 * Keep this block SHORT. The main agent reads it every turn on top of the
 * server instructions — the #529 duplication-cost argument still bounds
 * its size. Command names and the two surfaces, nothing more.
 */

/** Markers used by the marker-based section write/removal. */
export const SPRINGGRAPH_SECTION_START = '<!-- SPRINGGRAPH_START -->';
export const SPRINGGRAPH_SECTION_END = '<!-- SPRINGGRAPH_END -->';

/**
 * The full block, markers included, exactly as written to disk.
 *
 * The wording is deliberately CONDITIONAL ("in repositories indexed by…"):
 * a global install writes this into a user-scope file (~/.claude/CLAUDE.md,
 * ~/.codex/AGENTS.md) that applies to every project the user opens —
 * including unindexed ones, where an unconditional "this repository is
 * indexed" claim would send subagents into failing springgraph calls (the
 * noise the unindexed-session policy exists to prevent).
 */
export const SPRINGGRAPH_INSTRUCTIONS_BLOCK = `${SPRINGGRAPH_SECTION_START}
## Springgraph

In repositories indexed by Springgraph (a \`.springgraph/\` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tools** (when available): \`springgraph_explore\` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them. \`springgraph_node\` returns one symbol's source + callers, or reads a whole file with line numbers. If the tools are listed but deferred, load them by name via tool search.
- **Shell** (always works): \`springgraph explore "<symbol names or question>"\` and \`springgraph node <symbol-or-file>\` print the same output.

If there is no \`.springgraph/\` directory, skip Springgraph entirely — indexing is the user's decision.
${SPRINGGRAPH_SECTION_END}`;
