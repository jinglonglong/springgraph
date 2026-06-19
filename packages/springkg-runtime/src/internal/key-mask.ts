import { createHash } from 'node:crypto';

/**
 * Mask sensitive config values. Sensitive keys match:
 * - /password|secret|token|access-key|secret-key|private-key|jwt\.secret/i
 * - Always sensitive: spring.datasource.password, spring.redis.password, nacos.password
 */
export function isSensitiveKey(key: string): boolean {
  const alwaysSensitive = [
    'spring.datasource.password',
    'spring.redis.password',
    'nacos.password',
  ];
  if (alwaysSensitive.includes(key)) return true;

  const pattern = /password|secret|token|access-key|secret-key|private-key|jwt\.secret/i;
  return pattern.test(key);
}

export interface MaskResult {
  masked: string;
  isSensitive: boolean;
}

export function maskValue(key: string, value: string | null | undefined): MaskResult {
  if (value === null || value === undefined || value === '') {
    return { masked: '***', isSensitive: isSensitiveKey(key) };
  }

  const sensitive = isSensitiveKey(key);
  if (!sensitive) {
    return { masked: value, isSensitive: false };
  }

  if (value.length >= 4) {
    return { masked: '***' + value.slice(-4), isSensitive: true };
  }
  return { masked: '***', isSensitive: true };
}

/**
 * Compute deterministic ID from content
 */
export function computeId(kind: string, content: string): string {
  return `${kind}:${createHash('sha256').update(content).digest('hex').slice(0, 32)}`;
}
