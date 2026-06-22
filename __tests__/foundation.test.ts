/**
 * Foundation Tests
 *
 * Tests for the Springgraph foundation layer.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Springgraph } from '../src';
import { Node, Edge } from '../src/types';
import { isInitialized, getSpringgraphDir, validateDirectory, springgraphDirName, isSpringgraphDataDir } from '../src/directory';
import { DatabaseConnection, getDatabasePath } from '../src/db';

// Create a temporary directory for each test
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'springgraph-test-'));
}

// Clean up temporary directory
function cleanupTempDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('Springgraph Foundation', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe('Initialization', () => {
    it('should initialize a new project', () => {
      const cg = Springgraph.initSync(tempDir);

      expect(Springgraph.isInitialized(tempDir)).toBe(true);
      expect(fs.existsSync(getSpringgraphDir(tempDir))).toBe(true);
      expect(fs.existsSync(getDatabasePath(tempDir))).toBe(true);

      cg.close();
    });

    it('should create .gitignore in .Springgraph directory', () => {
      const cg = Springgraph.initSync(tempDir);

      const gitignorePath = path.join(getSpringgraphDir(tempDir), '.gitignore');
      expect(fs.existsSync(gitignorePath)).toBe(true);

      const content = fs.readFileSync(gitignorePath, 'utf-8');
      // Ignore everything in .springgraph/ except this file itself, so transient
      // files (db, daemon.pid, sockets, logs) never show up in git. (#492, #484)
      expect(content).toContain('*');
      expect(content).toContain('!.gitignore');

      cg.close();
    });

    it('should throw if already initialized', () => {
      const cg = Springgraph.initSync(tempDir);
      cg.close();

      expect(() => Springgraph.initSync(tempDir)).toThrow(/already initialized/i);
    });
  });

  describe('Opening Projects', () => {
    it('should open an existing project', () => {
      // First initialize
      const cg1 = Springgraph.initSync(tempDir);
      cg1.close();

      // Then open
      const cg2 = Springgraph.openSync(tempDir);
      expect(cg2.getProjectRoot()).toBe(path.resolve(tempDir));
      cg2.close();
    });

    it('should throw if not initialized', () => {
      expect(() => Springgraph.openSync(tempDir)).toThrow(/not initialized/i);
    });
  });

  describe('Static Methods', () => {
    it('isInitialized should return false for new directory', () => {
      expect(Springgraph.isInitialized(tempDir)).toBe(false);
    });

    it('isInitialized should return true after init', () => {
      const cg = Springgraph.initSync(tempDir);
      expect(Springgraph.isInitialized(tempDir)).toBe(true);
      cg.close();
    });
  });

  describe('Database', () => {
    it('should create database with correct schema', () => {
      const cg = Springgraph.initSync(tempDir);

      // Check that we can get stats (requires tables to exist)
      const stats = cg.getStats();
      expect(stats.nodeCount).toBe(0);
      expect(stats.edgeCount).toBe(0);
      expect(stats.fileCount).toBe(0);

      cg.close();
    });

    it('should return correct database size', () => {
      const cg = Springgraph.initSync(tempDir);
      const stats = cg.getStats();

      // Database should have some size (at least the schema)
      expect(stats.dbSizeBytes).toBeGreaterThan(0);

      cg.close();
    });

    it('should support optimize operation', () => {
      const cg = Springgraph.initSync(tempDir);

      // Should not throw
      expect(() => cg.optimize()).not.toThrow();

      cg.close();
    });

    it('should support clear operation', () => {
      const cg = Springgraph.initSync(tempDir);

      // Should not throw
      expect(() => cg.clear()).not.toThrow();

      const stats = cg.getStats();
      expect(stats.nodeCount).toBe(0);

      cg.close();
    });
  });

  describe('Directory Management', () => {
    it('should validate directory structure', () => {
      const cg = Springgraph.initSync(tempDir);
      cg.close();

      const validation = validateDirectory(tempDir);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should detect invalid directory', () => {
      const validation = validateDirectory(tempDir);
      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });

    it('upgrades a stale pre-wildcard .gitignore in place (issue #788)', () => {
      const cg = Springgraph.initSync(tempDir);
      cg.close();

      const gitignorePath = path.join(getSpringgraphDir(tempDir), '.gitignore');
      // A .gitignore written by an older version (<= 0.9.9): an explicit
      // allowlist that never ignored daemon.pid, so the daemon's runtime
      // pidfile got committed.
      const staleV099 =
        '# Springgraph data files\n' +
        '# These are local to each machine and should not be committed\n\n' +
        '# Database\n*.db\n*.db-wal\n*.db-shm\n\n' +
        '# Cache\ncache/\n\n# Logs\n*.log\n\n# Hook markers\n.dirty\n';
      fs.writeFileSync(gitignorePath, staleV099, 'utf-8');

      // Opening the project runs validateDirectory, which self-heals.
      const cg2 = Springgraph.openSync(tempDir);
      cg2.close();

      const upgraded = fs.readFileSync(gitignorePath, 'utf-8');
      expect(upgraded).toContain('\n*\n'); // wildcard ignores everything…
      expect(upgraded).toContain('!.gitignore'); // …except this file
      expect(upgraded).not.toContain('.dirty'); // old explicit list is gone
    });

    it('leaves a user-customized .springgraph/.gitignore untouched', () => {
      const cg = Springgraph.initSync(tempDir);
      cg.close();

      const gitignorePath = path.join(getSpringgraphDir(tempDir), '.gitignore');
      // No Springgraph header → user-authored → must not be rewritten.
      const custom = '# my own rules\n*.db\n!keep-this.json\n';
      fs.writeFileSync(gitignorePath, custom, 'utf-8');

      const cg2 = Springgraph.openSync(tempDir);
      cg2.close();

      expect(fs.readFileSync(gitignorePath, 'utf-8')).toBe(custom);
    });
  });

  describe('Uninitialize', () => {
    it('should remove .Springgraph directory', () => {
      const cg = Springgraph.initSync(tempDir);

      cg.uninitialize();

      expect(fs.existsSync(getSpringgraphDir(tempDir))).toBe(false);
      expect(Springgraph.isInitialized(tempDir)).toBe(false);
    });
  });

  describe('Close/Destroy', () => {
    it('should close database but keep .Springgraph directory', () => {
      const cg = Springgraph.initSync(tempDir);

      cg.destroy(); // destroy is alias for close

      expect(fs.existsSync(getSpringgraphDir(tempDir))).toBe(true);
      expect(Springgraph.isInitialized(tempDir)).toBe(true);
    });
  });

  describe('Graph Query Methods', () => {
    it('should throw "Node not found" for non-existent nodes', () => {
      const cg = Springgraph.initSync(tempDir);

      // getContext throws for non-existent nodes
      expect(() => cg.getContext('non-existent')).toThrow(/not found/i);

      cg.close();
    });

    it('should return empty results for non-existent nodes', () => {
      const cg = Springgraph.initSync(tempDir);

      // These methods return empty results instead of throwing
      const traverseResult = cg.traverse('non-existent');
      expect(traverseResult.nodes.size).toBe(0);

      const callGraph = cg.getCallGraph('non-existent');
      expect(callGraph.nodes.size).toBe(0);

      const typeHierarchy = cg.getTypeHierarchy('non-existent');
      expect(typeHierarchy.nodes.size).toBe(0);

      const usages = cg.findUsages('non-existent');
      expect(usages.length).toBe(0);

      cg.close();
    });

  });
});

describe('Database Connection', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it('should initialize new database', () => {
    const dbPath = path.join(tempDir, 'test.db');
    const db = DatabaseConnection.initialize(dbPath);

    expect(db.isOpen()).toBe(true);
    expect(fs.existsSync(dbPath)).toBe(true);

    db.close();
  });

  it('should get schema version', () => {
    const dbPath = path.join(tempDir, 'test.db');
    const db = DatabaseConnection.initialize(dbPath);

    const version = db.getSchemaVersion();
    expect(version).not.toBeNull();
    expect(version?.version).toBe(6);

    db.close();
  });

  it('should support transactions', () => {
    const dbPath = path.join(tempDir, 'test.db');
    const db = DatabaseConnection.initialize(dbPath);

    const result = db.transaction(() => {
      return 42;
    });

    expect(result).toBe(42);

    db.close();
  });

  it('should throw when opening non-existent database', () => {
    const dbPath = path.join(tempDir, 'nonexistent.db');

    expect(() => DatabaseConnection.open(dbPath)).toThrow(/not found/i);
  });
});

describe('Query Builder', () => {
  let tempDir: string;
  let cg: Springgraph;

  beforeEach(() => {
    tempDir = createTempDir();
    cg = Springgraph.initSync(tempDir);
  });

  afterEach(() => {
    cg.close();
    cleanupTempDir(tempDir);
  });

  it('should return null for non-existent node', () => {
    const node = cg.getNode('nonexistent');
    expect(node).toBeNull();
  });

  it('should return empty array for nodes in non-existent file', () => {
    const nodes = cg.getNodesInFile('nonexistent.ts');
    expect(nodes).toEqual([]);
  });

  it('should return empty array for edges from non-existent node', () => {
    const edges = cg.getOutgoingEdges('nonexistent');
    expect(edges).toEqual([]);
  });

  it('should return null for non-existent file', () => {
    const file = cg.getFile('nonexistent.ts');
    expect(file).toBeNull();
  });

  it('should return empty array for files when none tracked', () => {
    const files = cg.getFiles();
    expect(files).toEqual([]);
  });
});

// Two environments that share one working tree (Windows-native + WSL) must not
// share one `.springgraph/`. SPRINGGRAPH_DIR overrides the data directory name so
// each side keeps its own index in the same tree (issue #636).
describe('SPRINGGRAPH_DIR override (#636)', () => {
  const saved = process.env.SPRINGGRAPH_DIR;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'springgraph-dirname-'));
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.SPRINGGRAPH_DIR;
    else process.env.SPRINGGRAPH_DIR = saved;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('springgraphDirName()', () => {
    it('defaults to .springgraph when unset', () => {
      delete process.env.SPRINGGRAPH_DIR;
      expect(springgraphDirName()).toBe('.springgraph');
    });

    it('honors a valid override', () => {
      process.env.SPRINGGRAPH_DIR = '.springgraph-win';
      expect(springgraphDirName()).toBe('.springgraph-win');
    });

    // Anything that isn't a plain segment could escape the project root or
    // clobber it, so it's ignored in favor of the default.
    it.each(['foo/bar', 'a\\b', '..', '../x', '.', '/abs/path', '   ', ''])(
      'falls back to .springgraph for invalid value %j',
      (bad) => {
        process.env.SPRINGGRAPH_DIR = bad;
        expect(springgraphDirName()).toBe('.springgraph');
      }
    );
  });

  describe('isSpringgraphDataDir()', () => {
    it('matches the default, the active override, and .springgraph-* siblings', () => {
      process.env.SPRINGGRAPH_DIR = '.springgraph-win';
      expect(isSpringgraphDataDir('.springgraph')).toBe(true);       // the other env's dir
      expect(isSpringgraphDataDir('.springgraph-win')).toBe(true);   // active override
      expect(isSpringgraphDataDir('.springgraph-wsl')).toBe(true);   // any sibling
    });

    it('does not match unrelated directories', () => {
      delete process.env.SPRINGGRAPH_DIR;
      for (const name of ['src', 'node_modules', '.git', 'springgraph', '.springgraphextra']) {
        expect(isSpringgraphDataDir(name)).toBe(false);
      }
    });
  });

  it('init writes the index under the overridden directory, not .springgraph', () => {
    process.env.SPRINGGRAPH_DIR = '.springgraph-win';
    const cg = Springgraph.initSync(tempDir);
    try {
      expect(fs.existsSync(path.join(tempDir, '.springgraph-win', 'springgraph.db'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, '.springgraph'))).toBe(false);
      expect(getSpringgraphDir(tempDir)).toBe(path.join(tempDir, '.springgraph-win'));
      expect(Springgraph.isInitialized(tempDir)).toBe(true);
    } finally {
      cg.close();
    }
  });

  it('two index dirs coexist in one tree and the override side skips the sibling', async () => {
    // WSL side: default `.springgraph`, with a source file.
    delete process.env.SPRINGGRAPH_DIR;
    fs.writeFileSync(path.join(tempDir, 'app.ts'), 'export function onlyReal() {}\n');
    const wsl = await Springgraph.init(tempDir, { index: true });
    wsl.close();

    // Windows side: override dir, same tree. Plant a decoy source file INSIDE
    // the WSL data dir — the override-side index must not pick it up.
    process.env.SPRINGGRAPH_DIR = '.springgraph-win';
    fs.writeFileSync(path.join(tempDir, '.springgraph', 'decoy.ts'), 'export function decoyLeak() {}\n');
    const win = await Springgraph.init(tempDir, { index: true });
    try {
      expect(fs.existsSync(path.join(tempDir, '.springgraph', 'springgraph.db'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, '.springgraph-win', 'springgraph.db'))).toBe(true);
      expect(win.searchNodes('onlyReal').length).toBeGreaterThan(0);
      expect(win.searchNodes('decoyLeak')).toEqual([]); // sibling data dir not indexed
    } finally {
      win.close();
    }
  });
});
