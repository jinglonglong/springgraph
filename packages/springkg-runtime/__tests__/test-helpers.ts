import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createMockKg, type MockKg } from '../src/index.js';

const fixtureRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

export async function createTempProject(files: Array<{ fromFixture: string; to: string }>): Promise<string> {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'springkg-runtime-'));
  for (const file of files) {
    const sourcePath = path.join(fixtureRoot, file.fromFixture);
    const targetPath = path.join(projectDir, file.to);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
  }
  return projectDir;
}

export function makeKg(): MockKg {
  return createMockKg();
}

export async function cleanupTempProject(projectDir: string): Promise<void> {
  await fs.rm(projectDir, { recursive: true, force: true });
}
