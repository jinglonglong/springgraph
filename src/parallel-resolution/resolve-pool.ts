/**
 * Resolve Worker Pool
 *
 * Owns N `worker_threads` instances that run `resolve-worker.ts`. The main
 * thread submits batches of `UnresolvedRef`s and receives back resolved refs,
 * unresolved refs, and deferred second-pass refs. The pool handles worker
 * startup, round-robin dispatch, crash recovery (respawn + re-queue in-flight),
 * and throttled aggregate progress reporting.
 *
 * Persistence stays on the main thread: the pool only returns `ResolvedRef[]`;
 * callers write edges and delete resolved refs from `unresolved_refs`.
 */

import { Worker } from 'worker_threads';
import * as fs from 'fs';
import * as path from 'path';
import type { UnresolvedRef, ResolvedRef, ResolutionResult } from '../resolution/types';
import { logWarn, logDebug } from '../errors';

export interface ResolveBatchResult {
  resolved: ResolvedRef[];
  unresolved: UnresolvedRef[];
  stats: ResolutionResult['stats'];
  deferredChainRefs: UnresolvedRef[];
  deferredThisMemberRefs: UnresolvedRef[];
  deferredSuperMemberRefs: UnresolvedRef[];
}

/**
 * Per-worker progress snapshot. `current` is the count of refs the worker
 * has resolved so far (completed batches + last in-flight batch progress).
 * `total` is the cumulative number of refs the pool has assigned to this
 * worker across every batch it has handled.
 */
export interface WorkerProgressSnapshot {
  id: number;
  current: number;
  total: number;
}

interface WorkerSlot {
  worker: Worker;
  ready: Promise<void>;
  inFlightBatchId: number | null;
  crashed: boolean;
}

interface QueuedBatch {
  batchId: number;
  refs: UnresolvedRef[];
  resolve: (result: ResolveBatchResult) => void;
  reject: (err: Error) => void;
  retries: number;
}

interface InFlightBatch {
  refs: UnresolvedRef[];
  resolve: (result: ResolveBatchResult) => void;
  reject: (err: Error) => void;
  retries: number;
  workerIdx: number;
}

interface WorkerStats {
  /** Cumulative refs assigned to this worker across every dispatched batch. */
  totalAssigned: number;
  /** Resolved refs from completed batches. */
  resolvedFromCompleted: number;
  /** Size of the in-flight batch, if any. */
  inflightSize: number;
  /** Last progress reported within the in-flight batch (refs processed). */
  inflightProgress: number;
}

export class ResolveWorkerPool {
  private slots: WorkerSlot[] = [];
  private queue: QueuedBatch[] = [];
  private inFlight = new Map<number, InFlightBatch>();
  private nextBatchId = 1;
  private closed = false;
  private aborted = false;
  private threads: number;
  private projectRoot: string;
  private dbPath: string;
  private frameworkNames: string[];
  private workerPath: string;

  // Progress aggregation state
  private onProgress?: (current: number, total: number) => void;
  private onWorkerProgress?: (workers: WorkerProgressSnapshot[]) => void;
  private totalSubmitted = 0;
  private resolvedCompleted = 0;
  private lastProgressAt = 0;
  private progressThrottleMs: number;

  // Per-worker state — keyed by slotIdx.
  private workerStats = new Map<number, WorkerStats>();

  /**
   * @param projectRoot - Absolute project root (passed to each worker)
   * @param dbPath - Absolute path to the SQLite database
   * @param threads - Number of worker threads (must be >= 1)
   * @param frameworkNames - Framework names detected for the project
   * @param onProgress - Optional aggregate progress callback
   * @param progressThrottleMs - Minimum ms between progress callbacks (default 100)
   * @param onWorkerProgress - Optional per-worker progress callback. Fired
   *   whenever a worker's resolved/total counts change, throttled by
   *   `progressThrottleMs` to avoid stuttering the UI.
   */
  constructor(
    projectRoot: string,
    dbPath: string,
    threads: number,
    frameworkNames: string[] = [],
    onProgress?: (current: number, total: number) => void,
    progressThrottleMs = 100,
    onWorkerProgress?: (workers: WorkerProgressSnapshot[]) => void
  ) {
    if (threads < 1) {
      throw new Error(`ResolveWorkerPool: threads must be >= 1 (got ${threads})`);
    }
    this.projectRoot = projectRoot;
    this.dbPath = dbPath;
    this.threads = threads;
    this.frameworkNames = frameworkNames;
    this.onProgress = onProgress;
    this.onWorkerProgress = onWorkerProgress;
    this.progressThrottleMs = progressThrottleMs;
    this.workerPath = this.resolveWorkerPath();

    for (let i = 0; i < threads; i++) {
      this.slots.push(this.spawnWorker(i));
      this.workerStats.set(i, {
        totalAssigned: 0,
        resolvedFromCompleted: 0,
        inflightSize: 0,
        inflightProgress: 0,
      });
    }
    logDebug(`ResolveWorkerPool: spawned ${threads} worker(s)`);
  }

  /**
   * Locate the compiled worker. When running from `dist/` the worker is
   * sibling to this file. When running from source (tests via vitest) it
   * lives under the `dist/` tree after a build.
   */
  private resolveWorkerPath(): string {
    const local = path.join(__dirname, 'resolve-worker.js');
    if (fs.existsSync(local)) return local;
    const fallback = path.join(__dirname, '..', '..', 'dist', 'parallel-resolution', 'resolve-worker.js');
    if (fs.existsSync(fallback)) return fallback;
    // Let the Worker constructor fail with a clear path if neither exists.
    return local;
  }

  /**
   * Wait until every worker has opened its DB connection, detected
   * frameworks, and warmed caches. Safe to call multiple times.
   */
  async start(): Promise<void> {
    await Promise.all(this.slots.map((s) => s.ready));
  }

  /**
   * Number of configured worker threads.
   */
  get threadCount(): number {
    return this.threads;
  }

  /**
   * Submit a batch of unresolved references. Returns a promise that resolves
   * when any worker finishes the batch. Batches are queued if all workers are
   * busy; the queue is drained as workers become free.
   */
  submitBatch(refs: UnresolvedRef[]): Promise<ResolveBatchResult> {
    if (this.closed) {
      return Promise.reject(new Error('ResolveWorkerPool: submitBatch() after close()'));
    }
    if (this.aborted) {
      return Promise.reject(new Error('ResolveWorkerPool: submitBatch() after abort()'));
    }
    if (refs.length === 0) {
      return Promise.resolve({
        resolved: [],
        unresolved: [],
        stats: { total: 0, resolved: 0, unresolved: 0, byMethod: {} },
        deferredChainRefs: [],
        deferredThisMemberRefs: [],
        deferredSuperMemberRefs: [],
      });
    }

    return new Promise<ResolveBatchResult>((resolve, reject) => {
      const batchId = this.nextBatchId++;
      this.totalSubmitted += refs.length;
      this.queue.push({ batchId, refs, resolve, reject, retries: 0 });
      this.pumpQueue();
    });
  }

  /**
   * Graceful shutdown. Waits for every in-flight batch to complete, then sends
   * `shutdown` to each worker and waits for `shutdown-ack`. After this returns
   * the pool is unusable.
   */
  async close(): Promise<void> {
    if (this.closed || this.aborted) return;
    this.closed = true;

    // Wait for in-flight work with a 60s safety net.
    const deadline = Date.now() + 60_000;
    while (this.inFlight.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }

    // Any remaining in-flight work is treated as failed.
    for (const [batchId, inflight] of this.inFlight) {
      inflight.reject(new Error(`ResolveWorkerPool: closed with batch ${batchId} in flight`));
    }
    this.inFlight.clear();

    // Reject queued work.
    while (this.queue.length > 0) {
      const batch = this.queue.shift()!;
      batch.reject(new Error('ResolveWorkerPool: closed before batch started'));
    }

    await Promise.all(
      this.slots.map((s) =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            s.worker.terminate().catch(() => {});
            resolve();
          }, 5_000);
          const ackHandler = (msg: { type: string }) => {
            if (msg.type === 'shutdown-ack') {
              s.worker.off('message', ackHandler);
              clearTimeout(timer);
              s.worker.terminate().catch(() => {});
              resolve();
            }
          };
          s.worker.on('message', ackHandler);
          s.worker.postMessage({ type: 'shutdown' });
        })
      )
    );
  }

  /**
   * Force shutdown. Terminates every worker immediately and rejects all
   * pending and in-flight batches. Use for cancellation, not normal shutdown.
   */
  abort(): void {
    if (this.aborted) return;
    this.aborted = true;

    for (const [, inflight] of this.inFlight) {
      inflight.reject(new Error('ResolveWorkerPool: aborted'));
    }
    this.inFlight.clear();

    for (const batch of this.queue) {
      batch.reject(new Error('ResolveWorkerPool: aborted'));
    }
    this.queue.length = 0;

    for (const s of this.slots) {
      s.inFlightBatchId = null;
      s.worker.terminate().catch(() => {});
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: queueing and dispatch
  // ---------------------------------------------------------------------------

  private pumpQueue(): void {
    if (this.aborted || this.closed) return;
    while (this.queue.length > 0) {
      const freeIdx = this.findFreeWorker();
      if (freeIdx === -1) break;
      const batch = this.queue.shift()!;
      this.dispatchBatch(batch, freeIdx);
    }
  }

  private findFreeWorker(): number {
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i]!.inFlightBatchId === null) return i;
    }
    return -1;
  }

  private dispatchBatch(batch: QueuedBatch, workerIdx: number): void {
    const slot = this.slots[workerIdx]!;
    slot.inFlightBatchId = batch.batchId;
    this.inFlight.set(batch.batchId, {
      refs: batch.refs,
      resolve: batch.resolve,
      reject: batch.reject,
      retries: batch.retries,
      workerIdx,
    });
    // Track per-worker assignment so the UI can show "worker N: X/Y".
    const stats = this.workerStats.get(workerIdx);
    if (stats) {
      stats.totalAssigned += batch.refs.length;
      stats.inflightSize = batch.refs.length;
      stats.inflightProgress = 0;
    }
    slot.worker.postMessage({
      type: 'resolve-batch',
      batchId: batch.batchId,
      refs: batch.refs,
    });
  }

  // ---------------------------------------------------------------------------
  // Internal: worker lifecycle
  // ---------------------------------------------------------------------------

  private spawnWorker(idx: number): WorkerSlot {
    const worker = new Worker(this.workerPath, {
      workerData: {
        projectRoot: this.projectRoot,
        dbPath: this.dbPath,
        frameworkNames: this.frameworkNames,
      },
    });
    worker.unref();

    let readyResolve!: () => void;
    const ready = new Promise<void>((resolve) => {
      readyResolve = resolve;
    });

    const slot: WorkerSlot = {
      worker,
      ready,
      inFlightBatchId: null,
      crashed: false,
    };

    worker.on('message', (msg: { type: string; batchId?: number; result?: ResolveBatchResult; error?: string; current?: number; total?: number }) => {
      this.onMessage(slot, idx, msg);
    });
    worker.on('error', (err: Error) => {
      this.onWorkerError(slot, idx, err);
    });
    worker.on('exit', (code: number) => {
      this.onWorkerExit(slot, idx, code);
    });

    const readyHandler = (msg: { type: string }) => {
      if (msg.type === 'init-done') {
        worker.off('message', readyHandler);
        readyResolve();
      }
    };
    worker.on('message', readyHandler);
    worker.postMessage({ type: 'init' });

    return slot;
  }

  private onMessage(
    slot: WorkerSlot,
    slotIdx: number,
    msg: { type: string; batchId?: number; result?: ResolveBatchResult; error?: string; current?: number; total?: number }
  ): void {
    if (msg.type === 'init-done') return;

    if (msg.type === 'progress' && msg.current !== undefined && msg.total !== undefined) {
      const stats = this.workerStats.get(slotIdx);
      if (stats) {
        // msg.current is refs processed within this in-flight batch.
        stats.inflightProgress = msg.current;
      }
      this.emitProgress();
      return;
    }

    if (msg.type === 'resolve-batch-result' && msg.batchId !== undefined) {
      const inflight = this.inFlight.get(msg.batchId);
      if (!inflight) return; // late result after crash/close
      this.inFlight.delete(msg.batchId);
      slot.inFlightBatchId = null;
      const resolvedInBatch = msg.result?.stats.resolved ?? 0;
      this.resolvedCompleted += resolvedInBatch;
      // Roll the in-flight progress into the completed bucket and clear it.
      const stats = this.workerStats.get(slotIdx);
      if (stats) {
        stats.resolvedFromCompleted += resolvedInBatch;
        stats.inflightSize = 0;
        stats.inflightProgress = 0;
      }
      this.emitProgress();
      inflight.resolve(msg.result!);
      this.pumpQueue();
      return;
    }

    if (msg.type === 'resolve-batch-error' && msg.batchId !== undefined) {
      const inflight = this.inFlight.get(msg.batchId);
      if (!inflight) return;
      this.inFlight.delete(msg.batchId);
      slot.inFlightBatchId = null;
      inflight.reject(new Error(msg.error || 'ResolveWorkerPool: batch failed'));
      this.pumpQueue();
      return;
    }

    if (msg.type === 'shutdown-ack') {
      // close() handles this via its once listener.
      return;
    }

    void slotIdx;
  }

  private onWorkerError(slot: WorkerSlot, slotIdx: number, err: Error): void {
    logWarn(`ResolveWorkerPool: worker ${slotIdx} error`, { error: err.message });
    this.handleWorkerDeath(slot, slotIdx, `worker error: ${err.message}`);
  }

  private onWorkerExit(slot: WorkerSlot, slotIdx: number, code: number): void {
    if (this.closed || this.aborted) return;
    if (code === 0) {
      this.handleWorkerDeath(slot, slotIdx, 'worker exited cleanly with code 0');
      return;
    }
    logWarn(`ResolveWorkerPool: worker ${slotIdx} exited with code ${code}`);
    this.handleWorkerDeath(slot, slotIdx, `worker exited with code ${code}`);
  }

  private handleWorkerDeath(slot: WorkerSlot, slotIdx: number, reason: string): void {
    // Recover the in-flight batch if there is one.
    if (slot.inFlightBatchId !== null) {
      const batchId = slot.inFlightBatchId;
      slot.inFlightBatchId = null;
      const inflight = this.inFlight.get(batchId);
      if (inflight) {
        this.inFlight.delete(batchId);
        if (inflight.retries < 2) {
          this.queue.unshift({
            batchId,
            refs: inflight.refs,
            resolve: inflight.resolve,
            reject: inflight.reject,
            retries: inflight.retries + 1,
          });
        } else {
          inflight.reject(new Error(`ResolveWorkerPool: ${reason} (retries exhausted)`));
        }
      }
    }

    if (this.closed || this.aborted) return;

    if (!slot.crashed) {
      logDebug(`ResolveWorkerPool: respawning worker ${slotIdx}`);
      slot.crashed = true;
    }
    const newSlot = this.spawnWorker(slotIdx);
    this.slots[slotIdx] = newSlot;
    // Drain queued work onto the fresh worker once it is ready.
    newSlot.ready.then(() => this.pumpQueue());
  }

  // ---------------------------------------------------------------------------
  // Internal: progress
  // ---------------------------------------------------------------------------

  // Aggregate progress uses the maximum of (resolved + actual in-flight
  // progress) ever observed. This keeps the bar smooth (it advances as work
  // is done) while staying monotonic: when a batch completes with some
  // unresolved refs, the drop in in-flight progress is absorbed by the max.
  private maxAggregateCurrent = 0;

  private emitProgress(): void {
    // Single shared throttle window for both aggregate and per-worker
    // callbacks — they always fire together (or both skip) so the UI
    // doesn't get half a frame.
    const now = Date.now();
    if (now - this.lastProgressAt < this.progressThrottleMs) return;
    this.lastProgressAt = now;

    if (this.onProgress) {
      let inflightProgress = 0;
      for (const stats of this.workerStats.values()) {
        inflightProgress += stats.inflightProgress;
      }
      const current = this.resolvedCompleted + inflightProgress;
      this.maxAggregateCurrent = Math.max(this.maxAggregateCurrent, current);
      const safeCurrent = Math.min(this.maxAggregateCurrent, this.totalSubmitted);
      this.onProgress(safeCurrent, this.totalSubmitted);
    }

    if (this.onWorkerProgress) {
      this.onWorkerProgress(this.snapshotWorkerProgress());
    }
  }

  /**
   * Build a per-worker progress snapshot suitable for the UI. Only includes
   * workers that have actually been assigned work, so the UI doesn't show
   * idle slots as empty `0/0` bars.
   */
  private snapshotWorkerProgress(): WorkerProgressSnapshot[] {
    const out: WorkerProgressSnapshot[] = [];
    for (let i = 0; i < this.slots.length; i++) {
      const stats = this.workerStats.get(i);
      if (!stats || stats.totalAssigned === 0) continue;
      const current = stats.resolvedFromCompleted + stats.inflightProgress;
      out.push({ id: i, current, total: stats.totalAssigned });
    }
    return out;
  }

  /**
   * Public read-only snapshot. Useful for one-shot displays (e.g. on phase
   * completion) and tests. Returns a defensive copy.
   */
  getWorkerProgress(): WorkerProgressSnapshot[] {
    return this.snapshotWorkerProgress();
  }

}
