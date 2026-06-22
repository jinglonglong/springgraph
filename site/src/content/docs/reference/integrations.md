---
title: Integrations
description: Supported agents, and manual MCP setup.
---

The interactive installer auto-detects and configures each supported agent — wiring up the MCP server and writing its instructions file.

## Supported agents

- **Claude Code**
- **Cursor**
- **Codex CLI**
- **opencode**
- **Hermes Agent**
- **Gemini CLI**
- **Antigravity IDE**
- **Kiro**

Run `npx @colbymchenry/springgraph` and pick your agent(s); see [Installation](/springgraph/getting-started/installation/) for the non-interactive flags.

## Manual setup

If you'd rather wire it up yourself, install globally:

```bash
npm install -g @colbymchenry/springgraph
```

Add the MCP server to `~/.claude.json`:

```json
{
  "mcpServers": {
    "springgraph": {
      "type": "stdio",
      "command": "springgraph",
      "args": ["serve", "--mcp"]
    }
  }
}
```

Optionally auto-allow the read-only tools in `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "mcp__springgraph__springgraph_search",
      "mcp__springgraph__springgraph_callers",
      "mcp__springgraph__springgraph_callees",
      "mcp__springgraph__springgraph_impact",
      "mcp__springgraph__springgraph_node",
      "mcp__springgraph__springgraph_status",
      "mcp__springgraph__springgraph_files"
    ]
  }
}
```

:::tip
Cursor launches MCP subprocesses with the wrong working directory. The installer handles this for you by injecting a `--path` argument; if you wire Cursor up by hand, pass the project path explicitly.
:::
