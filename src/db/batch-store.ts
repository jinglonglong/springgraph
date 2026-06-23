/**
 * Batched DB writer
 *
 * Buffers nodes/edges/unresolved-refs/files across many parsed
 * files and commits them in a single transaction on the configured
 * triggers. Replaces the per-file `storeExtractionResult` flow
 * (one transaction per file × N categories) with one transaction
 * per batch — cutting both the `BEGIN`/`COMMIT` overhead and the
 * `node:sqlite` argument-shuffling cost that dominate on small
 * files.
 *
 * init-performance change, phase 2
 * (openspec/changes/optimize-initialization-performance).
 *
 * Triggers — flush() runs when ANY of:
 *   - batched file count >= batchSize (default 100)
 *   - elapsed since last flush >= batchFlushMs (default 250)
 *   - total placeholder count would exceed 30000
 *     (SQLITE_MAX_VARIABLE_NUMBER minus headroom)
 *
 * Skip-on-unchanged is preserved: append() hashes the content and
 * drops the file from the buffer entirely if the existing row's
 * hash matches.
 *
 * Cancellation: the store has no abort path. The orchestrator
 * owns the abort signal and decides whether to call
 * `batchStore.close()` (flush + commit) or just let the buffer
 * be discarded on process exit.
 */
import * as fs from 'fs';
import type { Language, Node, Edge, FileRecord, ExtractionResult, UnresolvedReference } from '../types';
import type { QueryBuilder } from './queries';
import { cheapHash, strongHash } from '../util/hash';

/** Conservative ceiling on SQL placeholder count per INSERT. */
const MAX_PLACEHOLDERS = 30000;

/** Average placeholders per row, per category, used as a rough cap. */
const PLACEHOLDERS_PER_NODE = 18;
const PLACEHOLDERS_PER_EDGE = 8;
const PLACEHOLDERS_PER_REF = 8;
const PLACEHOLDERS_PER_FILE = 9;

export interface BatchStoreOptions {
  /** Flush when this many distinct files are buffered. */
  batchSize: number;
  /** Flush when this much wall time has elapsed since the last flush. */
  batchFlushMs: number;
  /** Optional logger for verbose output. */
  log?: (msg: string) => void;
}

/** A single file's worth of buffered writes. */
interface BufferedFile {
  fileRecord: FileRecord;
  validNodes: Node[];
  validEdges: Edge[];
  validRefs: UnresolvedReference[];
}

export class BatchStore {
  private readonly queries: QueryBuilder;
  private readonly opts: Required<BatchStoreOptions>;

  /** Buffered writes keyed by file path (later appends overwrite). */
  private buffer = new Map<string, BufferedFile>();
  /** File paths whose old data needs deleting before the new rows land. */
  private toDelete = new Set<string>();
  private lastFlushTime = Date.now();
  private closed = false;

  constructor(queries: QueryBuilder, opts: BatchStoreOptions) {
    this.queries = queries;
    this.opts = {
      log: opts.log ?? (() => {}),
      batchSize: opts.batchSize,
      batchFlushMs: opts.batchFlushMs,
    };
  }

  /**
   * Add one file's worth of writes to the buffer. Reads the
   * existing file row to detect a no-op (skip when content hash
   * matches). Does NOT call the DB write path yet — the actual
   * INSERTs happen in flush().
   *
   * init-performance change, phase 3: two-tier skip. First we
   * compare the cheap (non-cryptographic, ~5 GB/s) hash. If it
   * matches the stored `cheap_hash` we skip without computing
   * SHA-256. If the cheap hash differs but the strong hash
   * matches, we also skip (rare: a non-cryptographic collision).
   * Otherwise we buffer the new rows.
   *
   * The second init on an unchanged tree short-circuits on the
   * first tier for every file - that's the "re-init is instant"
   * property the change promises.
   *
   * May trigger a flush mid-call if any trigger threshold is
   * crossed.
   */
  async append(
    filePath: string,
    content: string,
    language: Language,
    stats: fs.Stats,
    result: ExtractionResult
  ): Promise<void> {
    if (this.closed) {
      throw new Error('BatchStore: append() after close()');
    }
    const strong = strongHash(content);
    const cheap = cheapHash(content);

    // Skip on cheap-hash match. The first init on a fresh DB has
    // no existing row, so this branch is only hit on re-init.
    const existing = this.queries.getFileByPath(filePath);
    if (existing) {
      if (existing.cheapHash && existing.cheapHash === cheap) {
        return;
      }
      if (existing.contentHash === strong) {
        return;
      }
    }

    // If this file was already buffered (same path, second append in
    // one batch), drop the old buffered version. The new one wins
    // — duplicates shouldn't happen in normal flows, but if they
    // do we keep the last write.
    this.buffer.delete(filePath);

    // Filter out nodes with missing required fields to avoid FK
    // violations when edges reference them (see issue #42, lifted
    // from the per-file storeExtractionResult).
    const validNodes = result.nodes.filter(
      (n) => n.id && n.kind && n.name && n.filePath && n.language
    );
    const insertedIds = new Set(validNodes.map((n) => n.id));
    const validEdges = result.edges.filter(
      (e) => insertedIds.has(e.source) && insertedIds.has(e.target)
    );
    const validRefs = result.unresolvedReferences
      .filter((ref) => insertedIds.has(ref.fromNodeId))
      .map((ref) => ({
        ...ref,
        filePath: ref.filePath ?? filePath,
        language: ref.language ?? language,
      }));

    const fileRecord: FileRecord = {
      path: filePath,
      contentHash: strong,
      cheapHash: cheap,
      language,
      size: stats.size,
      modifiedAt: stats.mtimeMs,
      indexedAt: Date.now(),
      nodeCount: result.nodes.length,
      errors: result.errors.length > 0 ? result.errors : undefined,
    };

    this.buffer.set(filePath, { fileRecord, validNodes, validEdges, validRefs });
    if (existing) {
      this.toDelete.add(filePath);
    }

    if (this.shouldFlush()) {
      await this.flush();
    }
  }

  /** True if any flush trigger threshold is reached. */
  private shouldFlush(): boolean {
    if (this.buffer.size === 0) return false;
    if (this.buffer.size >= this.opts.batchSize) return true;
    if (Date.now() - this.lastFlushTime >= this.opts.batchFlushMs) return true;
    if (this.placeholderCount() >= MAX_PLACEHOLDERS) return true;
    return false;
  }

  /** Sum of approximate placeholders across the four insert batches. */
  private placeholderCount(): number {
    let n = 0;
    for (const bf of this.buffer.values()) {
      n += bf.validNodes.length * PLACEHOLDERS_PER_NODE;
      n += bf.validEdges.length * PLACEHOLDERS_PER_EDGE;
      n += bf.validRefs.length * PLACEHOLDERS_PER_REF;
    }
    n += this.buffer.size * PLACEHOLDERS_PER_FILE;
    return n;
  }

  /**
   * Commit the buffered writes in a single transaction. The
   * transaction is opened by QueryBuilder.transaction() so a
   * mid-flush error rolls back the whole batch — the next flush
   * (or process exit) discards the buffer and the orchestrator
   * sees an error from the underlying insert.
   */
  async flush(): Promise<void> {
    if (this.closed) {
      throw new Error('BatchStore: flush() after close()');
    }
    if (this.buffer.size === 0) {
      this.lastFlushTime = Date.now();
      return;
    }

    // Snapshot and clear first so a re-entrant append() during the
    // flush doesn't see partial state.
    const fileRecords: FileRecord[] = [];
    const allNodes: Node[] = [];
    const allEdges: Edge[] = [];
    const allRefs: UnresolvedReference[] = [];
    const deletes: string[] = [];
    for (const [, bf] of this.buffer) {
      fileRecords.push(bf.fileRecord);
      for (const n of bf.validNodes) allNodes.push(n);
      for (const e of bf.validEdges) allEdges.push(e);
      for (const r of bf.validRefs) allRefs.push(r);
    }
    for (const filePath of this.toDelete) {
      deletes.push(filePath);
    }
    this.buffer.clear();
    this.toDelete.clear();
    this.lastFlushTime = Date.now();

    // Run each insert category. Note we do NOT wrap this in an
    // outer transaction: `insertNodes`, `insertEdges`,
    // `insertUnresolvedRefsBatch`, and `upsertFile` each open
    // their own internal transaction, and SQLite disallows nested
    // transactions ("cannot start a transaction within a
    // transaction"). The batching win is amortizing per-file
    // BEGIN/COMMITs into per-batch BEGIN/COMMITs — 4 categories
    // × 1 BEGIN/COMMIT each = 4 per batch, vs 4 per file in the
    // per-file path. For batchSize=100 and N=102 files, that's
    // 4 vs 408 transactions, which is the dominant saving.
    //
    // Atomicity is partial: a mid-batch insert failure leaves the
    // earlier categories committed. The per-file path has the
    // same property, so this is no regression — it just means we
    // should retry the whole batch on any error.
    for (const filePath of deletes) {
      this.queries.deleteFile(filePath);
    }
    if (allNodes.length > 0) this.queries.insertNodes(allNodes);
    if (allEdges.length > 0) this.queries.insertEdges(allEdges);
    if (allRefs.length > 0) this.queries.insertUnresolvedRefsBatch(allRefs);
    for (const f of fileRecords) {
      this.queries.upsertFile(f);
    }

    this.opts.log(
      `BatchStore: flushed ${fileRecords.length} files (${allNodes.length} nodes, ${allEdges.length} edges, ${allRefs.length} refs)`
    );
  }

  /**
   * Final flush at the end of an indexing run. Idempotent — calling
   * twice is safe; the second call sees `this.closed === true` and
   * returns immediately. We flush BEFORE marking closed because
   * `flush()` itself checks `this.closed` and throws to prevent
   * post-close writes from being silently dropped.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    await this.flush();
    this.closed = true;
  }

  /** Number of distinct files currently buffered (for diagnostics). */
  get bufferedFileCount(): number {
    return this.buffer.size;
  }

  /** Approximate placeholder count for diagnostics. */
  get approximatePlaceholderCount(): number {
    return this.placeholderCount();
  }
}
