import type { SpringKg } from '@colbymchenry/springkg-core';
import { notFoundResult, textResult } from '../lib/format.js';

interface ConfigRow {
  key: string;
  value_hash: string;
  is_sensitive: number;
  source_file_path: string;
  source_line: number;
  bean_id: string | null;
}

export async function handleEnvDiff(
  sk: SpringKg,
  args: Record<string, unknown> | undefined,
): Promise<{ content: ReadonlyArray<{ type: 'text'; text: string }> }> {
  const env1 = typeof args?.env1 === 'string' ? args.env1.trim() : '';
  const env2 = typeof args?.env2 === 'string' ? args.env2.trim() : '';

  if (!env1 || !env2) {
    return textResult(
      '## spring_env_diff\n\n'
      + 'Required input: `{ "env1": "dev", "env2": "prod" }`.\n\n'
      + 'Compares runtime_config_properties by inferring environment names from source file paths and bean prefixes. Sensitive values stay masked.',
    );
  }

  const db = sk.db.getDb();
  const rows = db.prepare(
    'SELECT key, value_hash, is_sensitive, source_file_path, source_line, bean_id FROM runtime_config_properties ORDER BY key',
  ).all() as ConfigRow[];

  const env1Rows = rows.filter((row) => matchesEnv(row, env1));
  const env2Rows = rows.filter((row) => matchesEnv(row, env2));
  if (env1Rows.length === 0 && env2Rows.length === 0) {
    return notFoundResult('spring_env_diff', `config rows for environments "${env1}" and "${env2}"`);
  }

  const byKey = new Map<string, { left?: ConfigRow; right?: ConfigRow }>();
  for (const row of env1Rows) {
    const current = byKey.get(row.key) ?? {};
    current.left = row;
    byKey.set(row.key, current);
  }
  for (const row of env2Rows) {
    const current = byKey.get(row.key) ?? {};
    current.right = row;
    byKey.set(row.key, current);
  }

  const differences = Array.from(byKey.entries())
    .filter(([, pair]) => hasDifference(pair.left, pair.right))
    .sort(([left], [right]) => left.localeCompare(right));

  const sections: string[] = [];
  sections.push(`## Environment Comparison\n\n- env1: \`${env1}\` (${env1Rows.length} rows)\n- env2: \`${env2}\` (${env2Rows.length} rows)`);
  sections.push(
    differences.length > 0
      ? `## Differences\n\n${differences.map(([key, pair]) => `- \`${key}\` — ${env1}: ${formatValue(pair.left)} | ${env2}: ${formatValue(pair.right)}`).join('\n')}`
      : '## Differences\n\n_No indexed config differences were detected between these environments._',
  );
  sections.push(
    `## Notes\n\n`
    + '- Environment membership is inferred from `source_file_path` and `bean_id` because the current schema does not store an explicit profile column.\n'
    + '- Sensitive keys return `***`; non-sensitive rows return a short hash preview for safe comparison.',
  );

  return textResult(sections.join('\n\n'));
}

function matchesEnv(row: ConfigRow, env: string): boolean {
  const lowerEnv = env.toLowerCase();
  const haystacks = [row.source_file_path, row.bean_id ?? '', row.key].map((value) => value.toLowerCase());
  return haystacks.some((value) => value.includes(`-${lowerEnv}.`) || value.includes(`.${lowerEnv}.`) || value.includes(`_${lowerEnv}`) || value.includes(lowerEnv));
}

function hasDifference(left: ConfigRow | undefined, right: ConfigRow | undefined): boolean {
  if (!left || !right) {
    return true;
  }
  return left.value_hash !== right.value_hash || left.is_sensitive !== right.is_sensitive;
}

function formatValue(row: ConfigRow | undefined): string {
  if (!row) {
    return 'missing';
  }
  if (row.is_sensitive) {
    return '***';
  }
  return `hash:${row.value_hash.slice(0, 10)}`;
}
