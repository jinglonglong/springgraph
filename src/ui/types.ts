/**
 * Messages from main thread to shimmer worker.
 *
 * `add-phase` / `update-phase` / `complete-phase` are the modern multi-stage
 * API. `update-workers` attaches per-worker sub-bars under a phase header so
 * multi-threaded stages (e.g. parallel resolve) show N independent progress
 * bars. `legacy-update` keeps backward compatibility with the old single-bar
 * `onProgress({ phase, current, total })` calls.
 */
export type ShimmerWorkerMessage =
  | { type: 'add-phase'; id: string; label: string; description?: string }
  | { type: 'start-phase'; id: string }
  | { type: 'update-phase'; id: string; current: number; total: number; detail?: string }
  | { type: 'complete-phase'; id: string }
  | { type: 'update-workers'; phaseId: string; workers: WorkerProgressMsg[] }
  | { type: 'legacy-update'; phase: string; label: string; description?: string; current: number; total: number }
  | { type: 'stop' };

/**
 * Per-worker progress entry sent via `update-workers`. One bar per worker is
 * rendered directly under the phase header, indented to suggest a tree.
 */
export interface WorkerProgressMsg {
  id: number;
  current: number;
  total: number;
}

/** Messages from worker to main thread */
export type ShimmerMainMessage =
  | { type: 'stopped' };
