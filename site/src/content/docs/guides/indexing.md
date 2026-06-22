---
title: Indexing a Project
description: Full index, incremental sync, and the file watcher.
---

## Initialize and index

```bash
cd your-project
springgraph init -i      # initialize + full index
```

`init` creates `.springgraph/`; `-i`/`--index` builds the index immediately. To initialize without indexing, drop the flag and run `springgraph index` later.

## Full vs. incremental

```bash
springgraph index           # full index of the whole project
springgraph index --force   # re-index from scratch
springgraph sync            # incremental — only changed files
```

`sync` is fast because it only reparses what changed. Use it after a branch switch or a batch of edits.

## Stay fresh automatically

**You don't need to run `springgraph sync` by hand during an agent session.** When your agent (Claude Code, Cursor, Codex, opencode, Hermes, Gemini, Antigravity, Kiro) launches `springgraph serve --mcp`, three layers cooperate to keep the index in step with your code — and to never give the agent a quiet wrong answer in the small window between an edit and the next sync.

### 1. File watcher with debounced auto-sync (always on)

`serve --mcp` spins up a native file watcher (FSEvents on macOS, inotify on Linux, ReadDirectoryChangesW on Windows) over the project root. Every source-file create / modify / delete is captured. A debounce timer collapses bursts of edits into a single sync.

```
agent writes src/Widget.ts
  → watcher fires (event delivery: typically <100ms)
  → 2000ms debounce
  → sync runs; Widget.ts's nodes + edges are in the index
  → next agent query sees it
```

**Tunable**: `SPRINGGRAPH_WATCH_DEBOUNCE_MS` overrides the default 2000ms, clamped to `[100ms, 60s]`. Useful when a build step or formatter writes many files in a tight burst — bump it to `5000` or `10000` so the watcher coalesces them into one sync.

### 2. Per-file staleness banner — covers the debounce window

The watcher debounce introduces a small window (typically 2s) where a freshly-edited file is on disk but not yet in the index. Springgraph closes that window with a per-file staleness banner: if any MCP tool response would reference a file that's currently pending re-index, the response prepends a `⚠️` banner naming the stale file:

```
⚠️ Some files referenced below were edited since the last index sync —
their springgraph entries may be stale:
  - src/Widget.ts (edited 800ms ago, pending sync)
For accurate content of those specific files, Read them directly.
The rest of this response is fresh.

## Code Context
…
```

Agents read this and follow up with a direct `Read` on the named file — validated end-to-end with Claude Code, where the agent literally says "Reading the file directly for the live content" before opening it. So even during the 2-second debounce window, the agent never gets a silent wrong answer.

Pending files **not** referenced by the response surface as a small footer instead (`(Note: N file(s) elsewhere in this project are pending index sync but were not referenced above: …)`). Either way, the signal is explicit.

### 3. Connect-time catch-up — covers gaps when the MCP server wasn't running

When your editor / agent (re)connects to the MCP server, springgraph runs a fast filesystem-based reconciliation (a `(size, mtime)` stat pre-filter, then a content hash on the rest) before answering the first query. So files changed while no MCP server was running — a `git pull` from the terminal, an edit from another editor, an agent that finished and exited — are caught up automatically on the next session's first tool call.

### Verify what the watcher sees

`springgraph_status` exposes the pending set first-class — useful for an agent asking "is the index caught up?" in one call:

```
springgraph_status →
  ## Springgraph Status
  …
  ### Pending sync:
  - src/Widget.ts (edited 1200ms ago)
```

If `### Pending sync:` isn't in the response, nothing is in flight.

### When manual `springgraph sync` makes sense

Almost never. The edge cases:

- **The watcher is disabled.** Sandboxes that block local fs watchers, or you've set `SPRINGGRAPH_NO_DAEMON=1` to opt out of the shared daemon. In those cases `springgraph sync` is the manual fallback.
- **Pre-flight before a CI run.** If you're scripting against the index outside an agent session, a single `springgraph sync` at the start of the script guarantees the index reflects the current working tree.

Otherwise: just use it. The watcher + banner + connect-sync covers the AI-assisted workflow end-to-end. If you're seeing files genuinely missed after the debounce window has passed, that's a bug — please file an issue with a reproduction.

> See the v0.9.5 release notes for the [staleness banner (#403)](https://github.com/colbymchenry/springgraph/releases/tag/v0.9.5) and the connect-time catch-up (#414); both shipped together.

## Check status

```bash
springgraph status
```

Reports node/edge/file counts, the active SQLite backend, and the journal mode. In an agent session, the MCP-side `springgraph_status` additionally surfaces the `### Pending sync:` block described above.

## What gets indexed

Every file whose extension maps to a [supported language](/springgraph/reference/languages/), minus dependency/build directories excluded by default (`node_modules`, `vendor`, `dist`, …), anything your `.gitignore` excludes, and files over 1 MB. See [Configuration](/springgraph/getting-started/configuration/).
