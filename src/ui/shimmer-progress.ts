/**
 * Shimmer Progress — multi-stage progress UI for the springgraph CLI.
 *
 * Each phase is registered up front with a Chinese label and an optional
 * description, then driven by per-phase updates. The worker renders one
 * line per phase simultaneously, so a multi-threaded resolve shows up
 * alongside the prior phase's finished bar instead of replacing it.
 *
 * The legacy `onProgress({ phase, current, total })` API still works and
 * auto-registers phases with default labels — that keeps existing call
 * sites compiling while the CLI migrates to the explicit API.
 */
import { fork } from 'child_process';
import * as path from 'path';

export interface IndexProgress {
  phase: string;
  current: number;
  total: number;
}

/** Default labels for the standard four phases, used by the legacy API. */
const LEGACY_PHASE_DEFAULTS: Record<string, { label: string; description: string }> = {
  scanning: { label: '扫描文件', description: '列出所有源文件' },
  parsing: { label: '解析代码', description: '多线程并行解析 AST' },
  storing: { label: '写入数据库', description: '批量提交节点和边' },
  resolving: { label: '解析引用', description: '并行解析未解引用' },
};

export interface WorkerProgressEntry {
  id: number;
  current: number;
  total: number;
}

export interface ShimmerProgress {
  /**
   * Register a phase up front so the worker can show it as pending until it
   * actually starts. Phases are displayed in the order they are registered.
   */
  addPhase(id: string, label: string, description?: string): void;
  /** Flip a phase to running. Optional — `updatePhase` does this lazily. */
  startPhase(id: string): void;
  /** Update progress for a phase. Auto-starts the phase if it was pending. */
  updatePhase(id: string, current: number, total: number, detail?: string): void;
  /** Mark a phase as done. Total is finalised to current if it was 0. */
  completePhase(id: string): void;
  /**
   * Attach N per-worker sub-bars under a phase header. Used by the parallel
   * resolve stage so the user can see each worker's progress independently
   * instead of one aggregate bar. Pass an empty list to remove sub-bars.
   */
  updateWorkers(phaseId: string, workers: WorkerProgressEntry[]): void;
  /**
   * Legacy API: single-bar mode. New phase ids implicitly mark any previous
   * running phase as done. Kept so old call sites keep working unchanged.
   */
  onProgress: (progress: IndexProgress) => void;
  stop: () => Promise<void>;
}

export function createShimmerProgress(): ShimmerProgress {
  const workerPath = path.join(__dirname, 'shimmer-worker.js');
  const startTime = Date.now();
  const worker = fork(workerPath, [], {
    stdio: ['pipe', 'inherit', 'inherit', 'ipc'],
    env: {
      ...process.env,
      SPRINGGRAPH_SHIMMER_START_TIME: String(startTime),
    },
  });

  const api: ShimmerProgress = {
    addPhase(id, label, description = '') {
      worker.send({ type: 'add-phase', id, label, description });
    },
    startPhase(id) {
      worker.send({ type: 'start-phase', id });
    },
    updatePhase(id, current, total, detail) {
      worker.send({ type: 'update-phase', id, current, total, detail });
    },
    completePhase(id) {
      worker.send({ type: 'complete-phase', id });
    },
    updateWorkers(phaseId, workers) {
      worker.send({ type: 'update-workers', phaseId, workers });
    },
    onProgress(progress) {
      const def =
        LEGACY_PHASE_DEFAULTS[progress.phase] ??
        { label: progress.phase, description: '' };
      worker.send({
        type: 'legacy-update',
        phase: progress.phase,
        label: def.label,
        description: def.description,
        current: progress.current,
        total: progress.total,
      });
    },
    stop() {
      return new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          worker.kill('SIGTERM');
          resolve();
        }, 2000);
        worker.on('message', (msg: { type: string }) => {
          if (msg.type === 'stopped') {
            clearTimeout(timeout);
            worker.kill('SIGTERM');
            setCurrentShimmerProgress(null);
            resolve();
          }
        });
        worker.send({ type: 'stop' });
      });
    },
  };
  setCurrentShimmerProgress(api);
  return api;
}

/**
 * Global handle to the most recently created ShimmerProgress, so internal
 * code paths (e.g. the parallel resolver) can push detail text like
 * "7 worker 并行解析中" without having to thread the object through
 * every public API. Set by `createShimmerProgress`, cleared by its
 * `stop()` (and by tests via `__resetShimmerProgressForTests`).
 */
let currentShimmerProgress: ShimmerProgress | null = null;
export function setCurrentShimmerProgress(p: ShimmerProgress | null): void {
  currentShimmerProgress = p;
}
export function getCurrentShimmerProgress(): ShimmerProgress | null {
  return currentShimmerProgress;
}
export function __resetShimmerProgressForTests(): void {
  currentShimmerProgress = null;
}
