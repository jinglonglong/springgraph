/**
 * Git-native file enumeration
 *
 * init-performance change, phase 3b
 * (openspec/changes/optimize-initialization-performance).
 *
 * When the project root is inside a git work tree, the file walk
 * is the source of truth for "what is in the project" — and git
 * already enforces `.gitignore` and knows about submodules. So
 * for git projects, running our own `readdir` + ignore-filter
 * walk is redundant work.
 *
 * `gitNativeEnumerate` uses `git ls-files -z -c --recurse-submodules`
 * to get the file list, with `.gitignore` filtering baked in.
 * The caller falls back to the filesystem walk when the project
 * isn't inside a work tree.
 *
 * `git cat-file --batch --buffer` is the natural pairing for
 * reading file content: one syscall per file returns both the
 * blob OID (a strong content key for the cheap-hash skip path)
 * and the file bytes. The orchestrator uses this when
 * `parsePool` is in use so the OID can flow into
 * `BatchStore.append` without a second read.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/** Maximum time `git` is allowed to take for any single invocation.
 *  A pathological repo (huge submodules, deep history) shouldn't
 *  freeze init. 30s is generous for normal projects and a hard
 *  ceiling for degenerate ones. */
const GIT_TIMEOUT_MS = 30_000;

/** Cached `isGitWorkTree` result per rootDir. The result is
 *  constant for a given project root, so cache it. */
const workTreeCache = new Map<string, boolean>();

/**
 * Detect whether `rootDir` is inside a git work tree. Uses
 * `git rev-parse --is-inside-work-tree` which exits 0 when inside
 * a work tree (and prints "true"). Cached per rootDir.
 */
export async function isGitWorkTree(rootDir: string): Promise<boolean> {
  const cached = workTreeCache.get(rootDir);
  if (cached !== undefined) return cached;
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-parse', '--is-inside-work-tree'],
      { cwd: rootDir, timeout: GIT_TIMEOUT_MS }
    );
    const result = stdout.trim() === 'true';
    workTreeCache.set(rootDir, result);
    return result;
  } catch {
    workTreeCache.set(rootDir, false);
    return false;
  }
}

/** Result of gitNativeEnumerate. */
export interface GitFile {
  /** Path relative to rootDir, using forward slashes (git's
   *  convention; we normalize to platform native on read). */
  path: string;
}

/**
 * Enumerate tracked files in a git work tree. Throws if `rootDir`
 * is not inside a work tree — the caller is expected to gate on
 * `isGitWorkTree()` first and fall back to the filesystem walk
 * otherwise.
 *
 * Uses `git ls-files -z -c --recurse-submodules`:
 *   - `-z`           NUL-delimited output (avoids quoting issues)
 *   - `-c`           cached (uses the index, not a fresh scan)
 *   - `--recurse-submodules`  include files inside submodules
 *
 * Output is a single line per file. We do NOT pass `-o` (others /
 * untracked) or `--exclude-standard`; we want exactly what git
 * tracks, which is what the init should reflect.
 */
export async function gitNativeEnumerate(rootDir: string): Promise<GitFile[]> {
  // Sanity: refuse to call git ls-files if we're not in a work
  // tree. `isGitWorkTree` is cached; the second call is cheap.
  if (!(await isGitWorkTree(rootDir))) {
    throw new Error(
      `gitNativeEnumerate: ${rootDir} is not inside a git work tree`
    );
  }
  const { stdout } = await execFileAsync(
    'git',
    ['ls-files', '-z', '-c', '--recurse-submodules'],
    { cwd: rootDir, timeout: GIT_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 }
  );
  // -z separates with NUL, not newline. Filter out the trailing
  // empty entry (NUL-terminated lists always have one).
  const files = stdout.split('\0').filter((s) => s.length > 0);
  return files.map((path) => ({ path }));
}
