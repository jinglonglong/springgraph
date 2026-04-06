<div align="center">

# 🔮 CodeGraph

### Supercharge Claude Code with Semantic Code Intelligence

**94% fewer tool calls • 77% faster exploration • 100% local**

[![npm version](https://img.shields.io/npm/v/@colbymchenry/codegraph.svg)](https://www.npmjs.com/package/@colbymchenry/codegraph)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)

[![Windows](https://img.shields.io/badge/Windows-supported-blue.svg)](#)
[![macOS](https://img.shields.io/badge/macOS-supported-blue.svg)](#)
[![Linux](https://img.shields.io/badge/Linux-supported-blue.svg)](#)

<br />

### Get Started

```bash
npx @colbymchenry/codegraph
```

<sub>Interactive installer configures Claude Code automatically</sub>

</div>

---

## 🚀 Why CodeGraph?

When you ask Claude Code to work on a complex task, it spawns **Explore agents** that scan your codebase using grep, glob, and file reads. These agents consume tokens with every tool call.

**CodeGraph gives those agents a semantic knowledge graph** — pre-indexed symbol relationships, call graphs, and code structure. Instead of scanning files, agents query the graph instantly.

### 📊 Benchmark Results

We tested the same exploration queries across 4 real-world codebases in different languages, comparing Claude Code's Explore agent **with** and **without** CodeGraph:

| Codebase | Language | Query | With CG | Without CG | Tool Calls | Time Saved |
|----------|----------|-------|---------|-----------|------------|------------|
| **VS Code** | TypeScript | "How does the extension host communicate with the main process?" | 3 calls, 17s | 52 calls, 1m 37s | **94% fewer** | **82% faster** |
| **Excalidraw** | TypeScript | "How does collaborative editing and real-time sync work?" | 3 calls, 29s | 47 calls, 1m 45s | **94% fewer** | **72% faster** |
| **Claude Code** | Python + Rust | "How does tool execution work end to end?" | 3 calls, 39s | 40 calls, 1m 8s | **93% fewer** | **43% faster** |
| **Claude Code** | Java | "How does tool execution work end to end?" | 1 call, 19s | 26 calls, 1m 22s | **96% fewer** | **77% faster** |
| **Alamofire** | Swift | "Trace how a request flows from Session.request() through to the URLSession layer" | 3 calls, 22s | 32 calls, 1m 39s | **91% fewer** | **78% faster** |
| **Swift Compiler** | Swift/C++ | "How does the Swift compiler handle error diagnostics?" | 6 calls, 35s | 37 calls, 2m 8s | **84% fewer** | **73% faster** |

<details>
<summary><strong>Full benchmark details</strong></summary>

All tests used Claude Opus 4.6 (1M context) with Claude Code v2.1.91. Each test spawned a single Explore agent with the same question.

**With CodeGraph — the agent uses `codegraph_explore` and stops:**
| Codebase | Files Indexed | Nodes | Tool Uses | Tokens | Time | File Reads |
|----------|--------------|-------|-----------|--------|------|------------|
| VS Code (TypeScript) | 4,002 | 59,377 | 3 | 56.6k | 17s | 0 |
| Excalidraw (TypeScript) | 626 | 9,859 | 3 | 57.1k | 29s | 0 |
| Claude Code (Python+Rust) | 115 | 3,080 | 3 | 67.1k | 39s | 0 |
| Claude Code (Java) | — | — | 1 | 40.8k | 19s | 0 |
| Alamofire (Swift) | 102 | 2,624 | 3 | 57.3k | 22s | 0 |
| Swift Compiler (Swift/C++) | 25,874 | 272,898 | 6 | 77.4k | 35s | 0 |

**Without CodeGraph — the agent uses grep, find, ls, and Read extensively:**
| Codebase | Tool Uses | Tokens | Time | File Reads |
|----------|-----------|--------|------|------------|
| VS Code (TypeScript) | 52 | 89.4k | 1m 37s | ~15 |
| Excalidraw (TypeScript) | 47 | 77.9k | 1m 45s | ~20 |
| Claude Code (Python+Rust) | 40 | 69.3k | 1m 8s | ~15 |
| Claude Code (Java) | 26 | 73.3k | 1m 22s | ~15 |
| Alamofire (Swift) | 32 | 52.4k | 1m 39s | ~10 |
| Swift Compiler (Swift/C++) | 37 | 99.1k | 2m 8s | ~20 |

**Key observations:**
- With CodeGraph, the agent **never fell back to reading files** — it trusted the codegraph_explore results completely
- Without CodeGraph, agents spent most of their time on discovery (find, ls, grep) before they could even start reading relevant code
- The Java codebase needed only **1 codegraph_explore call** to answer the entire question
- Cross-language queries (Python+Rust) worked seamlessly — CodeGraph's graph traversal found connections across language boundaries
- The Swift benchmark (Alamofire) traced a **9-step call chain** from `Session.request()` to `URLSession.dataTask()` — CodeGraph's graph traversal at depth 3 captured the full chain in one explore call
- The **Swift Compiler** benchmark is the largest codebase tested (**25,874 files, 272,898 nodes**) — CodeGraph indexed it in under 4 minutes and the agent answered a complex cross-cutting question with **6 explore calls and zero file reads** in 35 seconds

</details>

### 🔄 How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                        Claude Code                               │
│                                                                  │
│  "Implement user authentication"                                 │
│           │                                                      │
│           ▼                                                      │
│  ┌─────────────────┐      ┌─────────────────┐                   │
│  │  Explore Agent  │ ──── │  Explore Agent  │                   │
│  └────────┬────────┘      └────────┬────────┘                   │
│           │                        │                             │
└───────────┼────────────────────────┼─────────────────────────────┘
            │                        │
            ▼                        ▼
┌───────────────────────────────────────────────────────────────────┐
│                     CodeGraph MCP Server                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐               │
│  │   Search    │  │   Callers   │  │   Context   │               │
│  │  "auth"     │  │  "login()"  │  │  for task   │               │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘               │
│         │                │                │                       │
│         └────────────────┼────────────────┘                       │
│                          ▼                                        │
│              ┌───────────────────────┐                            │
│              │   SQLite Graph DB     │                            │
│              │   • 387 symbols       │                            │
│              │   • 1,204 edges       │                            │
│              │   • Instant lookups   │                            │
│              └───────────────────────┘                            │
└───────────────────────────────────────────────────────────────────┘
```

**Without CodeGraph:** Explore agents use `grep`, `glob`, and `Read` to scan files → many API calls, high token usage

**With CodeGraph:** Explore agents query the graph via MCP tools → instant results, local processing, fewer tokens

---

## ✨ Key Features

<table>
<tr>
<td width="33%" valign="top">

### 🧠 Smart Context Building
One tool call returns everything Claude needs—entry points, related symbols, and code snippets. No more expensive exploration agents.

</td>
<td width="33%" valign="top">

### 🔍 Semantic Search
Find code by meaning, not just text. Search for "authentication" and find `login`, `validateToken`, `AuthService`—even with different naming conventions.

</td>
<td width="33%" valign="top">

### 📈 Impact Analysis
Know exactly what breaks before you change it. Trace callers, callees, and the full impact radius of any symbol.

</td>
</tr>
<tr>
<td width="33%" valign="top">

### 🌍 19+ Languages
TypeScript, JavaScript, Python, Go, Rust, Java, C#, PHP, Ruby, C, C++, Swift, Kotlin, Dart, Svelte, Liquid, Pascal/Delphi—all with the same API.

</td>
<td width="33%" valign="top">

### 🔒 100% Local
No data leaves your machine. No API keys. No external services. Everything runs on your local SQLite database.

</td>
<td width="33%" valign="top">

### ⚡ Always Fresh
Claude Code hooks automatically sync the index as you work. Your code intelligence is always up to date.

</td>
</tr>
</table>

---

## 🎯 Quick Start

### 1. Run the Installer

```bash
npx @colbymchenry/codegraph
```

The interactive installer will:
- Prompt to install `codegraph` globally (needed for hooks & MCP server to work)
- Configure the MCP server in `~/.claude.json`
- Set up auto-allow permissions for CodeGraph tools
- Add global instructions to `~/.claude/CLAUDE.md` (teaches Claude how to use CodeGraph)
- Install Claude Code hooks for automatic index syncing
- Optionally initialize your current project

### 2. Restart Claude Code

Restart Claude Code for the MCP server to load.

### 3. Initialize Projects

For each project you want to use CodeGraph with:

```bash
cd your-project
codegraph init -i
```

That's it! Claude Code will now use CodeGraph tools automatically when a `.codegraph/` directory exists.

<details>
<summary><strong>Manual Setup (Alternative)</strong></summary>

If you prefer manual configuration:

**Install globally:**
```bash
npm install -g @colbymchenry/codegraph
```

**Add to `~/.claude.json`:**
```json
{
  "mcpServers": {
    "codegraph": {
      "type": "stdio",
      "command": "codegraph",
      "args": ["serve", "--mcp"]
    }
  }
}
```

**Add to `~/.claude/settings.json` (optional, for auto-allow):**
```json
{
  "permissions": {
    "allow": [
      "mcp__codegraph__codegraph_search",
      "mcp__codegraph__codegraph_context",
      "mcp__codegraph__codegraph_callers",
      "mcp__codegraph__codegraph_callees",
      "mcp__codegraph__codegraph_impact",
      "mcp__codegraph__codegraph_node",
      "mcp__codegraph__codegraph_status",
      "mcp__codegraph__codegraph_files"
    ]
  }
}
```

</details>

<details>
<summary><strong>Global Instructions Reference</strong></summary>

The installer automatically adds these instructions to `~/.claude/CLAUDE.md`. This is provided here for reference:

```markdown
## CodeGraph

CodeGraph builds a semantic knowledge graph of codebases for faster, smarter code exploration.

### If `.codegraph/` exists in the project

**NEVER call `codegraph_explore` or `codegraph_context` directly in the main session.** These tools return large amounts of source code that fills up main session context. Instead, ALWAYS spawn an Explore agent for any exploration question (e.g., "how does X work?", "explain the Y system", "where is Z implemented?").

**When spawning Explore agents**, include this instruction in the prompt:

> This project has CodeGraph initialized (.codegraph/ exists). Use `codegraph_explore` as your PRIMARY tool — it returns full source code sections from all relevant files in one call.
>
> **Rules:**
> 1. Follow the explore call budget in the `codegraph_explore` tool description — it scales automatically based on project size.
> 2. Do NOT re-read files that codegraph_explore already returned source code for. The source sections are complete and authoritative.
> 3. Only fall back to grep/glob/read for files listed under "Additional relevant files" if you need more detail, or if codegraph returned no results.

**The main session may only use these lightweight tools directly** (for targeted lookups before making edits, not for exploration):

| Tool | Use For |
|------|---------|
| `codegraph_search` | Find symbols by name |
| `codegraph_callers` / `codegraph_callees` | Trace call flow |
| `codegraph_impact` | Check what's affected before editing |
| `codegraph_node` | Get a single symbol's details |

### If `.codegraph/` does NOT exist

At the start of a session, ask the user if they'd like to initialize CodeGraph:

"I notice this project doesn't have CodeGraph initialized. Would you like me to run `codegraph init -i` to build a code knowledge graph?"
```

</details>

---

## 📋 Requirements

- Node.js >= 18.0.0

---

## 💻 CLI Usage

```bash
codegraph                   # Run interactive installer
codegraph install           # Run interactive installer (explicit)
codegraph init [path]       # Initialize in a project
codegraph uninit [path]     # Remove CodeGraph from a project
codegraph index [path]      # Full index
codegraph sync [path]       # Incremental update
codegraph status [path]     # Show statistics
codegraph query <search>    # Search symbols
codegraph files [path]      # Show project file structure
codegraph context <task>    # Build context for AI
codegraph affected [files]  # Find test files affected by changes
codegraph serve --mcp       # Start MCP server
```

## 📖 CLI Commands

### `codegraph` / `codegraph install`

Run the interactive installer for Claude Code integration. Configures MCP server and permissions automatically.

```bash
codegraph                         # Run installer (when no args)
codegraph install                 # Run installer (explicit)
npx @colbymchenry/codegraph       # Run via npx (no global install needed)
```

The installer will:
1. Prompt to install `codegraph` globally (needed for hooks & MCP server)
2. Ask for installation location (global `~/.claude` or local `./.claude`)
3. Optionally set up auto-allow permissions
4. Configure the MCP server in `claude.json`
5. Add global instructions to `~/.claude/CLAUDE.md` (teaches Claude how to use CodeGraph)
6. Install Claude Code hooks for automatic index syncing
7. For local installs: initialize and index the current project

### `codegraph init [path]`

Initialize CodeGraph in a project directory. Creates a `.codegraph/` directory with the database and configuration.

```bash
codegraph init                    # Initialize in current directory
codegraph init /path/to/project   # Initialize in specific directory
codegraph init --index            # Initialize and immediately index
```

### `codegraph uninit [path]`

Remove CodeGraph from a project. Deletes the `.codegraph/` directory and all indexed data.

```bash
codegraph uninit                  # Remove from current directory
codegraph uninit --force          # Skip confirmation prompt
```

### `codegraph index [path]`

Index all files in the project. Extracts functions, classes, methods, and their relationships.

```bash
codegraph index                   # Index current directory
codegraph index --force           # Force full re-index
codegraph index --quiet           # Suppress progress output
```

### `codegraph sync [path]`

Incrementally sync changes since the last index. Only processes added, modified, or removed files.

```bash
codegraph sync                    # Sync current directory
codegraph sync --quiet            # Suppress output
```

### `codegraph status [path]`

Show index status and statistics.

```bash
codegraph status
```

Output includes:
- Files indexed, nodes, edges
- Nodes by kind (functions, classes, methods, etc.)
- Files by language
- Pending changes (if any)

### `codegraph query <search>`

Search for symbols in the codebase by name.

```bash
codegraph query "authenticate"           # Search for symbols
codegraph query "User" --kind class      # Filter by kind
codegraph query "process" --limit 20     # Limit results
codegraph query "validate" --json        # Output as JSON
```

### `codegraph files [path]`

Show the project file structure from the index. Faster than filesystem scanning since it reads from the indexed data.

```bash
codegraph files                           # Show file tree
codegraph files --format flat             # Simple list
codegraph files --format grouped          # Group by language
codegraph files --filter src/components   # Filter by directory
codegraph files --pattern "*.test.ts"     # Filter by glob pattern
codegraph files --max-depth 2             # Limit tree depth
codegraph files --no-metadata             # Hide language/symbol counts
codegraph files --json                    # Output as JSON
```

### `codegraph context <task>`

Build relevant code context for a task. Uses semantic search to find entry points, then expands through the graph to find related code.

```bash
codegraph context "fix checkout bug"
codegraph context "add user authentication" --format json
codegraph context "refactor payment service" --max-nodes 30
```

### `codegraph affected [files...]`

Find test files affected by changed source files. Traces import dependencies transitively through the graph to discover which test files depend on the code you changed. Works with any test framework and any language CodeGraph supports.

```bash
codegraph affected src/utils.ts src/api.ts         # Pass files as arguments
git diff --name-only | codegraph affected --stdin   # Pipe from git diff
codegraph affected --stdin --json < changed.txt     # JSON output
codegraph affected src/auth.ts --filter "e2e/*"     # Custom test file pattern
codegraph affected src/lib.ts --depth 3 --quiet     # Shallow search, paths only
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--stdin` | Read file list from stdin (one per line) | `false` |
| `-d, --depth <n>` | Max dependency traversal depth | `5` |
| `-f, --filter <glob>` | Custom glob to identify test files | auto-detect |
| `-j, --json` | Output as JSON | `false` |
| `-q, --quiet` | Output file paths only, no decoration | `false` |
| `-p, --path <path>` | Project path | auto-detect |

**How it works:**

1. For each changed file, BFS-traverses its transitive dependents (files that import from it, directly or indirectly)
2. Filters results to test files using common conventions (`*.spec.*`, `*.test.*`, `e2e/`, `tests/`, `__tests__/`) or a custom `--filter` glob
3. Changed files that are themselves test files are always included

**Example: CI/hook integration**

```bash
#!/usr/bin/env bash
# In a pre-commit hook or CI step:
AFFECTED=$(git diff --name-only HEAD | codegraph affected --stdin --quiet)
if [ -n "$AFFECTED" ]; then
  echo "Running affected tests..."
  npx vitest run $AFFECTED
fi
```

### `codegraph serve`

Start CodeGraph as an MCP server for AI assistants.

```bash
codegraph serve                          # Show MCP configuration help
codegraph serve --mcp                    # Start MCP server (stdio)
codegraph serve --mcp --path /project    # Specify project path
```

## 🔌 MCP Tools Reference

When running as an MCP server, CodeGraph exposes these tools to AI assistants. **These tools are designed to be used by Claude's Explore agents** for faster, more efficient codebase exploration.

### `codegraph_context`

Build context for a specific task. Good for focused queries.

```
codegraph_context(task: "fix checkout validation bug", maxNodes: 20)
```

### `codegraph_search`

Quick symbol search by name. Returns locations only.

```
codegraph_search(query: "UserService", kind: "class", limit: 10)
```

### `codegraph_callers` / `codegraph_callees`

Find what calls a function, or what a function calls.

```
codegraph_callers(symbol: "validatePayment", limit: 20)
codegraph_callees(symbol: "processOrder", limit: 20)
```

### `codegraph_impact`

Analyze what code would be affected by changing a symbol.

```
codegraph_impact(symbol: "UserService", depth: 2)
```

### `codegraph_node`

Get details about a specific symbol. Use `includeCode: true` only when needed.

```
codegraph_node(symbol: "authenticate", includeCode: true)
```

### `codegraph_files`

Get the project file structure from the index. Faster than filesystem scanning.

```
codegraph_files(path: "src/components", format: "tree", includeMetadata: true)
```

### `codegraph_status`

Check index health and statistics.

### How It Works With Claude Code

Claude's **Explore agents** use these tools instead of grep/glob/Read for faster exploration:

| Without CodeGraph | With CodeGraph | Benefit |
|-------------------|----------------|---------|
| `grep -r "auth"` | `codegraph_search("auth")` | Instant symbol lookup |
| Multiple `Read` calls | `codegraph_context(task)` | Related code in one call |
| Manual file tracing | `codegraph_callers/callees` | Call graph traversal |
| Guessing impact | `codegraph_impact(symbol)` | Know what breaks |
| `Glob`/`find` scanning | `codegraph_files(path)` | Indexed file structure |

This gives Explore agents **~94% fewer tool calls** and **~77% faster exploration** while producing equally thorough answers.

## 📚 Library Usage

CodeGraph can also be used as a library in your Node.js applications:

```typescript
import CodeGraph from '@colbymchenry/codegraph';

// Initialize a new project
const cg = await CodeGraph.init('/path/to/project');

// Or open an existing one
const cg = await CodeGraph.open('/path/to/project');

// Index with progress callback
await cg.indexAll({
  onProgress: (progress) => {
    console.log(`${progress.phase}: ${progress.current}/${progress.total}`);
  }
});

// Search for symbols
const results = cg.searchNodes('UserService');

// Get callers of a function
const node = results[0].node;
const callers = cg.getCallers(node.id);

// Build context for a task
const context = await cg.buildContext('fix login bug', {
  maxNodes: 20,
  includeCode: true,
  format: 'markdown'
});

// Get impact radius
const impact = cg.getImpactRadius(node.id, 2);

// Sync changes
const syncResult = await cg.sync();

// Clean up
cg.close();
```

## ⚙️ How It Works

### 1. Extraction

CodeGraph uses [tree-sitter](https://tree-sitter.github.io/) to parse source code into ASTs. Language-specific queries (`.scm` files) extract:

- **Nodes**: Functions, methods, classes, interfaces, types, variables
- **Edges**: Calls, imports, extends, implements, returns_type

Each node gets a unique ID based on its kind, file path, name, and line number.

### 2. Storage

All data is stored in a local SQLite database (`.codegraph/codegraph.db`):

- **nodes** table: All code entities with metadata
- **edges** table: Relationships between nodes
- **files** table: File tracking for incremental updates
- **unresolved_refs** table: References pending resolution
- **vectors** table: Embeddings stored as BLOBs for semantic search
- **nodes_fts**: FTS5 virtual table for full-text search
- **schema_versions** table: Schema version tracking
- **project_metadata** table: Project-level key-value metadata

### 3. Reference Resolution

After extraction, CodeGraph resolves references:

1. Match function calls to function definitions
2. Resolve imports to their source files
3. Link class inheritance and interface implementations
4. Apply framework-specific patterns (Express routes, etc.)

### 4. Semantic Search

CodeGraph uses local embeddings (via [@xenova/transformers](https://github.com/xenova/transformers.js)) to enable semantic search:

1. Code symbols are embedded using a transformer model
2. Queries are embedded and compared using cosine similarity
3. Results are ranked by relevance

### 5. Graph Queries

The graph structure enables powerful queries:

- **Callers/Callees**: Direct call relationships
- **Impact Radius**: BFS traversal to find all potentially affected code
- **Dependencies**: What a symbol depends on
- **Dependents**: What depends on a symbol

### 6. Context Building

When you request context for a task:

1. Semantic search finds relevant entry points
2. Graph traversal expands to related code
3. Code snippets are extracted
4. Results are formatted for AI consumption

## ⚙️ Configuration

The `.codegraph/config.json` file controls indexing behavior:

```json
{
  "version": 1,
  "languages": ["typescript", "javascript"],
  "exclude": [
    "node_modules/**",
    "dist/**",
    "build/**",
    "*.min.js"
  ],
  "frameworks": [],
  "maxFileSize": 1048576,
  "extractDocstrings": true,
  "trackCallSites": true
}
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `languages` | Languages to index (auto-detected if empty) | `[]` |
| `exclude` | Glob patterns to ignore | `["node_modules/**", ...]` |
| `frameworks` | Framework hints for better resolution | `[]` |
| `maxFileSize` | Skip files larger than this (bytes) | `1048576` (1MB) |
| `extractDocstrings` | Whether to extract docstrings from code | `true` |
| `trackCallSites` | Whether to track call site locations | `true` |

## 🌐 Supported Languages

| Language | Extension | Status |
|----------|-----------|--------|
| TypeScript | `.ts`, `.tsx` | Full support |
| JavaScript | `.js`, `.jsx`, `.mjs` | Full support |
| Python | `.py` | Full support |
| Go | `.go` | Full support |
| Rust | `.rs` | Full support |
| Java | `.java` | Full support |
| C# | `.cs` | Full support |
| PHP | `.php` | Full support |
| Ruby | `.rb` | Full support |
| C | `.c`, `.h` | Full support |
| C++ | `.cpp`, `.hpp`, `.cc` | Full support |
| Swift | `.swift` | Basic support |
| Kotlin | `.kt`, `.kts` | Basic support |
| Dart | `.dart` | Full support |
| Svelte | `.svelte` | Full support (script extraction, Svelte 5 runes, SvelteKit routes) |
| Liquid | `.liquid` | Full support |
| Pascal / Delphi | `.pas`, `.dpr`, `.dpk`, `.lpr` | Full support (classes, records, interfaces, enums, DFM/FMX form files) |

## 🔧 Troubleshooting

### "CodeGraph not initialized"

Run `codegraph init` in your project directory first.

### Indexing is slow

- Check if `node_modules` or other large directories are excluded
- Use `--quiet` flag to reduce console output overhead
- Consider increasing `maxFileSize` if you have large files to skip

### MCP server not connecting

1. Ensure the project is initialized and indexed
2. Check the path in your MCP configuration is correct
3. Verify `codegraph serve --mcp` works from the command line
4. Check Claude Code logs for connection errors

### Missing symbols in search

- Run `codegraph sync` to pick up recent changes
- Check if the file's language is supported
- Verify the file isn't excluded by config patterns

## 📄 License

MIT

---

<div align="center">

**Made for the Claude Code community** 🤖

[Report Bug](https://github.com/colbymchenry/codegraph/issues) · [Request Feature](https://github.com/colbymchenry/codegraph/issues)

</div>
