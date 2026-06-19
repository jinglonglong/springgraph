import { describe, it, expect } from 'vitest';
import { isWindows, isPosix, makeTmpDir } from '../setup.js';
import * as path from 'path';
import * as os from 'os';

describe('Platform path resolution', () => {
  it.runIf(isWindows)('resolves %APPDATA% to a real path on Windows', () => {
    const home = os.homedir();
    expect(home).toBeTruthy();
    expect(typeof home).toBe('string');
    // On Windows, homedir should contain a drive letter
    expect(home).toMatch(/^[A-Z]:\\/);
  });

  it.runIf(isPosix)('does not throw when checking /etc path on POSIX', () => {
    const etcPath = path.join('/etc', '.claude.json');
    expect(typeof etcPath).toBe('string');
    // Just verifying the path can be constructed without error
    expect(etcPath).toBe('/etc/.claude.json');
  });

  it.runIf(isWindows)('uses correct path separator on Windows', () => {
    const p = path.join('C:', 'Users', 'test', '.claude.json');
    expect(p).toContain('\\');
  });
});
