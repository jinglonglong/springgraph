/**
 * Check whether the current module is the entry point of the process.
 */
import * as path from 'path';

export function isMainModule(_importMetaUrl: string, currentFilePath: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;

  let entryPath: string;
  try {
    entryPath = path.resolve(entry);
  } catch {
    return false;
  }

  const currentPath = path.resolve(currentFilePath);

  if (entryPath === currentPath) return true;

  // Compare basenames (dist/index.js entry vs src/index.ts)
  const entryBase = path.basename(entryPath).replace(/\.js$/, '');
  const currentBase = path.basename(currentPath).replace(/\.ts$/, '').replace(/\.js$/, '');
  return entryBase === currentBase;
}
