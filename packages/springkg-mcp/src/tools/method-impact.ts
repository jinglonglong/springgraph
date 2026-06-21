import type { SpringKg } from '@colbymchenry/springkg-core';
import { fmtLocation, notFoundResult, parseMeta, textResult } from '../lib/format.js';

interface SymbolRow {
  id: string;
  kind: string;
  name: string | null;
  qualified_name: string | null;
  file_path: string | null;
  start_line: number | null;
  metadata: string | null;
}

interface EndpointRow {
  method: string;
  path: string;
  source_file_path: string;
  source_line: number;
}

export async function handleMethodImpact(
  sk: SpringKg,
  args: Record<string, unknown> | undefined,
): Promise<{ content: ReadonlyArray<{ type: 'text'; text: string }> }> {
  const methodName = typeof args?.methodName === 'string' ? args.methodName.trim() : '';
  const depth = typeof args?.depth === 'number' ? Math.max(1, Math.min(4, args.depth)) : 2;

  if (!methodName) {
    return textResult(
      '## spring_method_impact\n\n'
      + 'Required input: `{ "methodName": "...", "depth"?: 1-4 }`.\n\n'
      + 'Returns callers, callees, endpoints, transactions, exception handlers, and downstream SQL operations for the matched method.',
    );
  }

  const db = sk.db.getDb();
  const methods = db.prepare(
    `SELECT id, kind, name, qualified_name, file_path, start_line, metadata
     FROM spring_symbols
     WHERE kind IN ('method', 'service', 'controller_method', 'mapper_method', 'feign_method')
       AND (name = ? OR qualified_name = ? OR qualified_name LIKE ? OR name LIKE ?)
     ORDER BY CASE
       WHEN qualified_name = ? THEN 0
       WHEN name = ? THEN 1
       ELSE 2
     END, qualified_name
     LIMIT 10`,
  ).all(methodName, methodName, `%${methodName}`, `%${methodName}%`, methodName, methodName) as SymbolRow[];

  if (methods.length === 0) {
    return notFoundResult('spring_method_impact', `method matching "${methodName}"`);
  }

  const sections: string[] = [];
  for (const method of methods) {
    const metadata = parseMeta(method.metadata);
    const annotations = Array.isArray(metadata.annotations)
      ? metadata.annotations.filter((item): item is string => typeof item === 'string')
      : [];
    const callers = collectRelatedSymbols(db, 'target_id', method.id, depth, ['calls', 'CALLS']);
    const callees = collectRelatedSymbols(db, 'source_id', method.id, depth, ['calls', 'CALLS']);
    const endpoints = db.prepare(
      'SELECT method, path, source_file_path, source_line FROM spring_endpoints WHERE handler_method_id = ? ORDER BY method, path LIMIT 20',
    ).all(method.id) as EndpointRow[];
    const exceptionHandlers = db.prepare(
      `SELECT id, kind, name, qualified_name, file_path, start_line, metadata
       FROM spring_symbols
       WHERE file_path = ?
         AND (metadata LIKE '%ExceptionHandler%' OR name LIKE 'handle%Exception%' OR qualified_name LIKE '%ExceptionHandler%')
       ORDER BY start_line
       LIMIT 20`,
    ).all(method.file_path ?? '') as SymbolRow[];
    const sqlOps = db.prepare(
      `SELECT sql.id, sql.sql_text, sql.source_file_path, sql.source_line
       FROM spring_edges edge
       JOIN spring_sql_statements sql ON sql.mapper_id = edge.target_id
       WHERE edge.source_id = ? AND edge.kind IN ('calls', 'CALLS')
       LIMIT 20`,
    ).all(method.id) as Array<{ id: string; sql_text: string; source_file_path: string; source_line: number }>;

    sections.push(
      `## Method \`${method.qualified_name || method.name || method.id}\`\n`
      + `- Kind: ${method.kind}\n`
      + `- Source: ${fmtLocation(method.file_path, method.start_line)}`,
    );
    sections.push(formatSymbolSection('## Callers', callers, '_No callers indexed._'));
    sections.push(formatSymbolSection('## Callees', callees, '_No downstream callees indexed._'));
    sections.push(
      endpoints.length > 0
        ? `## Endpoints\n\n${endpoints.map((endpoint) => `- ${endpoint.method} ${endpoint.path} — ${fmtLocation(endpoint.source_file_path, endpoint.source_line)}`).join('\n')}`
        : '## Endpoints\n\n_No HTTP entrypoints mapped to this method._',
    );
    sections.push(
      annotations.includes('Transactional')
        ? `## Transactions\n\n- @Transactional detected on this method${depth > 1 ? ' — callers and callees above show the likely boundary edges.' : '.'}`
        : '## Transactions\n\n_No @Transactional annotation was detected on the matched method._',
    );
    sections.push(formatSymbolSection('## Exception Handlers', exceptionHandlers, '_No nearby exception handlers were indexed in the same file._'));
    sections.push(
      sqlOps.length > 0
        ? `## SQL Operations\n\n${sqlOps.map((row) => `- ${trimPreview(row.sql_text)} — ${fmtLocation(row.source_file_path, row.source_line)}`).join('\n')}`
        : '## SQL Operations\n\n_No downstream SQL operations were linked directly from this method._',
    );
  }

  return textResult(sections.join('\n\n'));
}

function collectRelatedSymbols(
  db: ReturnType<SpringKg['db']['getDb']>,
  idColumn: 'source_id' | 'target_id',
  seedId: string,
  depth: number,
  kinds: ReadonlyArray<string>,
): SymbolRow[] {
  const visited = new Set<string>();
  const queue: Array<{ id: string; level: number }> = [{ id: seedId, level: 0 }];
  const collected = new Map<string, SymbolRow>();
  const edgeKinds = kinds.length > 0 ? kinds : ['calls', 'CALLS'];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.level >= depth) {
      continue;
    }

    const edgeRows = db.prepare(
      `SELECT source_id, target_id
       FROM spring_edges
       WHERE ${idColumn} = ? AND kind IN (${edgeKinds.map(() => '?').join(', ')})
       LIMIT 50`,
    ).all(current.id, ...edgeKinds) as Array<{ source_id: string; target_id: string }>;

    for (const edge of edgeRows) {
      const nextId = idColumn === 'source_id' ? edge.target_id : edge.source_id;
      if (!nextId || nextId === seedId || visited.has(nextId)) {
        continue;
      }

      visited.add(nextId);
      const symbol = db.prepare(
        'SELECT id, kind, name, qualified_name, file_path, start_line, metadata FROM spring_symbols WHERE id = ? LIMIT 1',
      ).get(nextId) as SymbolRow | undefined;
      if (!symbol) {
        continue;
      }

      collected.set(symbol.id, symbol);
      queue.push({ id: symbol.id, level: current.level + 1 });
    }
  }

  return Array.from(collected.values());
}

function formatSymbolSection(title: string, symbols: ReadonlyArray<SymbolRow>, emptyText: string): string {
  if (symbols.length === 0) {
    return `${title}\n\n${emptyText}`;
  }

  return `${title}\n\n${symbols.map((symbol) => `- \`${symbol.qualified_name || symbol.name || symbol.id}\` (${symbol.kind}) — ${fmtLocation(symbol.file_path, symbol.start_line)}`).join('\n')}`;
}

function trimPreview(sqlText: string): string {
  const normalized = sqlText.replace(/\s+/g, ' ').trim();
  return normalized.length > 140 ? `${normalized.slice(0, 140)}…` : normalized;
}
