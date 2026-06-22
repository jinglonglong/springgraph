---
title: Get Started
description: Get up and running with Springgraph in seconds.
---

Get up and running with Springgraph in seconds.

## No Node.js required — one command grabs the right build for your OS

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/colbymchenry/springgraph/main/install.sh | sh

# Windows (PowerShell)
irm https://raw.githubusercontent.com/colbymchenry/springgraph/main/install.ps1 | iex
```

## Already have Node? Use npm instead (works on any version)

```bash
npx @colbymchenry/springgraph        # zero-install, or:
npm i -g @colbymchenry/springgraph
```

Springgraph bundles its own runtime — nothing to compile, no native build, works the same everywhere. The interactive installer auto-configures your agent(s) — Claude Code, Cursor, Codex CLI, opencode, Hermes Agent, Gemini CLI, Antigravity IDE, Kiro.

## Initialize Projects

```bash
cd your-project
springgraph init -i
```

That's it — your agent will use Springgraph tools automatically when a `.springgraph/` directory exists.

Next: build [Your First Graph](/springgraph/getting-started/your-first-graph/), or see the full [Installation](/springgraph/getting-started/installation/) options.
