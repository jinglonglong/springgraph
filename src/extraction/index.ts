/**
 * Extraction Orchestrator
 *
 * Coordinates file scanning, parsing, and database storage.
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFileSync } from 'child_process';
import {
  Language,
  FileRecord,
  ExtractionResult,
  ExtractionError,
  CodeGraphConfig,
} from '../types';
import { QueryBuilder } from '../db/queries';
import { extractFromSource } from './tree-sitter';
import { detectLanguage, isLanguageSupported, initGrammars, loadGrammarsForLanguages } from './grammars';
import { logDebug, logWarn } from '../errors';
import { validatePathWithinRoot, normalizePath } from '../utils';
import picomatch from 'picomatch';

/**
 * Number of files to read in parallel during indexing.
 * File reads are I/O-bound; batching overlaps I/O wait with CPU parse work.
 */
const FILE_IO_BATCH_SIZE = 10;

// PARSER_RESET_INTERVAL moved to parse-worker.ts (runs in worker thread)

/**
 * Progress callback for indexing operations
 */
export interface IndexProgress {
  phase: 'scanning' | 'parsing' | 'storing' | 'resolving';
  current: number;
  total: number;
  currentFile?: string;
}

/**
 * Result of an indexing operation
 */
export interface IndexResult {
  success: boolean;
  filesIndexed: number;
  filesSkipped: number;
  filesErrored: number;
  nodesCreated: number;
  edgesCreated: number;
  errors: ExtractionError[];
  durationMs: number;
}

/**
 * Result of a sync operation
 */
export interface SyncResult {
  filesChecked: number;
  filesAdded: number;
  filesModified: number;
  filesRemoved: number;
  nodesUpdated: number;
  durationMs: number;
  changedFilePaths?: string[];
}

/**
 * Calculate SHA256 hash of file contents
 */
export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Check if a path matches any glob pattern (simplified)
 */
function matchesGlob(filePath: string, pattern: string): boolean {
  filePath = normalizePath(filePath);
  return picomatch.isMatch(filePath, pattern, { dot: true });
}

/**
 * Check if a file should be included based on config
 */
export function shouldIncludeFile(
  filePath: string,
  config: CodeGraphConfig
): boolean {
  // Check exclude patterns first
  for (const pattern of config.exclude) {
    if (matchesGlob(filePath, pattern)) {
      return false;
    }
  }

  // Check include patterns
  for (const pattern of config.include) {
    if (matchesGlob(filePath, pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Get all files visible to git (tracked + untracked but not ignored).
 * Respects .gitignore at all levels (root, subdirectories).
 * Returns null on failure (non-git project) so callers can fall back.
 */
function getGitVisibleFiles(rootDir: string): Set<string> | null {
  try {
    // Check if the project directory is gitignored by a parent repo.
    // When rootDir lives inside a parent git repo that ignores it,
    // `git ls-files` returns nothing — fall back to filesystem walk.
    const gitRoot = execFileSync(
      'git',
      ['rev-parse', '--show-toplevel'],
      { cwd: rootDir, encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (path.resolve(gitRoot) !== path.resolve(rootDir)) {
      try {
        // git check-ignore exits 0 if the path IS ignored, 1 if not
        execFileSync(
          'git',
          ['check-ignore', '-q', path.resolve(rootDir)],
          { cwd: rootDir, encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
        );
        // Directory is gitignored by parent repo — fall back to filesystem walk
        return null;
      } catch {
        // Not ignored — safe to use git ls-files
      }
    }

    // -c = cached (tracked), -o = others (untracked), --exclude-standard = respect .gitignore
    const output = execFileSync(
      'git',
      ['ls-files', '-co', '--exclude-standard'],
      { cwd: rootDir, encoding: 'utf-8', timeout: 30000, maxBuffer: 50 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const files = new Set<string>();
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) {
        files.add(normalizePath(trimmed));
      }
    }
    return files;
  } catch {
    return null;
  }
}

/**
 * Result of git-based change detection.
 * Returns null when git is unavailable (non-git project or command failure),
 * signaling the caller to fall back to full filesystem scan.
 */
interface GitChanges {
  modified: string[];  // M, MM, AM — files to re-hash + re-index
  added: string[];     // ?? — new untracked files to index
  deleted: string[];   // D — files to remove from DB
}

/**
 * Use `git status` to detect changed files instead of scanning every file.
 * Returns null on failure so callers fall back to full scan.
 */
function getGitChangedFiles(rootDir: string, config: CodeGraphConfig): GitChanges | null {
  try {
    const output = execFileSync(
      'git',
      ['status', '--porcelain', '--no-renames'],
      { cwd: rootDir, encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    const modified: string[] = [];
    const added: string[] = [];
    const deleted: string[] = [];

    for (const line of output.split('\n')) {
      if (line.length < 4) continue; // Minimum: "XY file"

      const statusCode = line.substring(0, 2);
      const filePath = normalizePath(line.substring(3));

      // Skip files that don't match include/exclude config
      if (!shouldIncludeFile(filePath, config)) continue;

      if (statusCode === '??') {
        added.push(filePath);
      } else if (statusCode.includes('D')) {
        deleted.push(filePath);
      } else {
        // M, MM, AM, A (staged), etc. — treat as modified
        modified.push(filePath);
      }
    }

    return { modified, added, deleted };
  } catch {
    return null;
  }
}

/**
 * Marker file name that indicates a directory (and all children) should be skipped
 */
const CODEGRAPH_IGNORE_MARKER = '.codegraphignore';

/**
 * Recursively scan directory for source files.
 *
 * In git repos, uses `git ls-files` to get the file list (inherently
 * respects .gitignore at all levels), then filters by config include patterns.
 * Falls back to filesystem walk for non-git projects.
 */
export function scanDirectory(
  rootDir: string,
  config: CodeGraphConfig,
  onProgress?: (current: number, file: string) => void
): string[] {
  // Fast path: use git to get all visible files (respects .gitignore everywhere)
  const gitFiles = getGitVisibleFiles(rootDir);
  if (gitFiles) {
    const files: string[] = [];
    let count = 0;
    for (const filePath of gitFiles) {
      if (shouldIncludeFile(filePath, config)) {
        files.push(filePath);
        count++;
        onProgress?.(count, filePath);
      }
    }
    return files;
  }

  // Fallback: walk filesystem for non-git projects
  return scanDirectoryWalk(rootDir, config, onProgress);
}

/**
 * Async variant of scanDirectory that yields to the event loop periodically,
 * allowing worker threads to receive and render progress messages.
 */
export async function scanDirectoryAsync(
  rootDir: string,
  config: CodeGraphConfig,
  onProgress?: (current: number, file: string) => void
): Promise<string[]> {
  const gitFiles = getGitVisibleFiles(rootDir);
  if (gitFiles) {
    const files: string[] = [];
    let count = 0;
    for (const filePath of gitFiles) {
      if (shouldIncludeFile(filePath, config)) {
        files.push(filePath);
        count++;
        onProgress?.(count, filePath);
        // Yield every 100 files so worker threads can render progress
        if (count % 100 === 0) {
          await new Promise<void>(r => setImmediate(r));
        }
      }
    }
    return files;
  }

  return scanDirectoryWalk(rootDir, config, onProgress);
}

/**
 * Filesystem walk fallback for non-git projects.
 */
function scanDirectoryWalk(
  rootDir: string,
  config: CodeGraphConfig,
  onProgress?: (current: number, file: string) => void
): string[] {
  const files: string[] = [];
  let count = 0;
  const visitedDirs = new Set<string>();

  function walk(dir: string): void {
    let realDir: string;
    try {
      realDir = fs.realpathSync(dir);
    } catch {
      logDebug('Skipping unresolvable directory', { dir });
      return;
    }

    if (visitedDirs.has(realDir)) {
      logDebug('Skipping already-visited directory (symlink cycle)', { dir, realDir });
      return;
    }
    visitedDirs.add(realDir);

    // Check for .codegraphignore marker file
    const ignoreMarker = path.join(dir, CODEGRAPH_IGNORE_MARKER);
    if (fs.existsSync(ignoreMarker)) {
      logDebug('Skipping directory due to .codegraphignore marker', { dir });
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      logDebug('Skipping unreadable directory', { dir, error: String(error) });
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = normalizePath(path.relative(rootDir, fullPath));

      if (entry.isSymbolicLink()) {
        try {
          const realTarget = fs.realpathSync(fullPath);
          const stat = fs.statSync(realTarget);
          if (stat.isDirectory()) {
            const dirPattern = relativePath + '/';
            let excluded = false;
            for (const pattern of config.exclude) {
              if (matchesGlob(dirPattern, pattern) || matchesGlob(relativePath, pattern)) {
                excluded = true;
                break;
              }
            }
            if (!excluded) {
              walk(fullPath);
            }
          } else if (stat.isFile()) {
            if (shouldIncludeFile(relativePath, config)) {
              files.push(relativePath);
              count++;
              onProgress?.(count, relativePath);
            }
          }
        } catch {
          logDebug('Skipping broken symlink', { path: fullPath });
        }
        continue;
      }

      if (entry.isDirectory()) {
        const dirPattern = relativePath + '/';
        let excluded = false;
        for (const pattern of config.exclude) {
          if (matchesGlob(dirPattern, pattern) || matchesGlob(relativePath, pattern)) {
            excluded = true;
            break;
          }
        }
        if (!excluded) {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        if (shouldIncludeFile(relativePath, config)) {
          files.push(relativePath);
          count++;
          onProgress?.(count, relativePath);
        }
      }
    }
  }

  walk(rootDir);
  return files;
}

/**
 * Extraction orchestrator
 */
export class ExtractionOrchestrator {
  private rootDir: string;
  private config: CodeGraphConfig;
  private queries: QueryBuilder;

  constructor(rootDir: string, config: CodeGraphConfig, queries: QueryBuilder) {
    this.rootDir = rootDir;
    this.config = config;
    this.queries = queries;
  }

  /**
   * Index all files in the project
   */
  async indexAll(
    onProgress?: (progress: IndexProgress) => void,
    signal?: AbortSignal
  ): Promise<IndexResult> {
    await initGrammars();
    const startTime = Date.now();
    const errors: ExtractionError[] = [];
    let filesIndexed = 0;
    let filesSkipped = 0;
    let filesErrored = 0;
    let totalNodes = 0;
    let totalEdges = 0;

    // Phase 1: Scan for files
    onProgress?.({
      phase: 'scanning',
      current: 0,
      total: 0,
    });

    const files = await scanDirectoryAsync(this.rootDir, this.config, (current, file) => {
      onProgress?.({
        phase: 'scanning',
        current,
        total: 0,
        currentFile: file,
      });
    });

    if (signal?.aborted) {
      return {
        success: false,
        filesIndexed: 0,
        filesSkipped: 0,
        filesErrored: 0,
        nodesCreated: 0,
        edgesCreated: 0,
        errors: [{ message: 'Aborted', severity: 'error' }],
        durationMs: Date.now() - startTime,
      };
    }

    // Phase 2: Parse files in a worker thread (keeps main thread unblocked for UI)
    const total = files.length;
    let processed = 0;

    // Detect needed languages and load grammars in the parse worker
    const neededLanguages = [...new Set(files.map((f) => detectLanguage(f)))];

    // Try to use a worker thread for parsing (keeps main thread unblocked for UI).
    // Falls back to in-process parsing if the compiled worker is unavailable (e.g. tests).
    const parseWorkerPath = path.join(__dirname, 'parse-worker.js');
    const useWorker = fs.existsSync(parseWorkerPath);
    let parseWorker: import('worker_threads').Worker | null = null;

    if (useWorker) {
      const { Worker } = await import('worker_threads');
      parseWorker = new Worker(parseWorkerPath);
    } else {
      // In-process fallback: load grammars locally
      await loadGrammarsForLanguages(neededLanguages);
    }

    // Set up worker-based or in-process parsing
    let nextId = 0;
    const pendingParses = new Map<number, {
      resolve: (result: ExtractionResult) => void;
    }>();

    if (parseWorker) {
      // Wait for grammars to load in the worker
      await new Promise<void>((resolve, reject) => {
        parseWorker!.once('message', (msg: { type: string }) => {
          if (msg.type === 'grammars-loaded') resolve();
          else reject(new Error(`Unexpected message: ${msg.type}`));
        });
        parseWorker!.postMessage({ type: 'load-grammars', languages: neededLanguages });
      });

      parseWorker.on('message', (msg: { type: string; id?: number; result?: ExtractionResult }) => {
        if (msg.type === 'parse-result' && msg.id !== undefined) {
          const pending = pendingParses.get(msg.id);
          if (pending) {
            pendingParses.delete(msg.id);
            pending.resolve(msg.result!);
          }
        }
      });
    }

    function requestParse(filePath: string, content: string): Promise<ExtractionResult> {
      if (parseWorker) {
        return new Promise<ExtractionResult>((resolve) => {
          const id = nextId++;
          pendingParses.set(id, { resolve });
          parseWorker!.postMessage({ type: 'parse', id, filePath, content });
        });
      }
      // In-process fallback
      return Promise.resolve(extractFromSource(filePath, content, detectLanguage(filePath)));
    }

    for (let i = 0; i < files.length; i += FILE_IO_BATCH_SIZE) {
      if (signal?.aborted) {
        if (parseWorker) await parseWorker.terminate();
        return {
          success: false,
          filesIndexed,
          filesSkipped,
          filesErrored,
          nodesCreated: totalNodes,
          edgesCreated: totalEdges,
          errors: [{ message: 'Aborted', severity: 'error' }, ...errors],
          durationMs: Date.now() - startTime,
        };
      }

      const batch = files.slice(i, i + FILE_IO_BATCH_SIZE);

      // Read files in parallel (with path validation before any I/O)
      const fileContents = await Promise.all(
        batch.map(async (fp) => {
          try {
            const fullPath = validatePathWithinRoot(this.rootDir, fp);
            if (!fullPath) {
              logWarn('Path traversal blocked in batch reader', { filePath: fp });
              return { filePath: fp, content: null as string | null, stats: null as fs.Stats | null, error: new Error('Path traversal blocked') };
            }
            const content = await fsp.readFile(fullPath, 'utf-8');
            const stats = await fsp.stat(fullPath);
            return { filePath: fp, content, stats, error: null as Error | null };
          } catch (err) {
            return { filePath: fp, content: null as string | null, stats: null as fs.Stats | null, error: err as Error };
          }
        })
      );

      // Send to worker for parsing, store results on main thread
      for (const { filePath, content, stats, error } of fileContents) {
        if (signal?.aborted) {
          if (parseWorker) await parseWorker.terminate();
          return {
            success: false,
            filesIndexed,
            filesSkipped,
            filesErrored,
            nodesCreated: totalNodes,
            edgesCreated: totalEdges,
            errors: [{ message: 'Aborted', severity: 'error' }, ...errors],
            durationMs: Date.now() - startTime,
          };
        }

        processed++;
        onProgress?.({
          phase: 'parsing',
          current: processed,
          total,
          currentFile: filePath,
        });

        if (error || content === null || stats === null) {
          filesErrored++;
          errors.push({
            message: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
            filePath,
            severity: 'error',
            code: 'read_error',
          });
          continue;
        }

        // Parse in worker thread (main thread stays unblocked)
        const result = await requestParse(filePath, content);

        // Store in database on main thread (SQLite is not thread-safe)
        if (result.nodes.length > 0 || result.errors.length === 0) {
          const language = detectLanguage(filePath);
          this.storeExtractionResult(filePath, content, language, stats, result);
        }

        if (result.errors.length > 0) {
          for (const err of result.errors) {
            if (!err.filePath) err.filePath = filePath;
          }
          errors.push(...result.errors);
        }

        if (result.nodes.length > 0) {
          filesIndexed++;
          totalNodes += result.nodes.length;
          totalEdges += result.edges.length;
        } else if (result.errors.some((e) => e.severity === 'error')) {
          filesErrored++;
        } else {
          filesSkipped++;
        }
      }
    }

    // Shut down parse worker
    if (parseWorker) await parseWorker.terminate();

    // Phase 3: Resolve references
    onProgress?.({
      phase: 'resolving',
      current: 0,
      total: 1,
    });

    // TODO: Implement reference resolution in Phase 3

    return {
      success: filesIndexed > 0 || errors.filter((e) => e.severity === 'error').length === 0,
      filesIndexed,
      filesSkipped,
      filesErrored,
      nodesCreated: totalNodes,
      edgesCreated: totalEdges,
      errors,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Index specific files
   */
  async indexFiles(filePaths: string[]): Promise<IndexResult> {
    const startTime = Date.now();
    const errors: ExtractionError[] = [];
    let filesIndexed = 0;
    let filesSkipped = 0;
    let filesErrored = 0;
    let totalNodes = 0;
    let totalEdges = 0;

    for (const filePath of filePaths) {
      const result = await this.indexFile(filePath);

      if (result.errors.length > 0) {
        errors.push(...result.errors);
      }

      if (result.nodes.length > 0) {
        filesIndexed++;
        totalNodes += result.nodes.length;
        totalEdges += result.edges.length;
      } else if (result.errors.some((e) => e.severity === 'error')) {
        filesErrored++;
      } else {
        filesSkipped++;
      }
    }

    return {
      success: filesIndexed > 0 || errors.filter((e) => e.severity === 'error').length === 0,
      filesIndexed,
      filesSkipped,
      filesErrored,
      nodesCreated: totalNodes,
      edgesCreated: totalEdges,
      errors,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Index a single file
   */
  async indexFile(relativePath: string): Promise<ExtractionResult> {
    const fullPath = validatePathWithinRoot(this.rootDir, relativePath);

    if (!fullPath) {
      return {
        nodes: [],
        edges: [],
        unresolvedReferences: [],
        errors: [{ message: `Path traversal blocked: ${relativePath}`, filePath: relativePath, severity: 'error', code: 'path_traversal' }],
        durationMs: 0,
      };
    }

    // Read file content and stats
    let content: string;
    let stats: fs.Stats;
    try {
      stats = await fsp.stat(fullPath);
      content = await fsp.readFile(fullPath, 'utf-8');
    } catch (error) {
      return {
        nodes: [],
        edges: [],
        unresolvedReferences: [],
        errors: [
          {
            message: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
            filePath: relativePath,
            severity: 'error',
            code: 'read_error',
          },
        ],
        durationMs: 0,
      };
    }

    return this.indexFileWithContent(relativePath, content, stats);
  }

  /**
   * Index a single file with pre-read content and stats.
   * Used by the parallel batch reader to avoid redundant file I/O.
   */
  async indexFileWithContent(
    relativePath: string,
    content: string,
    stats: fs.Stats
  ): Promise<ExtractionResult> {
    // Prevent path traversal
    const fullPath = validatePathWithinRoot(this.rootDir, relativePath);
    if (!fullPath) {
      logWarn('Path traversal blocked in indexFileWithContent', { relativePath });
      return {
        nodes: [],
        edges: [],
        unresolvedReferences: [],
        errors: [{ message: 'Path traversal blocked', filePath: relativePath, severity: 'error', code: 'path_traversal' }],
        durationMs: 0,
      };
    }

    // Check file size
    if (stats.size > this.config.maxFileSize) {
      return {
        nodes: [],
        edges: [],
        unresolvedReferences: [],
        errors: [
          {
            message: `File exceeds max size (${stats.size} > ${this.config.maxFileSize})`,
            filePath: relativePath,
            severity: 'warning',
            code: 'size_exceeded',
          },
        ],
        durationMs: 0,
      };
    }

    // Detect language
    const language = detectLanguage(relativePath);
    if (!isLanguageSupported(language)) {
      return {
        nodes: [],
        edges: [],
        unresolvedReferences: [],
        errors: [],
        durationMs: 0,
      };
    }

    // Extract from source
    const result = extractFromSource(relativePath, content, language);

    // Store in database
    if (result.nodes.length > 0 || result.errors.length === 0) {
      this.storeExtractionResult(relativePath, content, language, stats, result);
    }

    return result;
  }

  /**
   * Store extraction result in database
   */
  private storeExtractionResult(
    filePath: string,
    content: string,
    language: Language,
    stats: fs.Stats,
    result: ExtractionResult
  ): void {
    const contentHash = hashContent(content);

    // Check if file already exists and hasn't changed
    const existingFile = this.queries.getFileByPath(filePath);
    if (existingFile && existingFile.contentHash === contentHash) {
      return; // No changes
    }

    // Delete existing data for this file
    if (existingFile) {
      this.queries.deleteFile(filePath);
    }

    // Filter out nodes with missing required fields before insertion.
    // This prevents FK violations when edges reference nodes that would
    // be silently skipped by insertNode() (see issue #42).
    const validNodes = result.nodes.filter((n) => n.id && n.kind && n.name && n.filePath && n.language);

    // Insert nodes
    if (validNodes.length > 0) {
      this.queries.insertNodes(validNodes);
    }

    // Filter edges to only reference nodes that were actually inserted
    if (result.edges.length > 0) {
      const insertedIds = new Set(validNodes.map((n) => n.id));
      const validEdges = result.edges.filter(
        (e) => insertedIds.has(e.source) && insertedIds.has(e.target)
      );
      if (validEdges.length > 0) {
        this.queries.insertEdges(validEdges);
      }
    }

    // Insert unresolved references in batch with denormalized filePath/language
    if (result.unresolvedReferences.length > 0) {
      const insertedIds = new Set(validNodes.map((n) => n.id));
      const refsWithContext = result.unresolvedReferences
        .filter((ref) => insertedIds.has(ref.fromNodeId))
        .map((ref) => ({
          ...ref,
          filePath: ref.filePath ?? filePath,
          language: ref.language ?? language,
        }));
      if (refsWithContext.length > 0) {
        this.queries.insertUnresolvedRefsBatch(refsWithContext);
      }
    }

    // Insert file record
    const fileRecord: FileRecord = {
      path: filePath,
      contentHash,
      language,
      size: stats.size,
      modifiedAt: stats.mtimeMs,
      indexedAt: Date.now(),
      nodeCount: result.nodes.length,
      errors: result.errors.length > 0 ? result.errors : undefined,
    };
    this.queries.upsertFile(fileRecord);
  }

  /**
   * Sync with current file state.
   * Uses git status as a fast path when available, falling back to full scan.
   */
  async sync(onProgress?: (progress: IndexProgress) => void): Promise<SyncResult> {
    await initGrammars(); // Initialize WASM runtime (grammars loaded lazily below)
    const startTime = Date.now();
    let filesChecked = 0;
    let filesAdded = 0;
    let filesModified = 0;
    let filesRemoved = 0;
    let nodesUpdated = 0;
    const changedFilePaths: string[] = [];

    onProgress?.({
      phase: 'scanning',
      current: 0,
      total: 0,
    });

    const filesToIndex: string[] = [];
    const gitChanges = getGitChangedFiles(this.rootDir, this.config);

    if (gitChanges) {
      // === Git fast path ===
      // Only inspect the files git reports as changed instead of scanning everything.
      filesChecked = gitChanges.modified.length + gitChanges.added.length + gitChanges.deleted.length;

      // Handle deleted files
      for (const filePath of gitChanges.deleted) {
        const tracked = this.queries.getFileByPath(filePath);
        if (tracked) {
          this.queries.deleteFile(filePath);
          filesRemoved++;
        }
      }

      // Handle modified files — read + hash only these files
      for (const filePath of gitChanges.modified) {
        const fullPath = path.join(this.rootDir, filePath);
        let content: string;
        try {
          content = fs.readFileSync(fullPath, 'utf-8');
        } catch (error) {
          logDebug('Skipping unreadable file during sync', { filePath, error: String(error) });
          continue;
        }

        const contentHash = hashContent(content);
        const tracked = this.queries.getFileByPath(filePath);

        if (!tracked) {
          filesToIndex.push(filePath);
          changedFilePaths.push(filePath);
          filesAdded++;
        } else if (tracked.contentHash !== contentHash) {
          filesToIndex.push(filePath);
          changedFilePaths.push(filePath);
          filesModified++;
        }
      }

      // Handle added (untracked) files
      for (const filePath of gitChanges.added) {
        filesToIndex.push(filePath);
        changedFilePaths.push(filePath);
        filesAdded++;
      }
    } else {
      // === Fallback: full scan (non-git project or git failure) ===
      const currentFiles = new Set(scanDirectory(this.rootDir, this.config));
      filesChecked = currentFiles.size;

      // Build Map for O(1) lookups instead of .find() per file
      const trackedFiles = this.queries.getAllFiles();
      const trackedMap = new Map<string, FileRecord>();
      for (const f of trackedFiles) {
        trackedMap.set(f.path, f);
      }

      // Find files to remove (in DB but not on disk)
      for (const tracked of trackedFiles) {
        if (!currentFiles.has(tracked.path)) {
          this.queries.deleteFile(tracked.path);
          filesRemoved++;
        }
      }

      // Find files to add or update
      for (const filePath of currentFiles) {
        const fullPath = path.join(this.rootDir, filePath);
        let content: string;
        try {
          content = fs.readFileSync(fullPath, 'utf-8');
        } catch (error) {
          logDebug('Skipping unreadable file during sync', { filePath, error: String(error) });
          continue;
        }

        const contentHash = hashContent(content);
        const tracked = trackedMap.get(filePath);

        if (!tracked) {
          filesToIndex.push(filePath);
          changedFilePaths.push(filePath);
          filesAdded++;
        } else if (tracked.contentHash !== contentHash) {
          filesToIndex.push(filePath);
          changedFilePaths.push(filePath);
          filesModified++;
        }
      }
    }

    // Load only grammars needed for changed files
    if (filesToIndex.length > 0) {
      const neededLanguages = [...new Set(filesToIndex.map((f) => detectLanguage(f)))];
      await loadGrammarsForLanguages(neededLanguages);
    }

    // Index changed files
    const total = filesToIndex.length;
    for (let i = 0; i < filesToIndex.length; i++) {
      const filePath = filesToIndex[i]!;
      onProgress?.({
        phase: 'parsing',
        current: i + 1,
        total,
        currentFile: filePath,
      });

      const result = await this.indexFile(filePath);
      nodesUpdated += result.nodes.length;
    }

    return {
      filesChecked,
      filesAdded,
      filesModified,
      filesRemoved,
      nodesUpdated,
      durationMs: Date.now() - startTime,
      changedFilePaths: changedFilePaths.length > 0 ? changedFilePaths : undefined,
    };
  }

  /**
   * Get files that have changed since last index.
   * Uses git status as a fast path when available, falling back to full scan.
   */
  getChangedFiles(): { added: string[]; modified: string[]; removed: string[] } {
    const gitChanges = getGitChangedFiles(this.rootDir, this.config);

    if (gitChanges) {
      // === Git fast path ===
      const added: string[] = [];
      const modified: string[] = [];
      const removed: string[] = [];

      // Deleted files — only report if tracked in DB
      for (const filePath of gitChanges.deleted) {
        const tracked = this.queries.getFileByPath(filePath);
        if (tracked) {
          removed.push(filePath);
        }
      }

      // Modified files — read + hash only these, compare with DB
      for (const filePath of gitChanges.modified) {
        const fullPath = path.join(this.rootDir, filePath);
        let content: string;
        try {
          content = fs.readFileSync(fullPath, 'utf-8');
        } catch (error) {
          logDebug('Skipping unreadable file while detecting changes', { filePath, error: String(error) });
          continue;
        }

        const contentHash = hashContent(content);
        const tracked = this.queries.getFileByPath(filePath);

        if (!tracked) {
          added.push(filePath);
        } else if (tracked.contentHash !== contentHash) {
          modified.push(filePath);
        }
      }

      // Added (untracked) files
      for (const filePath of gitChanges.added) {
        added.push(filePath);
      }

      return { added, modified, removed };
    }

    // === Fallback: full scan (non-git project or git failure) ===
    const currentFiles = new Set(scanDirectory(this.rootDir, this.config));
    const trackedFiles = this.queries.getAllFiles();

    // Build Map for O(1) lookups
    const trackedMap = new Map<string, FileRecord>();
    for (const f of trackedFiles) {
      trackedMap.set(f.path, f);
    }

    const added: string[] = [];
    const modified: string[] = [];
    const removed: string[] = [];

    // Find removed files
    for (const tracked of trackedFiles) {
      if (!currentFiles.has(tracked.path)) {
        removed.push(tracked.path);
      }
    }

    // Find added and modified files
    for (const filePath of currentFiles) {
      const fullPath = path.join(this.rootDir, filePath);
      let content: string;
      try {
        content = fs.readFileSync(fullPath, 'utf-8');
      } catch (error) {
        logDebug('Skipping unreadable file while detecting changes', { filePath, error: String(error) });
        continue;
      }

      const contentHash = hashContent(content);
      const tracked = trackedMap.get(filePath);

      if (!tracked) {
        added.push(filePath);
      } else if (tracked.contentHash !== contentHash) {
        modified.push(filePath);
      }
    }

    return { added, modified, removed };
  }
}

// Re-export useful types and functions
export { extractFromSource } from './tree-sitter';
export { detectLanguage, isLanguageSupported, isGrammarLoaded, getSupportedLanguages, initGrammars, loadGrammarsForLanguages, loadAllGrammars } from './grammars';
