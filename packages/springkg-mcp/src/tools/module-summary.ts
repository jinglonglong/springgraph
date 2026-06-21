import type { SpringKg } from '@colbymchenry/springkg-core';
import { fmtLocation, notFoundResult, textResult } from '../lib/format.js';

interface ModuleSymbolRow {
  id: string;
  kind: string;
  name: string | null;
  qualified_name: string | null;
  file_path: string | null;
  start_line: number | null;
  updated_at: number | null;
}

export async function handleModuleSummary(
  sk: SpringKg,
  args: Record<string, unknown> | undefined,
): Promise<{ content: ReadonlyArray<{ type: 'text'; text: string }> }> {
  const modulePath = typeof args?.modulePath === 'string' ? args.modulePath.trim() : '';
  if (!modulePath) {
    return textResult(
      '## spring_module_summary\n\n'
      + 'Required input: `{ "modulePath": "com.example.order" }` or a matching file path fragment.\n\n'
      + 'Returns controllers, services, mappers, configs, dependencies, statistics, and recent symbols for the matched module.',
    );
  }

  const db = sk.db.getDb();
  const symbols = db.prepare(
    `SELECT id, kind, name, qualified_name, file_path, start_line, updated_at
     FROM spring_symbols
     WHERE qualified_name LIKE ? OR file_path LIKE ?
     ORDER BY qualified_name
     LIMIT 200`,
  ).all(`${modulePath}%`, `%${modulePath}%`) as ModuleSymbolRow[];

  const configs = db.prepare(
    `SELECT key, source_file_path, source_line
     FROM runtime_config_properties
     WHERE source_file_path LIKE ? OR bean_id LIKE ?
     ORDER BY key
     LIMIT 100`,
  ).all(`%${modulePath}%`, `%${modulePath}%`) as Array<{ key: string; source_file_path: string; source_line: number }>;

  if (symbols.length === 0 && configs.length === 0) {
    return notFoundResult('spring_module_summary', `module matching "${modulePath}"`);
  }

  const moduleIds = new Set(symbols.map((symbol) => symbol.id));
  const dependencies = symbols.length > 0
    ? db.prepare(
        `SELECT DISTINCT target.id, target.kind, target.name, target.qualified_name, target.file_path, target.start_line, target.updated_at
         FROM spring_edges edge
         JOIN spring_symbols target ON target.id = edge.target_id
         WHERE edge.source_id IN (${symbols.map(() => '?').join(', ')})
           AND edge.kind IN ('calls', 'CALLS')
           AND target.id NOT IN (${symbols.map(() => '?').join(', ')})
         ORDER BY target.kind, target.qualified_name
         LIMIT 50`,
      ).all(...symbols.map((symbol) => symbol.id), ...symbols.map((symbol) => symbol.id)) as ModuleSymbolRow[]
    : [];

  const sections: string[] = [];
  sections.push(`## Module\n\n- Query: \`${modulePath}\``);
  sections.push(groupSection('## Controllers', symbols, ['controller', 'controller_method']));
  sections.push(groupSection('## Services', symbols, ['service', 'service_class', 'method']));
  sections.push(groupSection('## Mappers', symbols, ['mapper', 'mapper_method', 'sql_statement']));
  sections.push(
    configs.length > 0
      ? `## Configs\n\n${configs.map((config) => `- \`${config.key}\` — ${fmtLocation(config.source_file_path, config.source_line)}`).join('\n')}`
      : '## Configs\n\n_No config properties were indexed under this module path._',
  );
  sections.push(
    dependencies.length > 0
      ? `## Dependencies\n\n${dependencies.map((dependency) => `- \`${dependency.qualified_name || dependency.name || dependency.id}\` (${dependency.kind}) — ${fmtLocation(dependency.file_path, dependency.start_line)}`).join('\n')}`
      : '## Dependencies\n\n_No cross-module call dependencies were indexed from this module._',
  );
  sections.push(`## Statistics\n\n${renderStatistics(symbols, configs.length)}`);
  sections.push(renderRecentSection(symbols.filter((symbol) => moduleIds.has(symbol.id))));

  return textResult(sections.join('\n\n'));
}

function groupSection(title: string, symbols: ReadonlyArray<ModuleSymbolRow>, kinds: ReadonlyArray<string>): string {
  const filtered = symbols.filter((symbol) => kinds.includes(symbol.kind));
  if (filtered.length === 0) {
    return `${title}\n\n_None indexed for this module._`;
  }

  return `${title}\n\n${filtered.map((symbol) => `- \`${symbol.qualified_name || symbol.name || symbol.id}\` — ${fmtLocation(symbol.file_path, symbol.start_line)}`).join('\n')}`;
}

function renderStatistics(symbols: ReadonlyArray<ModuleSymbolRow>, configCount: number): string {
  const counts = new Map<string, number>();
  for (const symbol of symbols) {
    counts.set(symbol.kind, (counts.get(symbol.kind) ?? 0) + 1);
  }

  const lines = Array.from(counts.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([kind, count]) => `- ${kind}: ${count}`);
  lines.push(`- config_properties: ${configCount}`);
  lines.push(`- total_symbols: ${symbols.length}`);
  return lines.join('\n');
}

function renderRecentSection(symbols: ReadonlyArray<ModuleSymbolRow>): string {
  const recent = [...symbols]
    .sort((left, right) => Number(right.updated_at ?? 0) - Number(left.updated_at ?? 0))
    .slice(0, 5);
  if (recent.length === 0) {
    return '## Recent\n\n_No recent symbols were indexed for this module._';
  }

  return `## Recent\n\n${recent.map((symbol) => `- \`${symbol.qualified_name || symbol.name || symbol.id}\` — ${fmtLocation(symbol.file_path, symbol.start_line)}`).join('\n')}`;
}
