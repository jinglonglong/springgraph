import { describe, expect, it } from 'vitest';

import { SqlTableColumnExtractor } from '../src/sql-table-column';

describe('SqlTableColumnExtractor', () => {
  const extractor = new SqlTableColumnExtractor();

  it('extracts SELECT tables and columns', () => {
    expect(extractor.extract('SELECT id, name FROM users WHERE id = ?')).toEqual({
      tables: [{ name: 'users', access: 'READ', confidence: 1 }],
      columns: [
        { name: 'id', confidence: 1 },
        { name: 'name', confidence: 1 },
      ],
      confidence: 1,
    });
  });

  it('extracts INSERT target table and column list', () => {
    expect(extractor.extract('INSERT INTO orders (user_id, total) VALUES (?, ?)')).toEqual({
      tables: [{ name: 'orders', access: 'WRITE', confidence: 1 }],
      columns: [
        { name: 'user_id', confidence: 1 },
        { name: 'total', confidence: 1 },
      ],
      confidence: 1,
    });
  });

  it('extracts UPDATE target table and columns from SET and WHERE', () => {
    expect(extractor.extract('UPDATE users SET name = ? WHERE id = ?')).toEqual({
      tables: [{ name: 'users', access: 'WRITE', confidence: 1 }],
      columns: [
        { name: 'name', confidence: 1 },
        { name: 'id', confidence: 1 },
      ],
      confidence: 1,
    });
  });

  it('strips aliases and captures joined table references', () => {
    expect(extractor.extract('SELECT u.id, u.name FROM users u JOIN orders o ON u.id = o.user_id')).toEqual({
      tables: [
        { name: 'users', access: 'READ', confidence: 1 },
        { name: 'orders', access: 'READ', confidence: 1 },
      ],
      columns: [
        { name: 'id', confidence: 1 },
        { name: 'name', confidence: 1 },
        { name: 'user_id', confidence: 1 },
      ],
      confidence: 1,
    });
  });

  it('drops confidence when dynamic conditional tags are present', () => {
    expect(extractor.extract('SELECT id FROM users', { dynamicTags: { if: 1 } })).toEqual({
      tables: [{ name: 'users', access: 'READ', confidence: 0.7 }],
      columns: [{ name: 'id', confidence: 0.7 }],
      confidence: 0.7,
    });
  });
});
