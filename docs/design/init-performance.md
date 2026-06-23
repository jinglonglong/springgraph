# Init performance

> Spec: `openspec/changes/optimize-initialization-performance/`
> Status: phases 1.1–3a + 6 (parity) + 7 (changelog) landed on
> `feature/v1.0.2`. Phases 3b (git-native enumeration), 4 (RSS
> recycling), 5 (abort + progress) are scoped but not yet built.

## Problem

`springgraph init` on a large Spring Cloud project was the gating
step for every other value the tool delivers: the agent can't
search, trace, or impact-analyze an index that hasn't been built
yet. The pipeline had three independent costs stacking on top of
each other:

1. **Single parse worker** — exactly one `worker_threads` worker
   parsed files sequentially, so on an 8-core box 7/8 of the CPU
   sat idle during the parse phase.
2. **Per-file DB transactions** — every file issued ~4
   `BEGIN`/`COMMIT` pairs (nodes, edges, unresolved refs, file
   row). On 10k files that's ~40k transactions for the cost of
   maybe 100.
3. **Re-parse unchanged files** — re-running `init` / `index` /
   `sync` on an unchanged tree re-parsed every file even when its
   content was byte-identical to what was already in the index.

Each cost is independent; fixing all three stacks.

## What landed

### Tunables infrastructure (phase 1.1–1.3, plumbing only)

- `InitTunables` interface in `src/types.ts` (8 fields, all
  optional, with host-derived defaults).
- `resolveInitTunables()` pure helper in `src/init/tunables.ts`
  with CLI-flag > `SPRINGGRAPH_*` env > default precedence.
- 8 new flags on `springgraph init` and `springgraph index` via a
  shared `applyInitTunablesOptions()` helper.
- Schema v7 migration: `files.cheap_hash` + `files.blob_oid`
  columns, `idx_files_cheap_hash` index. Backfills `cheap_hash`
  from `content_hash` on existing rows.

Pure plumbing: the tunables are plumbed end-to-end and persisted
in the DB schema, but no consumer reads them yet.

### Parse worker pool (phase 1.4–1.5)

- `ParseWorkerPool` in `src/extraction/parse-pool.ts`: owns N
  `worker_threads` workers, round-robin dispatch, bounded
  backpressure, worker crash recovery (respawn + re-queue the
  in-flight file), `drain()` `AsyncIterable`, `abort()`, `close()`.
- The orchestrator's main loop branches on the pool: when a pool
  is in use, every file in a batch is submitted to the pool, then
  results are drained out-of-order. The legacy single-worker path
  is preserved under `SPRINGGRAPH_NO_PARALLEL_INIT=1` for tests
  and constrained environments.
- The per-file `requestParse` abort path was kept for the
  legacy path; the pool handles its own `abort()`.

### Batched DB writes (phase 2)

- `BatchStore` in `src/db/batch-store.ts`: buffers nodes /
  edges / unresolved refs / file rows across N files and
  commits them in batched transactions instead of one per file.
  Triggers: `--batch-size` files, `--batch-flush-ms` elapsed, or
  total placeholder count >= 30 000 (SQLite ceiling).
- `QueryBuilder.transaction<T>(fn): T` exposes the underlying
  transaction wrapper for callers that need cross-statement
  atomicity.
- The orchestrator's `processParseResult` routes through
  `BatchStore` when batching is enabled (default), falling back
  to the per-file `storeExtractionResult` when
  `SPRINGGRAPH_NO_BATCH_WRITES=1`.
- **Parity test**: `__tests__/init-batching-parity.test.ts`
  builds the same DB twice (per-file vs batched) and asserts
  the four tables are byte-for-byte identical.

### Two-tier content-hash skip (phase 3a)

- `src/util/hash.ts`: `cheapHash` (xxhash, falls back to
  crypto SHA-1), `strongHash` (SHA-256, byte-for-byte compatible
  with the extraction module's `hashContent`).
- `BatchStore.append` now does a two-tier skip: first compare
  the cheap hash against `files.cheap_hash`; if it matches,
  return immediately without computing SHA-256. If the cheap
  hash differs but the strong hash matches, also return (catches
  the rare non-cryptographic collision). Otherwise buffer as
  before. The file record now carries the cheap hash for the
  next init.

## Performance

Measured on a 102-file synthetic Spring Cloud fixture
(20 controllers, 20 services, 20 mappers + MyBatis XML, 5 Feign
clients, 15 entities, application.yml, pom.xml). The fixture is
small enough to be measurable in CI but representative of the
shape of a real Spring Cloud project.

| Path | Orchestrator time (durationMs) | Wall time | Notes |
|---|---|---|---|
| master baseline (1.0.1) | ~3 000 ms | ~3 300 ms | single worker, per-file tx |
| phase 1.1–1.3 (tunables plumbing) | ~3 000 ms | ~3 100 ms | no behavior change |
| phase 1.5 (pool) | ~3 000 ms | ~3 800 ms | 7-worker startup overhead dominates this fixture |
| phase 2 (BatchStore) | **~740 ms** | ~3 100 ms | 4× faster orchestrator time |
| phase 2 + 3a (re-init, unchanged tree) | n/a | **~1.8 s** | all files cheap-hash match, zero parse work |

The "wall time looks similar" effect for phase 2 is Node startup
+ 7-worker tree-sitter grammar compilation (~1.5 s of fixed cost
independent of file count). On larger projects the orchestrator
work dominates and the wall-time savings compound.

## Opt-out env vars

| Var | Effect |
|---|---|
| `SPRINGGRAPH_NO_PARALLEL_INIT=1` | Use the legacy single parse worker instead of the pool. |
| `SPRINGGRAPH_NO_BATCH_WRITES=1` | Use the per-file DB transaction path instead of `BatchStore`. |
| `SPRINGGRAPH_NO_GIT=1` | (phase 3b, not yet shipped) Invert the git-native file-walk auto-detect to "use the filesystem walk" even inside a work tree. |

All three are independent. The new path is the default; setting
the env var is the only way to opt out.

## CLI surface

```
springgraph init [path]
  --threads <n>            # 0 = auto (cpus-1, cap 8)
  --ram <mb>               # total init memory budget
  --batch-size <n>         # files per DB transaction
  --batch-flush-ms <ms>    # 0 disables the time trigger
  --size-limit <mb>        # per-file cap
  --worker-ram <mb>        # per-worker RSS budget (phase 4)
  --use-git                # (phase 3b) force git-native file walk
  --no-git                 # force filesystem walk
  --progress-interval-ms <ms>   # (phase 5) onProgress callback throttle

springgraph index [path]    # same flags
```

Every flag has a matching `SPRINGGRAPH_*` env var
(`SPRINGGRAPH_THREADS`, `SPRINGGRAPH_RAM`, `SPRINGGRAPH_BATCH_SIZE`,
`SPRINGGRAPH_BATCH_FLUSH_MS`, `SPRINGGRAPH_SIZE_LIMIT_MB`,
`SPRINGGRAPH_WORKER_RAM_MB`, `SPRINGGRAPH_NO_GIT=1`,
`SPRINGGRAPH_PROGRESS_MS`). Precedence is CLI flag > env var >
host-derived default.

## Architecture diagram

```
files
  |
  v
ExtractionOrchestrator.indexAll(options)
  |
  +-- ParseWorkerPool (N workers, init-performance phase 1.4–1.5)
  |     |  submit(file) -> worker round-robin
  |     |  drain()     -> AsyncIterable<result>
  |
  +-- BatchStore (init-performance phase 2)
  |     |  append(file, content, lang, stats, result)
  |     |    |  cheapHash match? -> skip
  |     |    |  strongHash match? -> skip
  |     |    |  else buffer
  |     |  flush() on batch-size / batch-flush-ms / placeholders
  |     |    |  delete + insertNodes + insertEdges + insertRefs + upsertFile
  |     v  on transaction per category (SQLite disallows nesting)
  v
QueryBuilder.insert* -> .springgraph/springgraph.db (SQLite + FTS5)
```

## Not yet shipped (future work)

| Phase | What | Why deferred |
|---|---|---|
| 3b | `gitNativeEnumerate()` using `git ls-files` + `git cat-file --batch`; `--use-git` / `--no-git` CLI wiring | Awaiting the cheap-hash skip to land first; the file walk itself isn't the dominant cost on the 102-file fixture. |
| 4 | RSS-based worker recycling (`--worker-ram` already plumbed in `InitTunables`); `worker.unref()` so idle workers don't block process exit | The fixed `WORKER_RECYCLE_INTERVAL = 250` is fine for the fixture. Useful only for very long init runs. |
| 5 | `AbortSignal` in `Springgraph.init` / `indexAll`; throttled `onProgress` callback; one-line init summary (`status=ok duration=… files=… peakRss=… workers=… mode=…`) | UX work; the existing `setTimeout`-based abort in the main loop already works in practice. |
| 6 (remaining) | Cross-platform validation (Linux Docker, Windows Parallels VM per CLAUDE.md) | The change touches `worker_threads` (Linux/macOS fine, Windows quirks) and a new DB column; needs the project's cross-platform gate before release. |

## Validation

- 372 extraction tests pass (`__tests__/extraction.test.ts`).
- 4 BatchStore parity tests pass
  (`__tests__/init-batching-parity.test.ts`).
- 10 migration tests pass (`__tests__/init-migrations.test.ts`).
- 45 tunables tests pass (`__tests__/init-tunables.test.ts`).
- 100/101 tests across the four `init-*` test files (1 skipped on
  machines without the `node:sqlite` binding).
- Manual bench on the 102-file fixture (3 runs, fixture re-run
  between each): output identical, 4× orchestrator time, ~1.8 s
  re-init on unchanged tree.

## Open questions

- The cheap-hash algorithm defaults to `xxhashjs` (not in
  `package.json`). Should it become a direct dependency, or do
  we keep the SHA-1 fallback? 1.4× faster on the hot path, but
  adds a dep and a build step.
- The `gitNativeEnumerate` opt-out semantics: `--no-git` should
  force the filesystem walk even inside a work tree, but what
  about `--use-git` outside one? Currently we treat "outside a
  work tree" as a hard error (the orchestrator can't use git
  there). The CLI wiring in phase 3b needs to surface that
  clearly.
- The bench uses a synthetic fixture. Per the CLAUDE.md
  validation methodology, the change should also be measured on
  at least one of the 7 README benchmark repos before tagging
  the release.
