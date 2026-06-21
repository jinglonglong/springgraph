#!/usr/bin/env node

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const JS_EXTENSION = '.js';
const RELATIVE_SPECIFIER_RE = /((?:import|export)\s+(?:[^;'"\n]*?\s+from\s+)?|import\s*\()(["'])(\.{1,2}\/[^"']+)(\2)/g;

async function collectJsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectJsFiles(fullPath));
      continue;
    }

    if (entry.isFile() && fullPath.endsWith(JS_EXTENSION)) {
      files.push(fullPath);
    }
  }

  return files;
}

function shouldRewrite(specifier) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return false;
  }

  if (/\.(?:[cm]?js|json|node|wasm|css|sql|svg|png|jpe?g|gif|map)$/i.test(specifier)) {
    return false;
  }

  return true;
}

function rewriteImports(source) {
  return source.replace(RELATIVE_SPECIFIER_RE, (match, prefix, quote, specifier, suffix) => {
    if (!shouldRewrite(specifier)) {
      return match;
    }

    return `${prefix}${quote}${specifier}.js${suffix}`;
  });
}

async function patchFile(filePath) {
  const original = await readFile(filePath, 'utf8');
  const updated = rewriteImports(original);

  if (updated !== original) {
    await writeFile(filePath, updated, 'utf8');
  }
}

async function main() {
  const targetArg = process.argv[2];

  if (!targetArg) {
    throw new Error('Usage: node fix-esm-extensions.mjs <dist-directory>');
  }

  const distDir = path.resolve(process.cwd(), targetArg);
  const distStat = await stat(distDir).catch(() => null);

  if (!distStat || !distStat.isDirectory()) {
    throw new Error(`Dist directory not found: ${distDir}`);
  }

  const jsFiles = await collectJsFiles(distDir);
  await Promise.all(jsFiles.map((filePath) => patchFile(filePath)));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
