/**
 * spring_assets_overview — survey of services, middlewares, and sensitive config properties.
 *
 * Input: {} (no parameters)
 * Output: 3 sections
 *   ## Services       — controllers + their declaring files
 *   ## Middlewares    — middleware symbols (type + host + port)
 *   ## Sensitive Config — config_property rows where is_sensitive=1
 *                        key + file:line + is_sensitive flag ONLY.
 *                        Value column is NEVER returned.
 *
 * Read-only — no writes.
 */

import type { SpringKg } from '@jinglonglong/springkg-core';
import { textResult, fmtLocation } from '../lib/format.js';

export async function handleAssetsOverview(
  sk: SpringKg,
  _args: Record<string, unknown> | undefined
): Promise<{ content: ReadonlyArray<{ type: 'text'; text: string }> }> {
  const db = sk.db.getDb();
  const sections: string[] = [];

  // 1) Services — spring_symbols WHERE kind IN ('controller', 'service')
  const services = db.prepare(
    "SELECT id, name, qualified_name, file_path, start_line FROM spring_symbols WHERE kind IN ('controller', 'service') ORDER BY kind, qualified_name LIMIT 50"
  ).all() as Array<{
    id: string; name: string | null; qualified_name: string | null;
    file_path: string | null; start_line: number | null;
  }>;

  if (services.length > 0) {
    const lines = services.map(
      (s) => `- \`${s.qualified_name || s.name || s.id}\` — ${fmtLocation(s.file_path, s.start_line)}`
    );
    sections.push(`## Services (${services.length})\n\n${lines.join('\n')}`);
  } else {
    sections.push(`## Services\n\n_No controllers or services indexed yet._`);
  }

  // 2) Middlewares — spring_symbols WHERE kind = 'middleware'
  const middlewares = db.prepare(
    "SELECT id, name, qualified_name, file_path, start_line, metadata FROM spring_symbols WHERE kind = 'middleware' ORDER BY qualified_name LIMIT 50"
  ).all() as Array<{
    id: string; name: string | null; qualified_name: string | null;
    file_path: string | null; start_line: number | null; metadata: string | null;
  }>;

  if (middlewares.length > 0) {
    const lines = middlewares.map((m) => {
      const meta = parseMetaSafe(m.metadata);
      const host = (meta.host as string) || '?';
      const port = (meta.port as string | number) || '?';
      const type = (meta.type as string) || (m.name as string) || 'middleware';
      return `- **${type}** \`${host}:${port}\` — ${fmtLocation(m.file_path, m.start_line)} (${m.id})`;
    });
    sections.push(`## Middlewares (${middlewares.length})\n\n${lines.join('\n')}`);
  } else {
    sections.push(`## Middlewares\n\n_No middlewares indexed yet._`);
  }

  // 3) Sensitive Config — runtime_config_properties WHERE is_sensitive = 1
  //    CRITICAL: never include the value_hash (or any value-derived field) in the output.
  const sensitive = db.prepare(
    'SELECT id, key, source_file_path, source_line, bean_id FROM runtime_config_properties WHERE is_sensitive = 1 ORDER BY key LIMIT 50'
  ).all() as Array<{
    id: string; key: string;
    source_file_path: string; source_line: number;
    bean_id: string | null;
  }>;

  if (sensitive.length > 0) {
    const lines = sensitive.map(
      (c) =>
        `- \`${c.key}\` — ${fmtLocation(c.source_file_path, c.source_line)}` +
        (c.bean_id ? ` (bean: \`${c.bean_id}\`)` : '') +
        ' — value: `***` (never returned)'
    );
    sections.push(`## Sensitive Config (${sensitive.length})\n\n${lines.join('\n')}\n\n_Note: sensitive values are never stored in the database. Only the value hash is persisted for change detection. To see the actual value, Read the source file at the listed file:line._`);
  } else {
    sections.push(`## Sensitive Config\n\n_No sensitive config properties indexed yet._`);
  }

  return textResult(sections.join('\n\n'));
}

function parseMetaSafe(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch { /* ignore */ }
  return {};
}
