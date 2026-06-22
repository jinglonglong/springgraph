/**
 * spring_trace_flow — trace the call flow from an HTTP endpoint.
 *
 * Input: { url: string, depth?: number (1-5, default 3), direction?: 'down'|'up'|'both' }
 * Output: hierarchical sectioned markdown.
 *   depth 1: ## Endpoint
 *   depth 2: ## Endpoint + ## Controller
 *   depth 3: ## Endpoint + ## Controller + ## Service
 *   depth 4: ## Endpoint + ## Controller + ## Service + ## Mapper
 *   depth 5: ## Endpoint + ## Controller + ## Service + ## Mapper + ## SQL + ## Table
 *
 * Algorithm: BFS from the endpoint through spring_edges. Edge kinds traversed
 * (downward): HANDLED_BY, CALLS, EXECUTES_SQL, READS_TABLE, WRITES_TABLE.
 * Upward: CALLS_FEIGN, TARGETS_ENDPOINT.
 *
 * Read-only — no writes.
 */

import type { SpringKg } from '@jinglonglong/springkg-core';
import { textResult, notFoundResult, parseMeta, fmtLocation } from '../lib/format.js';

interface TraceFlowArgs {
  url: string;
  depth?: number;
  direction?: 'down' | 'up' | 'both';
}

const MAX_DEPTH = 5;
const _DOWN_EDGE_KINDS = new Set(['HANDLED_BY', 'CALLS', 'EXECUTES_SQL', 'READS_TABLE', 'WRITES_TABLE', 'BIND_TO', 'MAPS_TO_TABLE']);
const UP_EDGE_KINDS = new Set(['CALLS_FEIGN', 'TARGETS_ENDPOINT']);

export async function handleTraceFlow(
  sk: SpringKg,
  args: Record<string, unknown> | undefined
): Promise<{ content: ReadonlyArray<{ type: 'text'; text: string }> }> {
  if (!args || typeof args.url !== 'string' || args.url.length === 0) {
    return textResult(
      `## spring_trace_flow\n\n` +
      `Required input: \`{ "url": "/api/...", "depth"?: 1-5, "direction"?: "down"|"up"|"both" }\`\n\n` +
      `Example: \`{ "url": "/api/users", "depth": 5 }\` returns the full Endpoint→Controller→Service→Mapper→SQL→Table chain.`
    );
  }

  const a = args as unknown as TraceFlowArgs;
  const depth = Math.max(1, Math.min(MAX_DEPTH, a.depth ?? 3));
  const direction = (a.direction ?? 'down') as 'down' | 'up' | 'both';

  const db = sk.db.getDb();

  // 1) Find the endpoint by URL
  const endpoints = db.prepare(
    'SELECT id, method, path, handler_class_id, handler_method_id, source_file_path, source_line FROM spring_endpoints WHERE path = ? OR path LIKE ? ORDER BY method LIMIT 5'
  ).all(a.url, `%${a.url}%`) as Array<{
    id: string; method: string; path: string;
    handler_class_id: string | null; handler_method_id: string | null;
    source_file_path: string; source_line: number;
  }>;

  if (endpoints.length === 0) {
    return notFoundResult('spring_trace_flow', `endpoint with path "${a.url}"`);
  }

  const sections: string[] = [];

  for (const ep of endpoints) {
    // Section 1: Endpoint
    const epSection =
      `## Endpoint ${ep.method} ${ep.path}\n` +
      `- ID: \`${ep.id}\`\n` +
      `- Source: ${fmtLocation(ep.source_file_path, ep.source_line)}\n` +
      (ep.handler_class_id ? `- Handler class: \`${ep.handler_class_id}\`\n` : '') +
      (ep.handler_method_id ? `- Handler method: \`${ep.handler_method_id}\`\n` : '');
    sections.push(epSection);

    if (depth < 2) continue;

    // Section 2: Controller (follow HANDLED_BY from endpoint → controller symbol)
    if (ep.handler_class_id) {
      const ctrlRows = db.prepare(
        'SELECT id, kind, name, qualified_name, file_path, start_line, metadata FROM spring_symbols WHERE id = ?'
      ).all(ep.handler_class_id) as SymbolRow[];

      for (const ctrl of ctrlRows) {
        sections.push(
          `## Controller \`${ctrl.qualified_name || ctrl.name || ctrl.id}\`\n` +
          `- ID: \`${ctrl.id}\`\n` +
          `- Source: ${fmtLocation(ctrl.file_path, ctrl.start_line)}\n`
        );

        if (depth < 3) continue;

        // Section 3: Service (follow down-edges from controller → service)
        const services = followEdges(db, ctrl.id, [..._DOWN_EDGE_KINDS], 20);
        if (services.length > 0) {
          const lines = services.map((s) => `- \`${s.qualified_name || s.name || s.id}\` — ${fmtLocation(s.file_path, s.start_line)} (${s.id})`);
          sections.push(`## Service\n\n${lines.join('\n')}`);

          if (depth < 4) continue;

          // Section 4: Mapper (follow CALLS from service → mapper)
          const mappers: string[] = [];
          for (const svc of services) {
            const mapperHits = followEdges(db, svc.id, ['CALLS', 'BIND_TO'], 20);
            for (const m of mapperHits) {
              if (m.kind === 'mapper' || m.kind === 'mapper_method') {
                mappers.push(`- \`${m.qualified_name || m.name || m.id}\` — ${fmtLocation(m.file_path, m.start_line)} (${m.id})`);
              }
            }
          }
          if (mappers.length > 0) {
            sections.push(`## Mapper\n\n${[...new Set(mappers)].join('\n')}`);

            if (depth < 5) continue;

            // Section 5: SQL (follow EXECUTES_SQL from mapper → spring_sql_statements)
            const sqlLines: string[] = [];
            const seenSql = new Set<string>();
            for (const svc of services) {
              const mapperHits = followEdges(db, svc.id, ['CALLS', 'BIND_TO'], 20);
              for (const m of mapperHits) {
                const stmts = db.prepare(
                  'SELECT id, sql_text, source_file_path, source_line, tables FROM spring_sql_statements WHERE mapper_id = ? LIMIT 5'
                ).all(m.id) as Array<{ id: string; sql_text: string; source_file_path: string; source_line: number; tables: string | null }>;

                for (const stmt of stmts) {
                  if (seenSql.has(stmt.id)) continue;
                  seenSql.add(stmt.id);
                  const preview = stmt.sql_text.length > 160 ? stmt.sql_text.slice(0, 160) + '…' : stmt.sql_text;
                  sqlLines.push(`- [${fmtLocation(stmt.source_file_path, stmt.source_line)}] \`${preview}\``);

                  if (depth >= 5) {
                    // Section 6: Table (parse stmt.tables)
                    if (stmt.tables) {
                      try {
                        const tables = JSON.parse(stmt.tables) as string[];
                        for (const t of tables) sqlLines.push(`  - **Table** \`${t}\``);
                      } catch { /* ignore */ }
                    }
                  }
                }
              }
            }
            if (sqlLines.length > 0) {
              const tableHdr = depth >= 5 ? '\n\n### Tables' : '';
              sections.push(`## SQL\n\n${sqlLines.join('\n')}${tableHdr}`);
            }
          }
        }
      }
    }

    // Optional: upward trace (Feign callers of this endpoint)
    if (direction === 'up' || direction === 'both') {
      const callers = followEdges(db, ep.id, [...UP_EDGE_KINDS], 20);
      if (callers.length > 0) {
        const lines = callers.map((c) => `- \`${c.qualified_name || c.name || c.id}\` (${c.kind}) — ${fmtLocation(c.file_path, c.start_line)}`);
        sections.push(`## Upstream Callers (Feign)\n\n${lines.join('\n')}`);
      }
    }
  }

  return textResult(sections.join('\n\n'));
}

// -----------------------------------------------------------------------------
// Edge following
// -----------------------------------------------------------------------------

function followEdges(
  db: ReturnType<SpringKg['db']['getDb']>,
  fromId: string,
  kinds: ReadonlyArray<string>,
  limit: number
): SymbolRow[] {
  if (kinds.length === 0) return [];
  const placeholders = kinds.map(() => '?').join(',');
  const edges = db.prepare(
    `SELECT target_id, kind FROM spring_edges WHERE source_id = ? AND kind IN (${placeholders}) LIMIT ?`
  ).all(fromId, ...kinds, limit) as Array<{ target_id: string; kind: string }>;

  if (edges.length === 0) return [];

  const targetIds = [...new Set(edges.map((e) => e.target_id))];
  const targetPlaceholders = targetIds.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT id, kind, name, qualified_name, file_path, start_line, metadata FROM spring_symbols WHERE id IN (${targetPlaceholders})`
  ).all(...targetIds) as SymbolRow[];

  // Suppress unused-import warning for parseMeta (used in other tools)
  void parseMeta;
  return rows;
}

// -----------------------------------------------------------------------------
// Row types
// -----------------------------------------------------------------------------

interface SymbolRow {
  id: string;
  kind: string;
  name: string | null;
  qualified_name: string | null;
  file_path: string | null;
  start_line: number | null;
  metadata: string | null;
}
