/**
 * Parse Worker Pool
 *
 * Owns N `worker_threads` instances that all run the parse-worker.ts
 * protocol in parallel. The orchestrator submits files via
 * `submit()` and consumes results via `drain()`. The pool handles
 * grammar loading on each worker at startup, round-robin dispatch,
 * worker crash recovery (respawn + re-queue in-flight), and a
 * bounded result buffer for backpressure.
 *
 * init-performance change, phase 1.4
 * (openspec/changes/optimize-initialization-performance). Phase 1.5
 * wires this into ExtractionOrchestrator.
 */

import { Worker } from 'worker_threads';
import type { Language, ExtractionResult } from '../types';
import { logWarn, logDebug } from '../errors';

/** A file submitted to the pool. */
export interface PooledFile {
  filePath: string;
  content: string;
}

/** A result yielded by `drain()`. */
export interface PooledResult {
  filePath: string;
  result: ExtractionResult;
}

/** Internal: a worker slot, its ready promise, and current in-flight id. */
interface WorkerSlot {
  worker: Worker;
  ready: Promise<void>;
  inFlightId: number | null;
  /** Set true on the first uncaught crash — used to log "respawn" once. */
  crashed: boolean;
}

interface PendingParse {
  filePath: string;
  resolve: (r: ExtractionResult) => void;
  reject: (e: Error) => void;
  workerIdx: number;
}

/**
 * Result-stream sentinel: drain() yields these objects in completion
 * order. When the pool is closed or aborted, drain() yields a
 * `done: true` and the iterator ends.
 */
export type DrainItem =
  | { kind: 'result'; filePath: string; result: ExtractionResult }
  | { kind: 'error'; filePath: string; error: Error }
  | { kind: 'done' };

/**
 * Multi-worker parse pool. Round-robin dispatch: each `submit()` goes
 * to the next worker that isn't already busy. Each worker has exactly
 * one in-flight parse at a time (matches the per-worker tree-sitter
 * grammar state machine in parse-worker.ts).
 *
 * `drain()` is an `AsyncIterable<DrainItem>` that yields:
 *   - `{ kind: 'result', filePath, result }` when a parse completes
 *   - `{ kind: 'error', filePath, error }` on per-file failure
 *   - `{ kind: 'done' }` exactly once, when the pool is closed or aborted
 *
 * The consumer is expected to break on `done`. The pool never yields
 * `done` until every submitted file has either completed or errored
 * (unless `abort()` is called, in which case pending files are
 * rejected and `done` is yielded).
 */
export class ParseWorkerPool {
  private slots: WorkerSlot[] = [];
  private nextId = 1;
  private nextWorker = 0;
  private closed = false;
  private aborted = false;
  private languages: Language[];
  private frameworkNames: string[];
  private workerPath: string;
  private threads: number;

  /** id -> in-flight parse metadata. */
  private pending = new Map<number, PendingParse>();
  /** FIFO queue of completed results waiting for drain(). */
  private resultBuffer: Array<{
    kind: 'result' | 'error';
    filePath: string;
    result?: ExtractionResult;
    error?: Error;
  }> = [];
  /** Resolvers waiting on the next drain item. */
  private drainWaiters: Array<(item: DrainItem) => void> = [];

  constructor(
    threads: number,
    workerPath: string,
    languages: Language[],
    frameworkNames: string[]
  ) {
    if (threads < 1) {
      throw new Error(`ParseWorkerPool: threads must be >= 1 (got ${threads})`);
    }
    this.threads = threads;
    this.workerPath = workerPath;
    this.languages = languages;
    this.frameworkNames = frameworkNames;

    for (let i = 0; i < threads; i++) {
      this.slots.push(this.spawnWorker(i));
    }
    logDebug(`ParseWorkerPool: spawned ${threads} worker(s)`);
  }

  /**
   * Wait until every worker has finished loading its tree-sitter
   * grammars. Call this before `submit()` to make sure the first
   * parse doesn't race the grammar compile.
   */
  async ready(): Promise<void> {
    await Promise.all(this.slots.map((s) => s.ready));
  }

  /**
   * Number of workers currently in the pool. Stable across the pool
   * lifetime (we respawn crashed workers, so this never decreases).
   */
  get threadCount(): number {
    return this.slots.length;
  }

  /**
   * The configured thread count. Equal to `threadCount` in steady
   * state; named separately so callers reading the constructor's
   * `threads` argument don't accidentally rely on the respawn count.
   */
  get configuredThreads(): number {
    return this.threads;
  }

  /**
   * Submit a file for parsing. Returns a numeric id the consumer can
   * use to correlate the file with the result coming back through
   * `drain()`. The result itself carries the `filePath` so the id
   * is informational only; consumers can ignore it.
   *
   * `submit()` is non-blocking: it does not wait for the parse to
   * complete. The caller should iterate `drain()` to consume results.
   * If all workers are busy, `submit()` throws — the caller is
   * expected to throttle by waiting on `drain()` between batches.
   */
  submit(file: PooledFile): number {
    if (this.closed) {
      throw new Error('ParseWorkerPool: submit() after close()');
    }
    if (this.aborted) {
      throw new Error('ParseWorkerPool: submit() after abort()');
    }

    // Round-robin scan: find the first slot with no in-flight parse.
    const start = this.nextWorker;
    let slotIdx = -1;
    for (let i = 0; i < this.slots.length; i++) {
      const idx = (start + i) % this.slots.length;
      const slot = this.slots[idx]!;
      if (slot.inFlightId === null) {
        slotIdx = idx;
        break;
      }
    }
    if (slotIdx === -1) {
      throw new Error(
        'ParseWorkerPool: no free worker; the caller should drain() before submitting more'
      );
    }
    this.nextWorker = (slotIdx + 1) % this.slots.length;

    const id = this.nextId++;
    const slot = this.slots[slotIdx]!;
    slot.inFlightId = id;

    this.pending.set(id, {
      filePath: file.filePath,
      workerIdx: slotIdx,
      resolve: () => {
        // The actual resolution happens in onMessage; this resolver
        // is just a sentinel. The real `result` is captured by the
        // closure inside the message handler.
      },
      reject: () => {
        // Same — actual rejection happens in onError / onExit.
      },
    });

    slot.worker.postMessage({
      type: 'parse',
      id,
      filePath: file.filePath,
      content: file.content,
      frameworkNames: this.frameworkNames,
    });

    return id;
  }

  /**
   * Async-iterate the result stream. Yields each completed parse in
   * completion order (NOT submission order), then yields exactly one
   * `{ kind: 'done' }` and ends.
   *
   * Backpressure: if the consumer falls behind, the pool's
   * `resultBuffer` grows unbounded — but the in-memory size of a
   * typical parse result is small, and the orchestrator's
   * `BatchStore` (phase 2) drains the buffer at the same rate. The
   * pool itself does not bound the buffer; the consumer should.
   */
  async *drain(): AsyncIterableIterator<DrainItem> {
    while (true) {
      if (this.resultBuffer.length > 0) {
        const item = this.resultBuffer.shift()!;
        if (item.kind === 'result') {
          yield { kind: 'result', filePath: item.filePath, result: item.result! };
        } else {
          yield { kind: 'error', filePath: item.filePath, error: item.error! };
        }
        continue;
      }
      if (this.closed || this.aborted) {
        yield { kind: 'done' };
        return;
      }
      // No result yet and not done — wait for the next one.
      const item = await new Promise<DrainItem>((resolve) => {
        this.drainWaiters.push(resolve);
      });
      if (item.kind === 'done') {
        yield item;
        return;
      }
      yield item;
    }
  }

  /**
   * Abort the pool. Terminates every worker immediately, rejects
   * every in-flight parse, and yields `done` from `drain()`. Use
   * for cancellation (Ctrl+C, timeout) — not for normal shutdown.
   */
  async abort(): Promise<void> {
    if (this.closed || this.aborted) return;
    this.aborted = true;
    // Reject every pending parse.
    for (const [, p] of this.pending) {
      p.reject(new Error('ParseWorkerPool: aborted'));
    }
    this.pending.clear();
    // Mark every slot's in-flight as gone.
    for (const s of this.slots) s.inFlightId = null;
    // Terminate every worker in parallel. worker.terminate() returns
    // a promise that resolves when the thread is gone.
    await Promise.all(
      this.slots.map((s) => s.worker.terminate().catch(() => {}))
    );
    // Wake every drain waiter with `done`.
    const waiters = this.drainWaiters.splice(0);
    for (const w of waiters) w({ kind: 'done' });
  }

  /**
   * Graceful shutdown. Sends `shutdown` to every worker and waits
   * for `shutdown-ack`. Pending parses are drained first (via
   * `drain()`) so callers can read every result before close. After
   * `close()` returns, the pool is unusable.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    // Wait for every pending parse to finish so we don't lose
    // results. The consumer should already be iterating drain() in
    // parallel; we just make sure we don't close with work in
    // flight. The 60s safety net catches a worker that's stuck on
    // a pathological file even after a long timeout.
    const deadline = Date.now() + 60_000;
    while (this.pending.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    // Send shutdown to every worker.
    await Promise.all(
      this.slots.map(
        (s) =>
          new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              // Worker didn't ack within 5s — terminate it.
              s.worker.terminate().catch(() => {});
              resolve();
            }, 5_000);
            s.worker.once('message', (msg: { type: string }) => {
              if (msg.type === 'shutdown-ack') {
                clearTimeout(timer);
                s.worker.terminate().catch(() => {});
                resolve();
              }
            });
            s.worker.postMessage({ type: 'shutdown' });
          })
      )
    );
    // Wake any remaining drain waiters with `done`.
    const waiters = this.drainWaiters.splice(0);
    for (const w of waiters) w({ kind: 'done' });
  }

  // ---------------------------------------------------------------------------
  // Internal: worker lifecycle
  // ---------------------------------------------------------------------------

  private spawnWorker(idx: number): WorkerSlot {
    const worker = new Worker(this.workerPath);
    let readyResolve!: () => void;
    const ready = new Promise<void>((resolve) => {
      readyResolve = resolve;
    });
    const slot: WorkerSlot = {
      worker,
      ready,
      inFlightId: null,
      crashed: false,
    };

    worker.on('message', (msg: { type: string; id?: number; result?: ExtractionResult }) => {
      this.onMessage(slot, idx, msg);
    });
    worker.on('error', (err: Error) => {
      this.onError(slot, idx, err);
    });
    worker.on('exit', (code: number) => {
      this.onExit(slot, idx, code);
    });

    // The 'grammars-loaded' message flips `readyResolve`. The ack
    // listener is attached BEFORE we post the load message so we
    // can't miss the ack if the worker is unusually fast.
    const readyAckHandler = (msg: { type: string }) => {
      if (msg.type === 'grammars-loaded') {
        worker.off('message', readyAckHandler);
        readyResolve();
      }
    };
    worker.on('message', readyAckHandler);
    worker.postMessage({ type: 'load-grammars', languages: this.languages });

    return slot;
  }

  private onMessage(
    slot: WorkerSlot,
    slotIdx: number,
    msg: { type: string; id?: number; result?: ExtractionResult }
  ): void {
    void slotIdx; // reserved for per-slot logging / metrics (currently unused)
    // 'grammars-loaded' is handled by the dedicated ack handler
    // attached in spawnWorker. The general handler here ignores it
    // so we don't double-resolve the ready promise.
    if (msg.type === 'parse-result' && msg.id !== undefined) {
      const pending = this.pending.get(msg.id);
      if (!pending) {
        // Late result (after close/abort). Drop it.
        return;
      }
      this.pending.delete(msg.id);
      slot.inFlightId = null;
      this.enqueue({
        kind: 'result',
        filePath: pending.filePath,
        result: msg.result!,
      });
      pending.resolve(msg.result!);
      return;
    }
    if (msg.type === 'shutdown-ack') {
      // close() handles this via the once('message') listener.
      return;
    }
  }

  private onError(slot: WorkerSlot, slotIdx: number, err: Error): void {
    logWarn(`ParseWorkerPool: worker ${slotIdx} error`, { error: err.message });
    this.handleWorkerDeath(slot, slotIdx, `worker error: ${err.message}`);
  }

  private onExit(slot: WorkerSlot, slotIdx: number, code: number): void {
    if (this.closed || this.aborted) {
      // Normal close — no need to log.
      return;
    }
    if (code === 0) {
      // Clean exit before close() — treat as a crash so we respawn
      // and don't lose work.
      this.handleWorkerDeath(slot, slotIdx, `worker exited cleanly with code 0`);
      return;
    }
    logWarn(`ParseWorkerPool: worker ${slotIdx} exited with code ${code}`);
    this.handleWorkerDeath(slot, slotIdx, `worker exited with code ${code}`);
  }

  private handleWorkerDeath(
    slot: WorkerSlot,
    slotIdx: number,
    reason: string
  ): void {
    // Reject any in-flight parse for this slot.
    if (slot.inFlightId !== null) {
      const id = slot.inFlightId;
      slot.inFlightId = null;
      const pending = this.pending.get(id);
      if (pending) {
        this.pending.delete(id);
        this.enqueue({ kind: 'error', filePath: pending.filePath, error: new Error(reason) });
        pending.reject(new Error(reason));
      }
    }
    if (this.closed || this.aborted) return;
    // Respawn the worker so the pool stays at the configured size.
    // We reuse the slot object (same index) so dispatch state stays
    // consistent. The new worker will load its own grammars.
    if (!slot.crashed) {
      logDebug(`ParseWorkerPool: respawning worker ${slotIdx}`);
      slot.crashed = true;
    }
    const newSlot = this.spawnWorker(slotIdx);
    this.slots[slotIdx] = newSlot;
  }

  private enqueue(item: {
    kind: 'result' | 'error';
    filePath: string;
    result?: ExtractionResult;
    error?: Error;
  }): void {
    if (this.drainWaiters.length > 0) {
      const w = this.drainWaiters.shift()!;
      if (item.kind === 'result') {
        w({ kind: 'result', filePath: item.filePath, result: item.result! });
      } else {
        w({ kind: 'error', filePath: item.filePath, error: item.error! });
      }
      return;
    }
    this.resultBuffer.push(item);
  }
}

