# Troubleshooting

> Common problems when running Springgraph on a real Spring Cloud project,
> with concrete workarounds. If your issue isn't here, run
> `springgraph status` and attach the output to a new issue.

---

## 1. `springgraph web` opens but the graph is empty

**Symptom:** the Web UI loads at `http://127.0.0.1:4000`, but there are no
nodes, or only a handful, or only `file` nodes with no Spring symbols.

**Cause:** the Spring semantic layer (`springkg.db`) hasn't been built for
this project.

**Fix:**

```bash
# 1. From the project root, run
springgraph init -i

# 2. Re-open the Web UI
springgraph web
```

`init -i` walks the source tree once, builds the generic code graph in
`.springgraph/springkg.db`, and seeds the Spring semantic layer on top.
Until that runs, there's no Spring data for the Web UI to display.

---

## 2. `springgraph init -i` says it found 0 controllers / mappers / FeignClients

**Symptom:** the init summary prints lines like `Found 0 @FeignClient
interfaces` even though your project clearly has them.

**Cause:** the project doesn't follow the standard Maven / Gradle layout
that Springgraph expects. Common cases:

- Multi-module Maven project where each module has its own `pom.xml`
  but the source tree's root pom isn't a Spring Boot parent.
- Custom source roots: `src/main/kotlin/...` (Kotlin only) without Java.
- `application*.yml` lives outside `src/main/resources`.

**Fix:**

```bash
# Check the raw counts — these are independent of the Spring layer
springgraph status

# If the file count looks right but the Spring layer sees nothing,
# open an issue and attach:
#   - the project layout (pom.xml + first 2 levels of src/)
#   - `springgraph status` output
#   - 1 example of each unparsed annotation
```

---

## 3. `node` / `npm` version errors

**Symptom:**

```
npm error EBADENGINE Unsupported engine
```

or

```
Error: The module '...node_sqlite3.node' was compiled against a different Node.js version
```

**Cause:** Node version outside the supported range, or a native module
compiled for a different Node major.

**Fix:**

- Springgraph requires **Node 20.x or 22.x LTS** (`engines.node` in
  `package.json`). Node 18, Node 23, and Node 25+ are not supported.
- After switching Node versions, always `rm -rf node_modules && npm ci`
  to recompile native modules (`better-sqlite3`, `tree-sitter-wasms`)
  for the new runtime.

```bash
# macOS / Linux with nvm
nvm install 22
nvm use 22
rm -rf node_modules
npm ci
```

```powershell
# Windows with nvm-windows
nvm install 22.11.0
nvm use 22.11.0
Remove-Item -Recurse -Force node_modules
npm ci
```

---

## 4. SQLite errors on Windows

**Symptom:**

```
SQLITE_BUSY: database is locked
```

or `EPERM` errors when removing `.springgraph/` after a run.

**Cause:** the SQLite file is still open by a long-lived process (a
running `serve --mcp` daemon, the Web UI process, or a file-watcher's
worker).

**Fix:**

```powershell
# 1. Stop any running springgraph process
springgraph daemon stop
# or close the Web UI / MCP server tab

# 2. Wait a second, then retry
Remove-Item -Recurse -Force .springgraph
springgraph init -i
```

If the error persists, check Task Manager for any orphaned
`node.exe` processes spawned by Springgraph and end them, then retry.

---

## 5. The Web UI port (4000) is already in use

**Symptom:** `springgraph web` exits with `EADDRINUSE: address already
in use :::4000`.

**Fix:**

```bash
# 1. Find what's holding the port
lsof -i :4000          # macOS / Linux
netstat -ano | findstr :4000   # Windows

# 2. Either stop the conflicting process, or pick a different port
SPRINGGRAPH_WEB_PORT=4100 springgraph web
```

---

## 6. AI Agent doesn't see the `springgraph_*` tools

**Symptom:** the agent (Claude Code / Cursor / Codex / OpenCode) loads,
but the `spring_find_entry` / `spring_trace_flow` etc. tools don't show
up in its tool list.

**Cause:** the MCP server isn't connected, or the agent config wasn't
written by `springgraph install`.

**Fix:**

```bash
# 1. Re-run the installer
springgraph install -y

# 2. Check the config file was actually updated
# Claude Code:   ~/.claude.json   (or .mcp.json in the project)
# Cursor:        ~/.cursor/mcp.json
# Codex CLI:     ~/.codex/config.toml
# opencode:      opencode.jsonc  (project) or ~/.config/opencode/opencode.jsonc (global)

# 3. Restart the agent — most agents cache the tool list at startup
```

If the config has a `springgraph` entry but the tools still don't appear,
the MCP server is failing to start. Run `springgraph serve --mcp` in a
terminal and watch the output; the most common cause is a bad `.springgraph/`
state, fixed by `springgraph init -i`.

---

## 7. Large project index takes forever / OOMs

**Symptom:** `springgraph init -i` runs for many minutes, hits the
default memory budget, and crashes — or it just hangs on a 50k+ file
project.

**Fix:** tune the parallel init knobs (added in 1.0.2):

```bash
# 8 threads (default is min(cpuCount, 8))
springgraph init -i --threads 8

# Cap worker memory at 2 GB each, total heap at 6 GB
springgraph init -i --ram 6144 --worker-ram 2048

# Bump the per-file size cap if a single huge file is being skipped
springgraph init -i --size-limit 16   # MB

# In CI, force the legacy single-threaded path (deterministic, no SQLite contention)
SPRINGGRAPH_NO_PARALLEL_INIT=1 SPRINGGRAPH_NO_BATCH_WRITES=1 springgraph init -i
```

---

## 8. Files changed but the index is stale

**Symptom:** you edited `UserService.java`, but the AI Agent still sees
the old signature.

**Fix:**

```bash
# Force a re-index of the changed files only
springgraph sync

# Or rebuild from scratch
springgraph index -f
```

The file watcher (`springgraph watch`) usually catches edits within a
second; if it doesn't, check that your editor isn't writing to a
swap/temp file (vim, IntelliJ) that the watcher ignores on purpose.

---

## 9. MyBatis XML not linked to Mapper interfaces

**Symptom:** the graph shows `UserMapper` as a Java method, but the
`selectById` SQL doesn't appear in its callee list.

**Cause:** the XML namespace doesn't match the Java `Mapper`'s fully
qualified name. Springgraph links the two by `namespace="..."` only.

**Fix:** in the XML file's `<mapper namespace="...">`, use the *exact*
FQN of the Java interface:

```xml
<!-- UserMapper.xml -->
<mapper namespace="com.example.user.mapper.UserMapper">
  <select id="selectById" resultType="User">
    select * from users where id = #{id}
  </select>
</mapper>
```

If the namespace is correct but the link still doesn't appear, file an
issue with the XML file attached (the namespace and one method is enough).

---

## 10. Sensitive-config scanner flags every `application.yml`

**Symptom:** `spring_assets_overview` reports dozens of "sensitive" keys
including harmless ones.

**Cause:** the heuristic is intentionally aggressive (better to over-flag
than to miss a real `spring.datasource.password`).

**Fix:** treat the output as a *review list*, not a leak report. The
values are masked (`***`) in the tool response — the file paths and
keys are what you should triage.

---

## 11. `better-sqlite3` build fails on Apple Silicon / Linux ARM

**Symptom:** during `npm install`, the build fails with
`node-gyp` errors or "no prebuilt binary available".

**Fix:**

```bash
# 1. Install build tools
# macOS:
xcode-select --install
# Debian / Ubuntu:
sudo apt-get install -y build-essential python3

# 2. Reinstall
rm -rf node_modules
npm ci
```

---

## 12. `springgraph install` modifies my agent config and I don't want it to

**Symptom:** you ran `springgraph install` once, it worked, but later
runs make the diff noisy.

**Cause:** `install` is idempotent and self-heals — every run re-writes
the MCP block to match the current version, which always shows up as
a diff.

**Fix:** this is by design. If you're scripting it, just `git diff
<agent-config>` after the run and commit the expected change. There
is no `--no-rewrite` flag because the whole point of `install` is to
keep the MCP block in sync.

---

## Still stuck?

1. `springgraph status` — paste the full output
2. `springgraph --version` — confirm the version
3. The relevant section of `springgraph init -i` log (if init failed)
4. The OS, Node version, and the project type (single-module / multi-module Maven / Gradle)

Open a new issue with the above:
<https://github.com/jinglonglong/springgraph/issues/new/choose>

If the parsing is wrong on a real project (e.g. "my FeignClient wasn't
linked to the controller that calls it"), use the
"**Spring project parsing issue**" template — it asks for the
specifics the maintainers need.
