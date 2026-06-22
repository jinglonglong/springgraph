---
title: MCP Server
description: The tools Springgraph exposes to AI agents over MCP.
---

Springgraph runs as a [Model Context Protocol](https://modelcontextprotocol.io/) server. Start it with:

```bash
springgraph serve --mcp
```

Agents configured by the installer launch this automatically. When a `.springgraph/` index exists, the agent uses the tools below.

## Tools

| Tool | Purpose |
|---|---|
| `springgraph_search` | Find symbols by name across the codebase |
| `springgraph_callers` | Find what calls a function |
| `springgraph_callees` | Find what a function calls |
| `springgraph_impact` | Analyze what code is affected by changing a symbol |
| `springgraph_node` | Get details about a specific symbol (optionally with source code) |
| `springgraph_explore` | Return source for several related symbols grouped by file, plus a relationship map, in one call |
| `springgraph_files` | Get the indexed file structure (faster than filesystem scanning) |
| `springgraph_status` | Check index health and statistics |

## How agents should use it

Springgraph *is* the pre-built search index. For "how does X work?", architecture, trace, or where-is-X questions, an agent should answer in a handful of Springgraph calls and stop — typically with **zero file reads** — rather than re-deriving the answer with `grep` + `Read`. A direct Springgraph answer is a handful of calls; a grep/read exploration is dozens.

The installer writes this guidance into each agent's instructions file automatically.
