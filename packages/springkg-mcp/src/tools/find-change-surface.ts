import * as path from 'node:path';
import type { SpringKg } from '@colbymchenry/springkg-core';
import { fmtLocation, notFoundResult, textResult } from '../lib/format.js';

interface SurfaceSymbolRow {
  id: string;
  kind: string;
  name: string | null;
  qualified_name: string | null;
  file_path: string | null;
  start_line: number | null;
}

export async function handleFindChangeSurface(
  sk: SpringKg,
  args: Record<string, unknown> | undefined,
): Promise<{ content: ReadonlyArray<{ type: 'text'; text: string }> }> {
  const files = Array.isArray(args?.files)
    ? args.files.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  const depth = typeof args?.depth === 'number' ? Math.max(1, Math.min(4, args.depth)) : 2;

  if (files.length === 0) {
    return textResult(
      '## spring_find_change_surface\n\n'
      + 'Required input: `{ "files": ["src/..."], "depth"?: 1-4 }`.\n\n'
      + 'Returns changed symbols, affected downstream/upstream code, related endpoints, and candidate tests.',
    );
  }

  const db = sk.db.getDb();
  const changedSymbols = collectSymbolsForFiles(db, files);
  if (changedSymbols.length === 0) {
    return notFoundResult('spring_find_change_surface', 'indexed symbols for the changed files');
  }

  const affectedSymbols = traverseImpact(db, changedSymbols.map((symbol) => symbol.id), depth);
  const endpointIds = new Set<string>();
  for (const symbol of [...changedSymbols, ...affectedSymbols]) {
    const endpoints = db.prepare(
      'SELECT method, path, source_file_path, source_line, handler_class_id, handler_method_id FROM spring_endpoints WHERE handler_class_id = ? OR handler_method_id = ? LIMIT 20',
    ).all(symbol.id, symbol.id) as Array<{ method: string; path: string; source_file_path: string; source_line: number }>;
    for (const endpoint of endpoints) {
      endpointIds.add(`${endpoint.method} ${endpoint.path} — ${fmtLocation(endpoint.source_file_path, endpoint.source_line)}`);
    }
  }

  const testCandidates = inferTestCandidates(files, changedSymbols, affectedSymbols);
  const sections: string[] = [];
  sections.push(`## Changed Files\n\n${files.map((file) => `- ${file}`).join('\n')}`);
  sections.push(`## Affected Symbols\n\n${[...changedSymbols, ...affectedSymbols].map((symbol) => `- \`${symbol.qualified_name || symbol.name || symbol.id}\` (${symbol.kind}) — ${fmtLocation(symbol.file_path, symbol.start_line)}`).join('\n')}`);
  sections.push(
    endpointIds.size > 0
      ? `## Endpoints\n\n${Array.from(endpointIds).map((endpoint) => `- ${endpoint}`).join('\n')}`
      : '## Endpoints\n\n_No HTTP endpoints were directly connected to the changed surface._',
  );
  sections.push(
    testCandidates.length > 0
      ? `## Suggested Tests\n\n${testCandidates.map((candidate) => `- ${candidate}`).join('\n')}`
      : '## Suggested Tests\n\n_No indexed test candidates were inferred from the changed files._',
  );

  return textResult(sections.join('\n\n'));
}

function collectSymbolsForFiles(db: ReturnType<SpringKg['db']['getDb']>, files: ReadonlyArray<string>): SurfaceSymbolRow[] {
  const seen = new Map<string, SurfaceSymbolRow>();
  for (const file of files) {
    const rows = db.prepare(
      'SELECT id, kind, name, qualified_name, file_path, start_line FROM spring_symbols WHERE file_path = ? OR file_path LIKE ? ORDER BY start_line LIMIT 50',
    ).all(file, `%${path.basename(file)}%`) as SurfaceSymbolRow[];
    for (const row of rows) {
      seen.set(row.id, row);
    }
  }
  return Array.from(seen.values());
}

function traverseImpact(
  db: ReturnType<SpringKg['db']['getDb']>,
  rootIds: ReadonlyArray<string>,
  depth: number,
): SurfaceSymbolRow[] {
  const queue = rootIds.map((id) => ({ id, level: 0 }));
  const visited = new Set(rootIds);
  const collected = new Map<string, SurfaceSymbolRow>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.level >= depth) {
      continue;
    }

    const edges = db.prepare(
      `SELECT source_id, target_id
       FROM spring_edges
       WHERE source_id = ? OR target_id = ?
       LIMIT 100`,
    ).all(current.id, current.id) as Array<{ source_id: string; target_id: string }>;

    for (const edge of edges) {
      for (const nextId of [edge.source_id, edge.target_id]) {
        if (visited.has(nextId)) {
          continue;
        }
        visited.add(nextId);
        const symbol = db.prepare(
          'SELECT id, kind, name, qualified_name, file_path, start_line FROM spring_symbols WHERE id = ? LIMIT 1',
        ).get(nextId) as SurfaceSymbolRow | undefined;
        if (!symbol) {
          continue;
        }
        collected.set(symbol.id, symbol);
        queue.push({ id: symbol.id, level: current.level + 1 });
      }
    }
  }

  return Array.from(collected.values());
}

function inferTestCandidates(
  files: ReadonlyArray<string>,
  changedSymbols: ReadonlyArray<SurfaceSymbolRow>,
  affectedSymbols: ReadonlyArray<SurfaceSymbolRow>,
): string[] {
  const candidates = new Set<string>();
  for (const file of files) {
    const baseName = path.basename(file, path.extname(file));
    candidates.add(`${baseName}Test.java`);
    candidates.add(`${baseName}IT.java`);
  }

  for (const symbol of [...changedSymbols, ...affectedSymbols]) {
    const symbolName = symbol.name || symbol.qualified_name || symbol.id;
    candidates.add(`${symbolName}Test`);
  }

  return Array.from(candidates).sort();
}
