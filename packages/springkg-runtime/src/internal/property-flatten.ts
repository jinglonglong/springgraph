/**
 * Flatten nested map to dotted keys.
 * { spring: { datasource: { url: 'x' } } } → { 'spring.datasource.url': 'x' }
 * Arrays are expanded with index notation:
 * { routes: [{ id: 'a' }, { id: 'b' }] } → { 'routes[0].id': 'a', 'routes[1].id': 'b' }
 */
export function flattenProperties(obj: any, prefix?: string): Record<string, any> {
  const result: Record<string, any> = {};

  if (obj === null || obj === undefined || typeof obj !== 'object') {
    if (prefix) {
      result[prefix] = obj;
    }
    return result;
  }

  if (Array.isArray(obj)) {
    if (prefix) {
      // Expand array elements with indexed keys
      for (let i = 0; i < obj.length; i++) {
        const nested = flattenProperties(obj[i], `${prefix}[${i}]`);
        Object.assign(result, nested);
      }
    }
    return result;
  }

  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;

    if (value !== null && typeof value === 'object') {
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const nested = flattenProperties(value[i], `${newKey}[${i}]`);
          Object.assign(result, nested);
        }
      } else {
        const nested = flattenProperties(value, newKey);
        Object.assign(result, nested);
      }
    } else {
      result[newKey] = value;
    }
  }

  return result;
}
