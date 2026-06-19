/**
 * Check whether the current module is the entry point of the process.
 *
 * Used by bin shims to auto-run the CLI only when invoked directly,
 * not when imported as a library.
 */
import * as path from 'path';

export function isMainModule(importMetaUrl: string, currentFilePath: string): boolean {
  // If process.argv[1] is missing, we're not the entry (e.g. library import)
  const entry = process.argv[1];
  if (!entry) return false;

  // Resolve both to absolute paths for comparison
  let entryPath: string;
  try {
    entryPath = path.resolve(entry);
  } catch {
    return false;
  }

  const currentPath = path.resolve(currentFilePath);

  // Direct match
  if (entryPath === currentPath) return true;

  // The .js extension is stripped during compilation, so compare basenames
  // (e.g. dist/index.js entry vs src/index.ts file)
  const entryBase = path.basename(entryPath).replace(/\.js$/, '');
  const currentBase = path.basename(currentPath).replace(/\.ts$/, '').replace(/\.js$/, '');
  if (entryBase === currentBase) return true;

  // Also check if argv[1] points to our bin shim
  // (e.g. dist/bin/springkg.js → ../index.js)
  if (entryPath.endsWith(path.join('bin', 'springkg.js'))) {
    const caller = path.resolve(path.dirname(entryPath), '..', 'index.js');
    if (caller === currentPath) return true;
  }

  // Fallback: check if import.meta.url is referenced as main
  void importMetaUrl;
  return false;
}
