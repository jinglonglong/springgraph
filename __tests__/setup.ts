import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ChildProcess } from 'child_process';
import { afterEach, afterAll } from 'vitest';
import { DatabaseConnection } from '../src/db/index';

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

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForProcessExit(pid: number, timeoutMs = 5000, pollMs = 50): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await sleep(pollMs);
  }
  return false;
}

export async function waitForChildExit(child: ChildProcess, timeoutMs = 5000): Promise<boolean> {
  const pid = child.pid;
  if (!pid) {
    return true;
  }

  if (child.exitCode !== null || child.signalCode !== null) {
    return true;
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('exit', onExit);
      resolve(value);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(async () => {
      finish(await waitForProcessExit(pid, 0));
    }, timeoutMs);
    child.once('exit', onExit);
  });
}

export async function terminateChild(child: ChildProcess | null | undefined, graceMs = 5000): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  try {
    child.kill('SIGTERM');
  } catch {
    return;
  }

  if (await waitForChildExit(child, graceMs)) {
    return;
  }

  try {
    child.kill('SIGKILL');
  } catch {
    return;
  }

  await waitForChildExit(child, graceMs);
}

export async function safeCloseCodeGraph(cg: { close?: () => unknown; destroy?: () => unknown } | null | undefined): Promise<void> {
  if (!cg) return;

  try {
    const closeResult = cg.close?.() ?? cg.destroy?.();
    await Promise.resolve(closeResult);
  } catch {}

  await sleep(100);
}

export async function removeDirWithRetries(dir: string | null | undefined, retries = 12, delayMs = 100): Promise<void> {
  if (!dir || !fs.existsSync(dir)) {
    return;
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      const code = typeof error === 'object' && error && 'code' in error
        ? String((error as NodeJS.ErrnoException).code)
        : '';
      if (attempt === retries || (code !== 'EBUSY' && code !== 'ENOTEMPTY' && code !== 'EPERM')) {
        throw error;
      }
      await sleep(delayMs * (attempt + 1));
    }
  }

  throw lastError;
}

afterAll(async () => {
  try {
    DatabaseConnection.closeAll();
  } catch {}

  try {
    const { SpringDatabase } = await import('../packages/springkg-core/src/db/spring-db.js');
    SpringDatabase.closeAll();
  } catch {}
});
