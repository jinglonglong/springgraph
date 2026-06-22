import type { SpringKg } from '@jinglonglong/springkg-core';
import { fmtLocation, notFoundResult, textResult } from '../lib/format.js';

interface FieldSymbolRow {
  id: string;
  kind: string;
  name: string | null;
  qualified_name: string | null;
  file_path: string | null;
  start_line: number | null;
}

export async function handleFieldImpact(
  sk: SpringKg,
  args: Record<string, unknown> | undefined,
): Promise<{ content: ReadonlyArray<{ type: 'text'; text: string }> }> {
  const fieldName = typeof args?.fieldName === 'string' ? args.fieldName.trim() : '';
  const className = typeof args?.className === 'string' ? args.className.trim() : '';

  if (!fieldName) {
    return textResult(
      '## spring_field_impact\n\n'
      + 'Required input: `{ "fieldName": "...", "className"?: "..." }`.\n\n'
      + 'Returns mapper usage, read/write sites, and schema impact for the matched field or property.',
    );
  }

  const db = sk.db.getDb();
  const fieldSymbols = db.prepare(
    `SELECT id, kind, name, qualified_name, file_path, start_line
     FROM spring_symbols
     WHERE kind IN ('field', 'property', 'variable')
       AND (name = ? OR qualified_name LIKE ?)
       ${className ? 'AND qualified_name LIKE ?' : ''}
     ORDER BY qualified_name
     LIMIT 20`,
  ).all(...(className ? [fieldName, `%${fieldName}%`, `%${className}%`] : [fieldName, `%${fieldName}%`])) as FieldSymbolRow[];

  const mapperStatements = db.prepare(
    'SELECT id, sql_text, tables, source_file_path, source_line FROM spring_sql_statements WHERE sql_text LIKE ? ORDER BY source_file_path LIMIT 20',
  ).all(`%${fieldName}%`) as Array<{ id: string; sql_text: string; tables: string | null; source_file_path: string; source_line: number }>;

  const usageRows = fieldSymbols.length > 0
    ? db.prepare(
        `SELECT s.id, s.kind, s.name, s.qualified_name, s.file_path, s.start_line
         FROM spring_edges edge
         JOIN spring_symbols s ON s.id = edge.source_id
         WHERE edge.target_id IN (${fieldSymbols.map(() => '?').join(', ')})
           AND edge.kind IN ('READS', 'WRITES', 'references', 'REFERENCES', 'type_of')
         ORDER BY s.qualified_name
         LIMIT 30`,
      ).all(...fieldSymbols.map((field) => field.id)) as FieldSymbolRow[]
    : [];

  if (fieldSymbols.length === 0 && mapperStatements.length === 0 && usageRows.length === 0) {
    return notFoundResult('spring_field_impact', `field matching "${fieldName}"`);
  }

  const sections: string[] = [];
  sections.push(
    fieldSymbols.length > 0
      ? `## Field\n\n${fieldSymbols.map((field) => `- \`${field.qualified_name || field.name || field.id}\` (${field.kind}) — ${fmtLocation(field.file_path, field.start_line)}`).join('\n')}`
      : `## Field\n\n_No indexed field symbol matched \`${fieldName}\`; downstream SQL usage is shown instead._`,
  );
  sections.push(
    mapperStatements.length > 0
      ? `## Mappers Using Field\n\n${mapperStatements.map((statement) => `- ${trimSql(statement.sql_text)} — ${fmtLocation(statement.source_file_path, statement.source_line)}`).join('\n')}`
      : '## Mappers Using Field\n\n_No mapper SQL statements referenced this field name._',
  );
  sections.push(
    usageRows.length > 0
      ? `## Callers Reading/Writing\n\n${usageRows.map((row) => `- \`${row.qualified_name || row.name || row.id}\` (${row.kind}) — ${fmtLocation(row.file_path, row.start_line)}`).join('\n')}`
      : '## Callers Reading/Writing\n\n_No explicit field read/write edges were indexed for this field._',
  );
  sections.push(
    mapperStatements.length > 0
      ? `## Schema Impact\n\n${mapperStatements.map((statement) => {
          const tables = parseTables(statement.tables);
          const tableInfo = tables.length > 0 ? ` — tables: ${tables.join(', ')}` : '';
          return `- \`${fieldName}\` appears in ${fmtLocation(statement.source_file_path, statement.source_line)}${tableInfo}`;
        }).join('\n')}`
      : '## Schema Impact\n\n_No table-level references were inferred from indexed SQL statements._',
  );

  return textResult(sections.join('\n\n'));
}

function parseTables(raw: string | null): string[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

function trimSql(sqlText: string): string {
  const normalized = sqlText.replace(/\s+/g, ' ').trim();
  return normalized.length > 140 ? `${normalized.slice(0, 140)}…` : normalized;
}
