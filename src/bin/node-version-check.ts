/**
 * Node.js version compatibility check.
 *
 * Node 25.x has a V8 turboshaft WASM JIT Zone allocator bug that
 * reliably crashes Springgraph with `Fatal process out of memory: Zone`
 * during tree-sitter grammar compilation. This module owns the
 * user-facing banner shown before exit. Kept side-effect-free so it's
 * safe to import from tests without triggering CLI bootstrap.
 */

/**
 * Build the bordered banner shown when Springgraph detects an
 * unsupported Node.js major version (currently 25+). Pinned via unit
 * test so the recovery commands and override instructions can't be
 * silently stripped by future edits.
 *
 * Uses ASCII glyphs to stay readable on Windows OEM-codepage consoles
 * (see ../ui/glyphs.ts for the rationale).
 */
export function buildNode25BlockBanner(nodeVersion: string): string {
  const sep = '-'.repeat(72);
  return [
    sep,
    `[Springgraph] Unsupported Node.js version: ${nodeVersion}`,
    sep,
    'Node.js 25.x has a V8 WASM JIT (turboshaft) Zone allocator bug that',
    'crashes with `Fatal process out of memory: Zone` when Springgraph',
    'compiles tree-sitter grammars. Springgraph WILL crash on this Node',
    'version mid-indexing. See https://github.com/jinglonglong/springgraph/issues/81',
    '',
    'Fix: install Node.js 22 LTS:',
    '  nvm install 22 && nvm use 22                          # nvm',
    '  brew install node@22 && brew link --overwrite --force node@22  # Homebrew',
    '',
    'To override (NOT recommended - you will likely OOM):',
    '  SPRINGGRAPH_ALLOW_UNSAFE_NODE=1 springgraph ...',
    sep,
  ].join('\n');
}

/**
 * Lowest supported Node.js major version. Matches the `engines` floor in
 * package.json. Below this, Springgraph relies on language features / native APIs
 * that aren't present, and the combination is untested. `engines` alone only
 * *warns* on install (unless the user set `engine-strict`), so the CLI bootstrap
 * also hard-blocks here to actually enforce the floor.
 */
export const MIN_NODE_MAJOR = 20;

/**
 * Build the bordered banner shown when Springgraph detects a Node.js major below
 * {@link MIN_NODE_MAJOR}. Pinned via unit test so the recovery commands and the
 * override env var can't be silently stripped by future edits.
 *
 * Uses ASCII glyphs to stay readable on Windows OEM-codepage consoles
 * (see ../ui/glyphs.ts for the rationale).
 */
export function buildNodeTooOldBanner(nodeVersion: string): string {
  const sep = '-'.repeat(72);
  return [
    sep,
    `[Springgraph] Unsupported Node.js version: ${nodeVersion}`,
    sep,
    `Springgraph requires Node.js ${MIN_NODE_MAJOR} or newer. Older versions lack`,
    'language features and native APIs Springgraph depends on, and are not',
    'tested or supported.',
    '',
    'Fix: install Node.js 22 LTS:',
    '  nvm install 22 && nvm use 22                          # nvm',
    '  brew install node@22 && brew link --overwrite --force node@22  # Homebrew',
    '',
    'To override (NOT recommended - unsupported):',
    '  SPRINGGRAPH_ALLOW_UNSAFE_NODE=1 springgraph ...',
    sep,
  ].join('\n');
}
