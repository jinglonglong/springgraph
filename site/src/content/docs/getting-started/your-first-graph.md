---
title: Your First Graph
description: Build an index and run your first queries against it.
---

Once Springgraph is installed, building and exploring a graph takes three commands.

## Index a project

```bash
cd your-project
springgraph init -i      # initialize + index in one step
```

`init` creates the `.springgraph/` directory; `-i` (or `--index`) immediately builds the full index. For an existing project you can re-index any time:

```bash
springgraph index          # full index
springgraph sync           # incremental update of changed files
```

## Check it worked

```bash
springgraph status
```

This reports the node/edge/file counts, the active SQLite backend, and the journal mode — a quick health check that the index is ready.

## Run a query

```bash
springgraph query UserService          # find symbols by name
springgraph callers handleRequest      # what calls a function
springgraph callees handleRequest      # what a function calls
springgraph impact AuthMiddleware      # what a change would affect
springgraph context "fix the login flow"   # build task-focused context
```

Each accepts `--json` for machine-readable output. See the full [CLI reference](/springgraph/reference/cli/).

## Hand it to your agent

With a `.springgraph/` directory present and an agent configured (see [Installation](/springgraph/getting-started/installation/)), your agent uses the [MCP tools](/springgraph/reference/mcp-server/) automatically — no extra step.
