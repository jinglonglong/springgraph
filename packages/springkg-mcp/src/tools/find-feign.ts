/**
 * spring_find_feign — look up a Feign client by name, interface, or target service.
 *
 * Input: { name?, interface?, target_service? }
 * Output: sectioned markdown with the client, its methods, and (when bridged) the target endpoint.
 *
 * Read-only — no writes to spring_symbols or spring_edges.
 */

import type { SpringKg } from '@colbymchenry/springkg-core';
import { textResult, notFoundResult } from '../lib/format.js';

interface FindFeignArgs {
  name?: string;
  interface?: string;
  target_service?: string;
}

export async function handleFindFeign(
  sk: SpringKg,
  args: Record<string, unknown> | undefined
): Promise<{ content: ReadonlyArray<{ type: 'text'; text: string }> }> {
  const a = (args || {}) as FindFeignArgs;
  if (!a.name && !a.interface && !a.target_service) {
    return textResult(
      `## spring_find_feign\n\n` +
      `Provide at least one filter:\n` +
      `- \`name\` — Feign client name (e.g. OrderClient)\n` +
      `- \`interface\` — fully qualified interface name\n` +
      `- \`target_service\` — downstream service name (e.g. order-service)\n\n` +
      `Example: \`{ "name": "OrderClient" }\` or \`{ "target_service": "order-service" }\`.`
    );
  }

  const db = sk.db.getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (a.name) {
    conditions.push('(client_name = ? OR client_name LIKE ?)');
    params.push(a.name, `%${a.name}%`);
  }
  if (a.target_service) {
    conditions.push('(target_service = ? OR target_service LIKE ?)');
    params.push(a.target_service, `%${a.target_service}%`);
  }
  // `interface` is matched against spring_symbols.qualified_name (kind=feign_client)
  // after we get the rows, since spring_feign_clients.client_name is the short name.
  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' OR ') : '';
  const rows = db.prepare(
    `SELECT id, client_name, target_service, target_url, method_count FROM spring_feign_clients ${where} ORDER BY client_name LIMIT 20`
  ).all(...params) as FeignRow[];

  // Optional: also filter by interface (qualified name) on the symbols side
  let filteredRows = rows;
  if (a.interface) {
    const needle = `%${a.interface}%`;
    const matchingIds = new Set(
      (db.prepare(
        "SELECT springgraph_node_id FROM spring_symbols WHERE kind = 'feign_client' AND (qualified_name LIKE ? OR name LIKE ?)"
      ).all(needle, needle) as Array<{ springgraph_node_id: string | null }>)
        .map((r) => r.springgraph_node_id)
        .filter((id): id is string => typeof id === 'string')
    );
    // Map springgraph_node_id back to feign_clients.id (feign client id == spring_symbols.id)
    const symIds = new Set(
      (db.prepare(
        "SELECT id FROM spring_symbols WHERE kind = 'feign_client' AND (qualified_name LIKE ? OR name LIKE ?)"
      ).all(needle, needle) as Array<{ id: string }>).map((r) => r.id)
    );
    filteredRows = rows.filter((r) => symIds.has(r.id) || matchingIds.has(r.id));
  }

  if (filteredRows.length === 0) {
    return notFoundResult('spring_find_feign', 'Feign client');
  }

  const sections: string[] = [];
  for (const r of filteredRows) {
    const lines: string[] = [];
    lines.push(`- **Client name**: \`${r.client_name}\``);
    lines.push(`- **Target service**: \`${r.target_service}\``);
    if (r.target_url) lines.push(`- **Target URL**: \`${r.target_url}\``);
    lines.push(`- **Method count**: ${r.method_count}`);
    lines.push(`- **ID**: \`${r.id}\``);

    // Look up TARGETS_ENDPOINT edges to surface the downstream endpoint (when bridged)
    const targets = db.prepare(
      "SELECT target_id, metadata FROM spring_edges WHERE source_id = ? AND kind = 'TARGETS_ENDPOINT' LIMIT 20"
    ).all(r.id) as Array<{ target_id: string; metadata: string | null }>;

    if (targets.length > 0) {
      const targetDescriptions = targets.map((t) => {
        const ep = db.prepare(
          'SELECT method, path, source_file_path, source_line FROM spring_endpoints WHERE id = ?'
        ).get(t.target_id) as { method: string; path: string; source_file_path: string; source_line: number } | undefined;
        if (ep) {
          return `  - ${ep.method} ${ep.path} — ${ep.source_file_path}:${ep.source_line}`;
        }
        return `  - ${t.target_id} (not yet resolved to a spring_endpoints row)`;
      });
      lines.push('', '### Bridged target endpoints', ...targetDescriptions);
    } else {
      lines.push('', '_No TARGETS_ENDPOINT bridge yet — the downstream service\'s endpoints are not yet indexed, or this Feign method was not statically traced._');
    }

    sections.push(`## Feign Client \`${r.client_name}\`\n\n${lines.join('\n')}`);
  }

  return textResult(sections.join('\n\n'));
}

interface FeignRow {
  id: string;
  client_name: string;
  target_service: string;
  target_url: string | null;
  method_count: number;
}
