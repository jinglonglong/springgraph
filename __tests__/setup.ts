import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const isWindows = process.platform === 'win32';
export const isMacOS = process.platform === 'darwin';
export const isLinux = process.platform === 'linux';
export const isPosix = !isWindows;

export const platformGate = {
  windows: isWindows,
  posix: isPosix,
  macos: isMacOS,
  linux: isLinux,
};

export function makeTmpDir(prefix = 'springkg-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function tmpPath(dir: string, ...parts: string[]): string {
  return path.join(dir, ...parts);
}

export function setTmpHome(): () => void {
  const realHome = process.env.HOME;
  const tmp = makeTmpDir('springkg-home-');
  process.env.HOME = tmp;
  return () => {
    if (realHome === undefined) delete process.env.HOME;
    else process.env.HOME = realHome;
  };
}
