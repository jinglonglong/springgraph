---
title: CLI
description: Every Springgraph command and the flags it accepts.
---

```bash
springgraph                         # Run interactive installer
springgraph install                 # Run installer (explicit)
springgraph uninstall               # Remove Springgraph from your agents (inverse of install)
springgraph init [path]             # Initialize in a project (--index to also index)
springgraph uninit [path]           # Remove Springgraph from a project (--force to skip prompt)
springgraph index [path]            # Full index (--force to re-index, --quiet for less output)
springgraph sync [path]             # Incremental update
springgraph status [path]           # Show statistics
springgraph query <search>          # Search symbols (--kind, --limit, --json)
springgraph files [path]            # Show file structure (--format, --filter, --max-depth, --json)
springgraph context <task>          # Build context for AI (--format, --max-nodes)
springgraph callers <symbol>        # Find what calls a function/method (--limit, --json)
springgraph callees <symbol>        # Find what a function/method calls (--limit, --json)
springgraph impact <symbol>         # Analyze what code is affected by changing a symbol (--depth, --json)
springgraph affected [files...]     # Find test files affected by changes
springgraph serve --mcp             # Start MCP server
```

## Query commands

`query`, `callers`, `callees`, and `impact` all accept `--json` for machine-readable output.

```bash
springgraph query UserService --kind class --limit 10
springgraph callers handleRequest --json
springgraph impact AuthMiddleware --depth 3
```

## affected

Traces import dependencies transitively to find which test files are affected by changed source files. See [Affected Tests in CI](/springgraph/guides/affected-tests/) for options and a CI example.
