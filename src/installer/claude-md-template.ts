/**
 * CLAUDE.md template for CodeGraph instructions
 *
 * This template is injected into ~/.claude/CLAUDE.md (global) or ./.claude/CLAUDE.md (local)
 * Keep this in sync with the README.md "Recommended: Add Global Instructions" section
 */

// Markers to identify CodeGraph section for updates
export const CODEGRAPH_SECTION_START = '<!-- CODEGRAPH_START -->';
export const CODEGRAPH_SECTION_END = '<!-- CODEGRAPH_END -->';

export const CLAUDE_MD_TEMPLATE = `${CODEGRAPH_SECTION_START}
## CodeGraph

CodeGraph builds a semantic knowledge graph of codebases for faster, smarter code exploration.

### If \`.codegraph/\` exists in the project

**Use codegraph tools directly in the main session.** Codegraph replaces the need for Explore agents in most cases. Instead of spawning an agent (which takes 30+ tool calls and 1+ minutes), use codegraph MCP tools directly for fast, structured answers:

| Tool | Use For |
|------|---------|
| \`codegraph_explore\` | **Deep exploration** — comprehensive context for a topic in ONE call (replaces Explore agents) |
| \`codegraph_context\` | Quick context for a task (lighter than explore) |
| \`codegraph_search\` | Find symbols by name (functions, classes, types) |
| \`codegraph_callers\` | Find what calls a function |
| \`codegraph_callees\` | Find what a function calls |
| \`codegraph_impact\` | See what's affected by changing a symbol |
| \`codegraph_node\` | Get details + source code for a symbol |

**For deep exploration questions** (e.g., "how does the undo/redo system work?"), use \`codegraph_explore\` directly. It returns full source code sections from all relevant files in a single call — no need to spawn an Explore agent.

**Do NOT tell Explore agents to use codegraph tools.** Testing shows Explore agents use codegraph for discovery then still read all the same files — making them slower, not faster. Codegraph's value is in the main session where it replaces the need for exhaustive file reading.

### If \`.codegraph/\` does NOT exist

At the start of a session, ask the user if they'd like to initialize CodeGraph:

"I notice this project doesn't have CodeGraph initialized. Would you like me to run \`codegraph init -i\` to build a code knowledge graph?"
${CODEGRAPH_SECTION_END}`;
