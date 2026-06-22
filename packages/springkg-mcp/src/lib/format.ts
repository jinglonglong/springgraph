/**
 * Helper: format a MCP tool response (text content only).
 */
export function textResult(text: string): {
  content: ReadonlyArray<{ type: 'text'; text: string }>;
} {
  return { content: [{ type: 'text' as const, text }] };
}

/**
 * Helper: format a "not found" response (SUCCESS-shaped, per CLAUDE.md).
 */
export function notFoundResult(_toolName: string, what: string): {
  content: ReadonlyArray<{ type: 'text'; text: string }>;
} {
  return textResult(
    `## Not Found\n\nNo ${what} matched the query.\n\n` +
    `Tips:\n` +
    `- Run \`springkg status\` to check the index is populated.\n` +
    `- The database may be empty if \`springkg index\` has not been run yet.\n` +
    `- Try a broader query (e.g. partial name match).`
  );
}

/**
 * Helper: format a "not indexed" response (SUCCESS-shaped, per CLAUDE.md).
 */
export function notIndexedResult(): {
  content: ReadonlyArray<{ type: 'text'; text: string }>;
} {
  return textResult(
    `## Project Not Indexed\n\n` +
    `No \`.springgraph/springkg.db\` was found. Run \`springkg init && springkg index\` first, then retry.\n\n` +
    `This is a SUCCESS-shaped response by design — the server stays queryable in unindexed workspaces.`
  );
}

/**
 * Helper: parse JSON metadata from a springkg row. Returns {} on parse error.
 */
export function parseMeta(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch { /* ignore */ }
  return {};
}

/**
 * Helper: format a springgraph-style source location string.
 */
export function fmtLocation(filePath: string | null | undefined, line: number | null | undefined): string {
  if (!filePath) return '(unknown location)';
  if (typeof line === 'number' && line > 0) return `${filePath}:${line}`;
  return filePath;
}
