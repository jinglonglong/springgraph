import type { SpringKg } from '@jinglonglong/springkg-core';
import { fmtLocation, notFoundResult, parseMeta, textResult } from '../lib/format.js';

interface RuntimeSymbolRow {
  id: string;
  kind: string;
  name: string | null;
  qualified_name: string | null;
  file_path: string | null;
  start_line: number | null;
  metadata: string | null;
}

export async function handleRuntimeDependency(
  sk: SpringKg,
  args: Record<string, unknown> | undefined,
): Promise<{ content: ReadonlyArray<{ type: 'text'; text: string }> }> {
  const serviceName = typeof args?.serviceName === 'string' ? args.serviceName.trim() : '';
  if (!serviceName) {
    return textResult(
      '## spring_runtime_dependency\n\n'
      + 'Required input: `{ "serviceName": "OrderService" }`.\n\n'
      + 'Returns database, Redis, MQ, HTTP/Feign, and config dependencies for the matched service or method.',
    );
  }

  const db = sk.db.getDb();
  const services = db.prepare(
    `SELECT id, kind, name, qualified_name, file_path, start_line, metadata
     FROM spring_symbols
     WHERE (name = ? OR qualified_name = ? OR qualified_name LIKE ? OR name LIKE ?)
       AND kind IN ('service', 'service_class', 'method', 'controller_method')
     ORDER BY qualified_name
     LIMIT 20`,
  ).all(serviceName, serviceName, `%${serviceName}`, `%${serviceName}%`) as RuntimeSymbolRow[];

  if (services.length === 0) {
    return notFoundResult('spring_runtime_dependency', `service matching "${serviceName}"`);
  }

  const serviceIds = services.map((service) => service.id);
  const downstream = db.prepare(
    `SELECT target.id, target.kind, target.name, target.qualified_name, target.file_path, target.start_line, target.metadata
     FROM spring_edges edge
     JOIN spring_symbols target ON target.id = edge.target_id
     WHERE edge.source_id IN (${serviceIds.map(() => '?').join(', ')})
     LIMIT 100`,
  ).all(...serviceIds) as RuntimeSymbolRow[];
  const sqlStatements = db.prepare(
    `SELECT sql.id, sql.sql_text, sql.tables, sql.source_file_path, sql.source_line
     FROM spring_sql_statements sql
     WHERE sql.mapper_id IN (${serviceIds.map(() => '?').join(', ')})
        OR sql.mapper_id IN (
          SELECT target_id FROM spring_edges WHERE source_id IN (${serviceIds.map(() => '?').join(', ')})
        )
     LIMIT 50`,
  ).all(...serviceIds, ...serviceIds) as Array<{ id: string; sql_text: string; tables: string | null; source_file_path: string; source_line: number }>;
  const configRows = db.prepare(
    `SELECT key, source_file_path, source_line, bean_id
     FROM runtime_config_properties
     WHERE bean_id LIKE ? OR source_file_path LIKE ?
     ORDER BY key
     LIMIT 50`,
  ).all(`%${serviceName}%`, `%${serviceName}%`) as Array<{ key: string; source_file_path: string; source_line: number; bean_id: string | null }>;

  const middlewareGroups = groupMiddlewareDependencies(downstream);
  const feignSymbols = downstream.filter((row) => row.kind === 'feign_client' || row.kind === 'feign_method');
  const sections: string[] = [];
  sections.push(`## Service\n\n${services.map((service) => `- \`${service.qualified_name || service.name || service.id}\` (${service.kind}) — ${fmtLocation(service.file_path, service.start_line)}`).join('\n')}`);
  sections.push(
    sqlStatements.length > 0
      ? `## Database\n\n${sqlStatements.map((statement) => `- ${shortSql(statement.sql_text)} — ${fmtLocation(statement.source_file_path, statement.source_line)}${renderTables(statement.tables)}`).join('\n')}`
      : '## Database\n\n_No SQL statements were linked from this service._',
  );
  sections.push(renderDependencySection('## Redis', middlewareGroups.redis));
  sections.push(renderDependencySection('## MQ', middlewareGroups.mq));
  sections.push(renderDependencySection('## HTTP', middlewareGroups.http));
  sections.push(
    feignSymbols.length > 0
      ? `## Feign\n\n${feignSymbols.map((symbol) => `- \`${symbol.qualified_name || symbol.name || symbol.id}\` (${symbol.kind}) — ${fmtLocation(symbol.file_path, symbol.start_line)}`).join('\n')}`
      : '## Feign\n\n_No Feign client dependencies were indexed for this service._',
  );
  sections.push(
    configRows.length > 0
      ? `## Config Keys\n\n${configRows.map((config) => `- \`${config.key}\` — ${fmtLocation(config.source_file_path, config.source_line)}${config.bean_id ? ` (bean: ${config.bean_id})` : ''}`).join('\n')}`
      : '## Config Keys\n\n_No config property bindings were indexed for this service._',
  );

  return textResult(sections.join('\n\n'));
}

function groupMiddlewareDependencies(symbols: ReadonlyArray<RuntimeSymbolRow>): {
  redis: string[];
  mq: string[];
  http: string[];
} {
  const redis: string[] = [];
  const mq: string[] = [];
  const http: string[] = [];

  for (const symbol of symbols) {
    if (symbol.kind !== 'middleware') {
      continue;
    }
    const metadata = parseMeta(symbol.metadata);
    const type = typeof metadata.type === 'string' ? metadata.type.toLowerCase() : '';
    const formatted = `- \`${symbol.qualified_name || symbol.name || symbol.id}\` — ${fmtLocation(symbol.file_path, symbol.start_line)}`;
    if (type.includes('redis') || type.includes('cache')) {
      redis.push(formatted);
    } else if (type.includes('mq') || type.includes('kafka') || type.includes('rabbit')) {
      mq.push(formatted);
    } else if (type.includes('http') || type.includes('rest') || type.includes('web')) {
      http.push(formatted);
    }
  }

  return { redis, mq, http };
}

function renderDependencySection(title: string, lines: ReadonlyArray<string>): string {
  return lines.length > 0 ? `${title}\n\n${lines.join('\n')}` : `${title}\n\n_None indexed._`;
}

function shortSql(sqlText: string): string {
  const normalized = sqlText.replace(/\s+/g, ' ').trim();
  return normalized.length > 120 ? `${normalized.slice(0, 120)}…` : normalized;
}

function renderTables(raw: string | null): string {
  if (!raw) {
    return '';
  }
  try {
    const tables = JSON.parse(raw) as unknown;
    const tableNames = Array.isArray(tables) ? tables.filter((value): value is string => typeof value === 'string') : [];
    return tableNames.length > 0 ? ` — tables: ${tableNames.join(', ')}` : '';
  } catch {
    return '';
  }
}
