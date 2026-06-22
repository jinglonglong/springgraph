/**
 * Directory Management
 *
 * Manages the .springgraph/ directory structure for Springgraph data.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** The default per-project data directory name. */
const DEFAULT_SPRINGGRAPH_DIR = '.springgraph';

let warnedBadDirName = false;

/**
 * Resolve the per-project data directory name, honoring the `SPRINGGRAPH_DIR`
 * environment override (default `.springgraph`). The override is a single path
 * segment that lives in the project root.
 *
 * Why this exists: two environments that share one working tree must NOT share
 * one `.springgraph/` — most concretely Windows-native and WSL (issue #636). The
 * daemon lockfile (`.springgraph/daemon.pid`) records a platform-specific pid and
 * socket path (a Windows named pipe vs a WSL Unix socket), and SQLite file
 * locking across the WSL2 ↔ Windows filesystem boundary is unreliable, so two
 * daemons sharing one index risks corruption. Setting `SPRINGGRAPH_DIR=.springgraph-win`
 * on one side gives each environment its own index in the same tree.
 *
 * Read live (not captured at load) so it is both process-accurate and testable.
 * An override that isn't a plain directory name — empty, containing a path
 * separator, `.`, `..`/traversal, or absolute — is ignored (we keep the
 * default) rather than risk writing the index outside the project or into the
 * project root itself; we warn once to stderr so the misconfiguration is seen.
 */
export function springgraphDirName(): string {
  const raw = process.env.SPRINGGRAPH_DIR?.trim();
  if (!raw) return DEFAULT_SPRINGGRAPH_DIR;
  const invalid =
    raw === '.' ||
    raw.includes('..') ||
    raw.includes('/') ||
    raw.includes('\\') ||
    path.isAbsolute(raw);
  if (invalid) {
    if (!warnedBadDirName) {
      warnedBadDirName = true;
      // stderr only — stdout is the MCP protocol channel.
      console.warn(
        `[springgraph] Ignoring invalid SPRINGGRAPH_DIR="${raw}" — it must be a plain ` +
          `directory name (no path separators, no "..", not absolute). Using "${DEFAULT_SPRINGGRAPH_DIR}".`
      );
    }
    return DEFAULT_SPRINGGRAPH_DIR;
  }
  return raw;
}

/**
 * Springgraph directory name — a load-time snapshot of {@link springgraphDirName}.
 * A running process's environment is fixed, so this equals the live value;
 * it's kept as a stable string export for backward compatibility. Internal code
 * resolves the name through {@link springgraphDirName} / {@link getSpringgraphDir}
 * so the `SPRINGGRAPH_DIR` override always applies.
 */
export const SPRINGGRAPH_DIR = springgraphDirName();

/**
 * Is `name` (a single path segment) a Springgraph data directory? Matches the
 * default `.springgraph`, the active `SPRINGGRAPH_DIR` override, and any
 * `.springgraph-*` sibling. File-watching and the indexer skip ALL of these, so
 * when two environments share one working tree (Windows + WSL, issue #636)
 * neither indexes or watches the other's index directory.
 */
export function isSpringgraphDataDir(name: string): boolean {
  return (
    name === DEFAULT_SPRINGGRAPH_DIR ||
    name === springgraphDirName() ||
    name.startsWith(DEFAULT_SPRINGGRAPH_DIR + '-')
  );
}

/**
 * Get the .springgraph directory path for a project
 */
export function getSpringgraphDir(projectRoot: string): string {
  return path.join(projectRoot, springgraphDirName());
}

/**
 * Check if a project has been initialized with Springgraph
 * Requires both .springgraph/ directory AND springgraph.db to exist
 */
export function isInitialized(projectRoot: string): boolean {
  const springgraphDir = getSpringgraphDir(projectRoot);
  if (!fs.existsSync(springgraphDir) || !fs.statSync(springgraphDir).isDirectory()) {
    return false;
  }
  // Must have springgraph.db, not just .springgraph folder
  const dbPath = path.join(springgraphDir, 'springgraph.db');
  return fs.existsSync(dbPath);
}

/**
 * Find the nearest parent directory containing .springgraph/
 *
 * Walks up from the given path to find a Springgraph-initialized project,
 * similar to how git finds .git/ directories.
 *
 * @param startPath - Directory to start searching from
 * @returns The project root containing .springgraph/, or null if not found
 */
/**
 * Reason a directory is unsafe to use as an index ROOT, or null when it's fine.
 *
 * Indexing your home directory or a filesystem root drags in caches, `Library`,
 * every other project, etc. — a multi-GB index, constant file-watcher churn, and
 * (pre-1.0 on macOS) a file-descriptor blowup that exhausted `kern.maxfiles` and
 * took unrelated apps / the whole machine down (#845). The classic trigger:
 * running the installer or `springgraph init` from `$HOME`, which auto-indexes the
 * current directory. These are never intended project roots, so the installer
 * and `init`/`index` refuse them (overridable with `--force`).
 *
 * Pure-ish (reads only `os.homedir()` + realpath) so it's easy to unit-test.
 * The returned string is a human phrase that slots into "… looks like {reason}".
 */
export function unsafeIndexRootReason(projectRoot: string): string | null {
  const resolve = (p: string): string => {
    try {
      return fs.realpathSync(path.resolve(p));
    } catch {
      return path.resolve(p);
    }
  };
  const resolved = resolve(projectRoot);

  // Filesystem root: `/` on POSIX, a drive root like `C:\` on Windows.
  if (path.parse(resolved).root === resolved) {
    return 'the filesystem root';
  }

  const home = resolve(os.homedir());
  // Case-insensitive on macOS/Windows (case-preserving but case-insensitive FS).
  const norm = (p: string): string =>
    process.platform === 'darwin' || process.platform === 'win32' ? p.toLowerCase() : p;
  const r = norm(resolved);
  const h = norm(home);

  if (r === h) {
    return 'your home directory';
  }
  // An ancestor of home (e.g. `/Users`, `/home`) — even broader than home.
  if (h.startsWith(r + path.sep)) {
    return 'a parent of your home directory';
  }
  return null;
}

export function findNearestSpringgraphRoot(startPath: string): string | null {
  let current = path.resolve(startPath);
  const root = path.parse(current).root;

  while (current !== root) {
    if (isInitialized(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break; // Reached filesystem root
    current = parent;
  }

  // Check root as well
  if (isInitialized(current)) {
    return current;
  }

  return null;
}

/**
 * Contents of `.springgraph/.gitignore`. A single wildcard ignore keeps every
 * transient file in the index dir — the database, `daemon.pid`, the socket,
 * logs, cache, and anything future versions add — out of git, without having
 * to enumerate each name (issues #788, #492, #484). Older versions wrote an
 * explicit allowlist that never listed `daemon.pid` or the socket, so those
 * runtime files were silently committed.
 */
const GITIGNORE_CONTENT = `# Springgraph data files — local to each machine, not for committing.
# Ignore everything in .springgraph/ except this file itself, so transient
# files (the database, daemon.pid, sockets, logs) never show up in git.
*
!.gitignore
`;

/** Header line that prefixes every .gitignore Springgraph has auto-generated. */
const GITIGNORE_MARKER = '# Springgraph data files';

/**
 * Is `content` a stale Springgraph-generated `.gitignore` that should be
 * regenerated in place? True when it carries our header but predates the
 * wildcard ignore (it has no bare `*` line) — i.e. one of the old explicit
 * allowlists (`*.db`, `cache/`, `.dirty`, …) that never ignored `daemon.pid`
 * or the socket (issue #788). A file WITHOUT our header is user-authored and
 * is left untouched; one that already has the wildcard is current. Matching
 * on the header (not a byte-exact list of past defaults) heals every old
 * variant — v0.7.x through 0.9.9 — and is idempotent once upgraded.
 */
function isStaleDefaultGitignore(content: string): boolean {
  if (!content.trimStart().startsWith(GITIGNORE_MARKER)) return false;
  return !content.split('\n').some((line) => line.trim() === '*');
}

/**
 * Write `.springgraph/.gitignore` if it's absent, or upgrade a stale
 * Springgraph-generated default in place; a user-customized file is left alone.
 * Best-effort — returns `false` only if a needed write failed.
 */
function ensureGitignore(gitignorePath: string): boolean {
  let existing: string | null;
  try {
    existing = fs.readFileSync(gitignorePath, 'utf-8');
  } catch {
    existing = null; // absent (ENOENT) or unreadable — (re)create below
  }
  // Current default or a user-authored file: nothing to do.
  if (existing !== null && !isStaleDefaultGitignore(existing)) return true;
  try {
    fs.writeFileSync(gitignorePath, GITIGNORE_CONTENT, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Create the .springgraph directory structure
 * Note: Only throws if springgraph.db already exists, not just if .springgraph/ exists.
 */
export function createDirectory(projectRoot: string): void {
  const springgraphDir = getSpringgraphDir(projectRoot);
  const dbPath = path.join(springgraphDir, 'springgraph.db');

  // Only throw if Springgraph is actually initialized (db exists)
  // .springgraph/ folder alone is fine
  if (fs.existsSync(dbPath)) {
    throw new Error(`Springgraph already initialized in ${projectRoot}`);
  }

  // Create main directory (if it doesn't exist)
  fs.mkdirSync(springgraphDir, { recursive: true });

  // Write .gitignore inside .springgraph (create if absent, upgrade a stale
  // pre-wildcard default left by an older version — issue #788).
  ensureGitignore(path.join(springgraphDir, '.gitignore'));
}

/**
 * Remove the .springgraph directory
 */
export function removeDirectory(projectRoot: string): void {
  const springgraphDir = getSpringgraphDir(projectRoot);

  if (!fs.existsSync(springgraphDir)) {
    return;
  }

  // Verify .springgraph is a real directory, not a symlink pointing elsewhere
  const lstat = fs.lstatSync(springgraphDir);
  if (lstat.isSymbolicLink()) {
    // Only remove the symlink itself, never follow it for recursive delete
    fs.unlinkSync(springgraphDir);
    return;
  }

  if (!lstat.isDirectory()) {
    // Not a directory - remove the single file
    fs.unlinkSync(springgraphDir);
    return;
  }

  // Recursively remove directory
  fs.rmSync(springgraphDir, { recursive: true, force: true });
}

/**
 * Get all files in the .springgraph directory
 */
export function listDirectoryContents(projectRoot: string): string[] {
  const springgraphDir = getSpringgraphDir(projectRoot);

  if (!fs.existsSync(springgraphDir)) {
    return [];
  }

  const files: string[] = [];

  function walkDir(dir: string, prefix: string = ''): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      // Skip symlinks to prevent following links outside .springgraph
      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        walkDir(path.join(dir, entry.name), relativePath);
      } else {
        files.push(relativePath);
      }
    }
  }

  walkDir(springgraphDir);
  return files;
}

/**
 * Get the total size of the .springgraph directory in bytes
 */
export function getDirectorySize(projectRoot: string): number {
  const springgraphDir = getSpringgraphDir(projectRoot);

  if (!fs.existsSync(springgraphDir)) {
    return 0;
  }

  let totalSize = 0;

  function walkDir(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      // Skip symlinks to prevent following links outside .springgraph
      if (entry.isSymbolicLink()) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else {
        const stats = fs.statSync(fullPath);
        totalSize += stats.size;
      }
    }
  }

  walkDir(springgraphDir);
  return totalSize;
}

/**
 * Ensure a subdirectory exists within .springgraph
 */
export function ensureSubdirectory(projectRoot: string, subdirName: string): string {
  if (subdirName.includes('..') || subdirName.includes(path.sep) || subdirName.includes('/')) {
    throw new Error(`Invalid subdirectory name: ${subdirName}`);
  }

  const subdirPath = path.join(getSpringgraphDir(projectRoot), subdirName);

  if (!fs.existsSync(subdirPath)) {
    fs.mkdirSync(subdirPath, { recursive: true });
  }

  return subdirPath;
}

/**
 * Check if the .springgraph directory has valid structure
 */
export function validateDirectory(projectRoot: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const springgraphDir = getSpringgraphDir(projectRoot);

  if (!fs.existsSync(springgraphDir)) {
    errors.push('Springgraph directory does not exist');
    return { valid: false, errors };
  }

  if (!fs.statSync(springgraphDir).isDirectory()) {
    errors.push('.springgraph exists but is not a directory');
    return { valid: false, errors };
  }

  // Auto-repair / upgrade .gitignore (non-critical file). A missing one is
  // recreated; a stale pre-wildcard default that never ignored daemon.pid is
  // regenerated in place (issue #788); a user-authored file is left alone.
  const gitignorePath = path.join(springgraphDir, '.gitignore');
  const existedBefore = fs.existsSync(gitignorePath);
  if (!ensureGitignore(gitignorePath) && !existedBefore) {
    // Only a missing-and-uncreatable file is surfaced; a failed in-place
    // upgrade of an existing file is non-fatal — the index still works.
    errors.push('.gitignore missing in .springgraph directory and could not be created');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
