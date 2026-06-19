/**
 * spring_find_entry — locate entry points by URL, controller, Feign name, MQ topic, or scheduled task.
 *
 * Input: { url?, controller?, method?, feign_name?, mq?, scheduled? }
 * Output: sectioned markdown with one section per matched entry.
 *
 * Read-only — no writes to spring_symbols or spring_edges.
 */

import type { SpringKg } from '@colbymchenry/springkg-core';
import { textResult, notFoundResult, parseMeta, fmtLocation } from '../lib/format.js';

interface FindEntryArgs {
  url?: string;
  controller?: string;
  method?: string;
  feign_name?: string;
  mq?: string;
  scheduled?: string;
}

export async function handleFindEntry(
  sk: SpringKg,
  args: Record<string, unknown> | undefined
): Promise<{ content: ReadonlyArray<{ type: 'text'; text: string }> }> {
  const a = (args || {}) as FindEntryArgs;
  const db = sk.db.getDb();
  const sections: string[] = [];

  // 1) URL match — query spring_endpoints
  if (a.url) {
    const url = a.url;
    const method = a.method;
    const rows = method
      ? (db.prepare(
          'SELECT id, method, path, handler_class_id, handler_method_id, source_file_path, source_line FROM spring_endpoints WHERE method = ? AND (path = ? OR path LIKE ?) ORDER BY path LIMIT 20'
        ).all(method, url, `%${url}%`) as EndpointRow[])
      : (db.prepare(
          'SELECT id, method, path, handler_class_id, handler_method_id, source_file_path, source_line FROM spring_endpoints WHERE path = ? OR path LIKE ? ORDER BY method, path LIMIT 20'
        ).all(url, `%${url}%`) as EndpointRow[]);

    for (const r of rows) {
      sections.push(
        `## Endpoint ${r.method} ${r.path}\n` +
        `- ID: ${r.id}\n` +
        `- Source: ${fmtLocation(r.source_file_path, r.source_line)}\n` +
        (r.handler_class_id ? `- Handler class: ${r.handler_class_id}\n` : '') +
        (r.handler_method_id ? `- Handler method: ${r.handler_method_id}\n` : '')
      );
    }
  }

  // 2) Controller class fuzzy match — query spring_symbols (kind=controller or endpoint)
  if (a.controller) {
    const needle = `%${a.controller}%`;
    const rows = db.prepare(
      "SELECT id, kind, name, qualified_name, file_path, start_line FROM spring_symbols WHERE kind IN ('controller', 'service') AND (name LIKE ? OR qualified_name LIKE ?) ORDER BY kind, name LIMIT 20"
    ).all(needle, needle) as SymbolRow[];

    if (rows.length > 0) {
      const lines = rows.map(
        (r) => `- **${r.kind}** \`${r.qualified_name || r.name}\` — ${fmtLocation(r.file_path, r.start_line)} (${r.id})`
      );
      sections.push(`## Controller Match\n\n${lines.join('\n')}`);
    }
  }

  // 3) Feign name match — query spring_feign_clients
  if (a.feign_name) {
    const needle = `%${a.feign_name}%`;
    const rows = db.prepare(
      'SELECT id, client_name, target_service, target_url, method_count FROM spring_feign_clients WHERE client_name LIKE ? OR target_service LIKE ? ORDER BY client_name LIMIT 20'
    ).all(needle, needle) as FeignRow[];

    if (rows.length > 0) {
      const lines = rows.map(
        (r) =>
          `- **Feign** \`${r.client_name}\` → \`${r.target_service}\` (${r.method_count} methods)` +
          (r.target_url ? ` [${r.target_url}]` : '') +
          ` — ${r.id}`
      );
      sections.push(`## Feign Match\n\n${lines.join('\n')}`);
    }
  }

  // 4) MQ topic — query spring_symbols with metadata.mq
  if (a.mq) {
    const needle = `%${a.mq}%`;
    const rows = db.prepare(
      "SELECT id, name, qualified_name, file_path, start_line, metadata FROM spring_symbols WHERE metadata LIKE ? LIMIT 20"
    ).all(needle) as SymbolRow[];

    const matched = rows.filter((r) => {
      const m = parseMeta(r.metadata);
      const topic = m.mq || m.topic || m.kafkaTopic || m.rabbitQueue;
      return typeof topic === 'string' && topic.toLowerCase().includes(a.mq!.toLowerCase());
    });

    if (matched.length > 0) {
      const lines = matched.map((r) => {
        const m = parseMeta(r.metadata);
        const topic = m.mq || m.topic || m.kafkaTopic || m.rabbitQueue;
        return `- \`${r.qualified_name || r.name}\` listens on \`${topic}\` — ${fmtLocation(r.file_path, r.start_line)} (${r.id})`;
      });
      sections.push(`## MQ Listener\n\n${lines.join('\n')}`);
    }
  }

  // 5) Scheduled task — query spring_symbols with metadata.scheduled
  if (a.scheduled) {
    const needle = `%${a.scheduled}%`;
    const rows = db.prepare(
      "SELECT id, name, qualified_name, file_path, start_line, metadata FROM spring_symbols WHERE (name LIKE ? OR qualified_name LIKE ?) AND metadata LIKE '%scheduled%' OR metadata LIKE '%cron%' OR metadata LIKE '%fixedDelay%' OR metadata LIKE '%fixedRate%' LIMIT 20"
    ).all(needle, needle) as SymbolRow[];

    const matched = rows.filter((r) => {
      const m = parseMeta(r.metadata);
      return m.scheduled === true || typeof m.cron === 'string' || typeof m.fixedDelay === 'number' || typeof m.fixedRate === 'number';
    });

    if (matched.length > 0) {
      const lines = matched.map((r) => {
        const m = parseMeta(r.metadata);
        const schedule = m.cron ? `cron=${m.cron}` : m.fixedDelay ? `fixedDelay=${m.fixedDelay}` : m.fixedRate ? `fixedRate=${m.fixedRate}` : 'scheduled';
        return `- \`${r.qualified_name || r.name}\` (${schedule}) — ${fmtLocation(r.file_path, r.start_line)} (${r.id})`;
      });
      sections.push(`## Scheduled Task\n\n${lines.join('\n')}`);
    }
  }

  // If no filter was given, return guidance
  if (!a.url && !a.controller && !a.feign_name && !a.mq && !a.scheduled) {
    return textResult(
      `## spring_find_entry\n\n` +
      `Provide at least one filter:\n` +
      `- \`url\` — HTTP path (e.g. /api/users)\n` +
      `- \`controller\` — controller class name (fuzzy)\n` +
      `- \`feign_name\` — Feign client name\n` +
      `- \`mq\` — MQ topic / queue name\n` +
      `- \`scheduled\` — scheduled task name (or "*" to list all)\n\n` +
      `Example: \`{ "url": "/api/users" }\` or \`{ "controller": "UserController" }\`.`
    );
  }

  if (sections.length === 0) {
    return notFoundResult('spring_find_entry', 'entry point');
  }

  return textResult(sections.join('\n\n'));
}

// -----------------------------------------------------------------------------
// Row types
// -----------------------------------------------------------------------------

interface EndpointRow {
  id: string;
  method: string;
  path: string;
  handler_class_id: string | null;
  handler_method_id: string | null;
  source_file_path: string;
  source_line: number;
}

interface SymbolRow {
  id: string;
  kind: string;
  name: string | null;
  qualified_name: string | null;
  file_path: string | null;
  start_line: number | null;
  metadata: string | null;
}

interface FeignRow {
  id: string;
  client_name: string;
  target_service: string;
  target_url: string | null;
  method_count: number;
}
