import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockSpringKg, seedConfigProperty } from '../../../springkg-cli/__tests__/test-helpers.js';
import { handleEnvDiff } from '../../src/tools/env-diff.js';

let mockSk: ReturnType<typeof createMockSpringKg>;
const sk = () => mockSk as unknown as import('@jinglonglong/springkg-core').SpringKg;

function textOf(result: { content: ReadonlyArray<{ type: string; text: string }> }): string {
  return result.content.map((entry) => entry.text).join('\n');
}

beforeEach(() => {
  mockSk = createMockSpringKg();
});

afterEach(async () => {
  await mockSk.close();
});

describe('spring_env_diff', () => {
  it('compares two inferred environments and masks sensitive values', async () => {
    const db = mockSk.db.getDb();
    seedConfigProperty(db, { key: 'payment.timeout', value_hash: 'dev-timeout', is_sensitive: false, source_file_path: 'config/application-dev.yml', source_line: 4 });
    seedConfigProperty(db, { key: 'payment.timeout', value_hash: 'prod-timeout', is_sensitive: false, source_file_path: 'config/application-prod.yml', source_line: 4 });
    seedConfigProperty(db, { key: 'payment.secret', value_hash: 'dev-secret', is_sensitive: true, source_file_path: 'config/application-dev.yml', source_line: 8 });
    seedConfigProperty(db, { key: 'payment.secret', value_hash: 'prod-secret', is_sensitive: true, source_file_path: 'config/application-prod.yml', source_line: 8 });

    const result = await handleEnvDiff(sk(), { env1: 'dev', env2: 'prod' });
    const text = textOf(result);
    expect(text).toContain('## Differences');
    expect(text).toContain('payment.timeout');
    expect(text).toContain('payment.secret');
    expect(text).toContain('***');
    expect(text).not.toContain('prod-secret');
  });
});
