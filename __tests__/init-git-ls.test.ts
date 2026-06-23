/**
 * Git-native enumeration tests.
 *
 * init-performance change, phase 3b
 * (openspec/changes/optimize-initialization-performance).
 *
 * Exercises `isGitWorkTree` and `gitNativeEnumerate` against a
 * real (temp) git repository. Skipped on machines where `git`
 * isn't on PATH (CI runners should have it; local dev machines
 * almost always do).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isGitWorkTree, gitNativeEnumerate } from '../src/extraction/git-ls';

/** True when `git` is on PATH. The functions in src/extraction/git-ls
 *  shell out to `git` for every call, so the tests are not
 *  meaningful without it. */
function hasGit(): boolean {
  const r = spawnSync('git', ['--version'], { stdio: 'ignore' });
  return r.status === 0;
}

const HAS_GIT = hasGit();

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'springgraph-git-ls-'));
}

function cleanupTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

function runGit(args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
  });
  return {
    status: r.status ?? -1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

/** Set up a real git work tree at `dir` with a few tracked files.
 *  git refuses to commit without a user.name + user.email so we
 *  set them locally. The --initial-branch=main flag keeps the
 *  initial branch name stable across git versions. */
function initRepoWithFiles(
  dir: string,
  files: { path: string; content: string }[]
): void {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of files) {
    const full = path.join(dir, f.path);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, f.content);
  }
  const env = {
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  };
  const r1 = runGit(
    [
      '-c', 'init.defaultBranch=main',
      '-c', 'user.name=test',
      '-c', 'user.email=test@example.com',
      'init',
      '.',
    ],
    dir
  );
  if (r1.status !== 0) throw new Error(`git init failed: ${r1.stderr}`);
  const r2 = runGit(['add', '.'], dir);
  if (r2.status !== 0) throw new Error(`git add failed: ${r2.stderr}`);
  const r3 = runGit(
    [
      '-c', 'user.name=test',
      '-c', 'user.email=test@example.com',
      'commit',
      '-m', 'initial',
    ],
    dir
  );
  if (r3.status !== 0) throw new Error(`git commit failed: ${r3.stderr}`);
  // Unused but keeps the env-var block above honest.
  void env;
}

describe.skipIf(!HAS_GIT)('git-native enumeration (phase 3b)', () => {
  let workTreeDir: string;
  let nonWorkTreeDir: string;

  beforeEach(() => {
    workTreeDir = makeTempDir();
    nonWorkTreeDir = makeTempDir();
    initRepoWithFiles(workTreeDir, [
      { path: 'src/A.java', content: 'class A {}' },
      { path: 'src/B.java', content: 'class B {}' },
      { path: 'config.yml', content: 'key: value\n' },
      { path: 'README.md', content: '# repo\n' },
    ]);
  });

  afterEach(() => {
    cleanupTempDir(workTreeDir);
    cleanupTempDir(nonWorkTreeDir);
  });

  it('isGitWorkTree returns true for a real work tree', async () => {
    expect(await isGitWorkTree(workTreeDir)).toBe(true);
  });

  it('isGitWorkTree returns false for a non-git directory', async () => {
    expect(await isGitWorkTree(nonWorkTreeDir)).toBe(false);
  });

  it('gitNativeEnumerate returns all tracked files in a work tree', async () => {
    const files = await gitNativeEnumerate(workTreeDir);
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual([
      'README.md',
      'config.yml',
      'src/A.java',
      'src/B.java',
    ]);
  });

  it('gitNativeEnumerate excludes untracked files', async () => {
    fs.writeFileSync(path.join(workTreeDir, 'untracked.txt'), 'untracked');
    const files = await gitNativeEnumerate(workTreeDir);
    const paths = files.map((f) => f.path);
    expect(paths).not.toContain('untracked.txt');
  });

  it('gitNativeEnumerate respects .gitignore for untracked paths', async () => {
    // Write .gitignore BEFORE creating the file so git sees the
    // rule, then create the file in a .gitignore-d path. The
    // file is never staged, so `git ls-files -c` should not
    // return it. The previous test covered the untracked case
    // generally; this one specifically exercises the .gitignore
    // path.
    fs.writeFileSync(path.join(workTreeDir, '.gitignore'), 'ignored/\n');
    fs.mkdirSync(path.join(workTreeDir, 'ignored'), { recursive: true });
    fs.writeFileSync(path.join(workTreeDir, 'ignored/x.java'), 'class X {}');
    const files = await gitNativeEnumerate(workTreeDir);
    const paths = files.map((f) => f.path);
    expect(paths).not.toContain('ignored/x.java');
  });

  it('gitNativeEnumerate throws outside a work tree', async () => {
    await expect(gitNativeEnumerate(nonWorkTreeDir)).rejects.toThrow(
      /not inside a git work tree/
    );
  });

  it('isGitWorkTree caches its result for a given rootDir', async () => {
    // First call: populates the cache.
    const first = await isGitWorkTree(workTreeDir);
    // Second call: served from cache; should still be the right
    // answer. We don't have a way to directly observe the cache
    // hit, but the function is called many times by the
    // orchestrator and the cache is the reason the second+ calls
    // are cheap. The main value of this test is that the second
    // call doesn't throw or flip the answer.
    const second = await isGitWorkTree(workTreeDir);
    expect(first).toBe(second);
  });
});

describe('git-native enumeration (no git on PATH)', () => {
  it.skipIf(HAS_GIT)('is skipped when git is not available', () => {
    expect(true).toBe(true);
  });
});
