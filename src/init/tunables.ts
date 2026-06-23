/**
 * Init tunables — the single source of truth for resolving the
 * performance knobs exposed by `init` and `index` (init-performance
 * change, phase 1).
 *
 * Precedence (highest to lowest):
 *   1. Explicit CLI flag (passed via `rawInput`).
 *   2. `SPRINGGRAPH_*` environment variable (read from `env`).
 *   3. Host-derived default (computed from `host`).
 *
 * The helper is pure — it takes `rawInput`, `env`, and `host` as
 * parameters instead of reading `process.env` / `os` directly — so
 * unit tests can exercise every precedence rule without spawning a
 * child process. The CLI calls the helper with the real env and host.
 *
 * Later phases (parallel-parse-pipeline, bulk-db-writes,
 * git-native-enumeration, worker-pool-persistence) read the resolved
 * tunables to size the worker pool, batch the SQLite writes, and
 * prefer git-native file enumeration. Until those phases land, the
 * resolved tunables are accepted but unused on the hot path.
 */

import * as os from 'os';
import type { InitTunables } from '../types';

/**
 * The shape the CLI collects before calling the resolver. Each field
 * is the raw string from `commander` (or `undefined` if the flag was
 * not passed). The resolver parses and validates every value.
 *
 * `useGit` and `noGit` are kept as separate booleans so the CLI can
 * reject `--use-git --no-git` combinations up front (commander
 * reports the conflict before the helper sees it).
 */
export interface RawInitTunables {
  threads?: string;
  ram?: string;
  batchSize?: string;
  batchFlushMs?: string;
  sizeLimitMb?: string;
  workerRamMb?: string;
  /** `--use-git` flag passed */
  useGit?: boolean;
  /** `--no-git` flag passed */
  noGit?: boolean;
  progressIntervalMs?: string;
}

/**
 * Subset of `os` we need. Injected so unit tests can pass a stub.
 */
export interface HostInfo {
  cpus: number;
  totalMemBytes: number;
}

/**
 * Default `os.cpus().length` and `os.totalmem()` for production callers.
 * Exported so callers don't have to reach into `os` themselves.
 */
export function readHostInfo(): HostInfo {
  return {
    cpus: os.cpus().length,
    totalMemBytes: os.totalmem(),
  };
}

// =============================================================================
// Environment variable names
// =============================================================================

const ENV_THREADS = 'SPRINGGRAPH_THREADS';
const ENV_RAM = 'SPRINGGRAPH_RAM';
const ENV_BATCH_SIZE = 'SPRINGGRAPH_BATCH_SIZE';
const ENV_BATCH_FLUSH_MS = 'SPRINGGRAPH_BATCH_FLUSH_MS';
const ENV_SIZE_LIMIT_MB = 'SPRINGGRAPH_SIZE_LIMIT_MB';
const ENV_WORKER_RAM_MB = 'SPRINGGRAPH_WORKER_RAM_MB';
const ENV_NO_GIT = 'SPRINGGRAPH_NO_GIT';
const ENV_PROGRESS_MS = 'SPRINGGRAPH_PROGRESS_MS';

// =============================================================================
// Host-derived defaults
// =============================================================================

/**
 * Default thread count: `max(1, min(8, cpus - 1))`. The `- 1` keeps one
 * core free for the main thread and SQLite writer; the `8` cap avoids
 * pathological cases on a 64-core box where the per-worker overhead
 * would dominate.
 */
export function defaultThreads(cpus: number): number {
  if (!Number.isFinite(cpus) || cpus <= 1) return 1;
  return Math.max(1, Math.min(8, cpus - 1));
}

/**
 * Default memory budget: `min(4096, max(1024, floor(totalmem / (1024^2 * 4))))`.
 * Floor of 1 GB and ceiling of 4 GB keeps the SQLite cache from going
 * either negligible or absurd.
 */
export function defaultRamMb(totalMemBytes: number): number {
  const totalMb = Math.floor(totalMemBytes / (1024 * 1024));
  const quarterMb = Math.floor(totalMb / 4);
  return Math.max(1024, Math.min(4096, quarterMb));
}

/**
 * Default per-worker RSS budget: `min(2048, floor(ram / threads))`. The
 * `2048` cap keeps a single worker from claiming the whole budget on
 * a single-threaded host.
 */
export function defaultWorkerRamMb(ramMb: number, threads: number): number {
  const per = Math.floor(ramMb / Math.max(1, threads));
  return Math.min(2048, per);
}

// =============================================================================
// Parsing helpers (with explicit validation)
// =============================================================================

/**
 * Parse a positive integer string. Returns `null` if the value is
 * missing, not a finite integer, or non-positive. Surfaces a clear
 * error so the CLI can fail loud rather than silently fall back.
 */
function parsePositiveInt(
  value: string | undefined,
  fieldName: string,
  source: 'cli' | 'env' | 'default'
): number | null {
  if (value === undefined || value === '') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    throw new Error(
      `init tunables: ${fieldName} must be a positive integer (${source}: ${JSON.stringify(value)})`
    );
  }
  return parsed;
}

/**
 * Parse a non-negative integer string. Same as `parsePositiveInt` but
 * allows `0` (the CLI's "auto" sentinel for threads).
 */
function parseNonNegativeInt(
  value: string | undefined,
  fieldName: string,
  source: 'cli' | 'env' | 'default'
): number | null {
  if (value === undefined || value === '') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      `init tunables: ${fieldName} must be a non-negative integer (${source}: ${JSON.stringify(value)})`
    );
  }
  return parsed;
}

function truthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

// =============================================================================
// The resolver
// =============================================================================

/**
 * Resolve the init tunables from a CLI raw input, an env object, and a
 * host-info stub. Every field is resolved in precedence order
 * (CLI > env > default). Throws on malformed CLI / env values so a
 * typo like `SPRINGGRAPH_THREADS=banana` fails loud instead of
 * silently falling back to a default.
 *
 * Pure: does not read `process.env` or `os` itself. Callers
 * (production CLI, tests) pass them in.
 */
export function resolveInitTunables(
  rawInput: RawInitTunables = {},
  env: NodeJS.ProcessEnv = process.env,
  host: HostInfo = readHostInfo()
): InitTunables {
  // threads: `0` is the "auto" sentinel (both CLI and env). A positive
  // value from CLI wins outright; otherwise an env positive value
  // wins; otherwise we compute the host default. We can't use `??`
  // here because `0` is a valid sentinel and would otherwise shadow
  // the fallback. parseNonNegativeInt accepts 0; the `> 0` checks
  // below filter the sentinel out of the precedence chain.
  const cliThreads = parseNonNegativeInt(rawInput.threads, 'threads', 'cli');
  const envThreads = parseNonNegativeInt(env[ENV_THREADS], 'threads', 'env');
  let threads: number;
  if (cliThreads !== null && cliThreads > 0) {
    threads = cliThreads;
  } else if (envThreads !== null && envThreads > 0) {
    threads = envThreads;
  } else {
    threads = defaultThreads(host.cpus);
  }

  // ram: required to be >= 1.
  const cliRam = parsePositiveInt(rawInput.ram, 'ram', 'cli');
  const envRam = parsePositiveInt(env[ENV_RAM], 'ram', 'env');
  const ramMb =
    cliRam ?? envRam ?? defaultRamMb(host.totalMemBytes);

  // batch-size: 1+ files.
  const cliBatchSize = parsePositiveInt(rawInput.batchSize, 'batchSize', 'cli');
  const envBatchSize = parsePositiveInt(env[ENV_BATCH_SIZE], 'batchSize', 'env');
  const batchSize = cliBatchSize ?? envBatchSize ?? 100;

  // batch-flush-ms: 0 means "never time-based flush"; we allow it
  // because the row-count and file-count triggers still bound the
  // transaction. Use parseNonNegativeInt to permit the corner case.
  const cliBatchFlushMs = parseNonNegativeInt(rawInput.batchFlushMs, 'batchFlushMs', 'cli');
  const envBatchFlushMs = parseNonNegativeInt(env[ENV_BATCH_FLUSH_MS], 'batchFlushMs', 'env');
  const batchFlushMs = cliBatchFlushMs ?? envBatchFlushMs ?? 250;

  // size-limit: 1+ MB.
  const cliSizeLimit = parsePositiveInt(rawInput.sizeLimitMb, 'sizeLimitMb', 'cli');
  const envSizeLimit = parsePositiveInt(env[ENV_SIZE_LIMIT_MB], 'sizeLimitMb', 'env');
  const sizeLimitMb = cliSizeLimit ?? envSizeLimit ?? 1;

  // worker-ram: 1+ MB.
  const cliWorkerRam = parsePositiveInt(rawInput.workerRamMb, 'workerRamMb', 'cli');
  const envWorkerRam = parsePositiveInt(env[ENV_WORKER_RAM_MB], 'workerRamMb', 'env');
  const workerRamMb =
    cliWorkerRam ?? envWorkerRam ?? defaultWorkerRamMb(ramMb, threads);

  // gitMode: CLI wins outright (a `--use-git`/`--no-git` on the
  // command line overrides any env), then env, then auto.
  let gitMode: InitTunables['gitMode'];
  if (rawInput.useGit === true && rawInput.noGit === true) {
    throw new Error('init tunables: --use-git and --no-git are mutually exclusive');
  } else if (rawInput.useGit === true) {
    gitMode = 'use';
  } else if (rawInput.noGit === true) {
    gitMode = 'no';
  } else if (truthyEnv(env[ENV_NO_GIT])) {
    // SPRINGGRAPH_NO_GIT=1 inverts the auto-detect (becomes 'no').
    gitMode = 'no';
  } else {
    gitMode = 'auto';
  }

  // progress-interval-ms: 0 disables the throttle (every result fires
  // the callback). Use parseNonNegativeInt.
  const cliProgressMs = parseNonNegativeInt(rawInput.progressIntervalMs, 'progressIntervalMs', 'cli');
  const envProgressMs = parseNonNegativeInt(env[ENV_PROGRESS_MS], 'progressIntervalMs', 'env');
  const progressIntervalMs = cliProgressMs ?? envProgressMs ?? 100;

  return {
    threads,
    ramMb,
    batchSize,
    batchFlushMs,
    sizeLimitMb,
    workerRamMb,
    gitMode,
    progressIntervalMs,
  };
}
