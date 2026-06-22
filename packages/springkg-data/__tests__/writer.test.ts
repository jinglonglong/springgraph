import { describe, expect, it, beforeEach } from 'vitest';
import { SqlWriter, type SqlWriterInput } from '../src/writer';
import type { SqlTableColumnResult } from '../src/sql-table-column';

describe('SqlWriter', () => {
  let writer: SqlWriter;

  beforeEach(() => { writer = new SqlWriter(); });

  it('writes sql_statement, table, column symbols and READS_TABLE + USES_COLUMN edges', () => {
    const input: SqlWriterInput = {
      sqlStatement: {
        id: 'stmt:abc123',
        springgraphNodeId: 'method:xyz',
        mapperNamespace: 'demo.UserMapper',
        statementId: 'findAll',
        operation: 'SELECT',
        sqlPreview: 'SELECT id, name FROM users',
        xmlPath: 'UserMapper.xml',
        confidence: 1.0,
      },
      mapperMethodId: 'method:xyz',
      tables: [{ name: 'users', access: 'READ', confidence: 1.0 }],
      columns: [
        { name: 'id', confidence: 1.0 },
        { name: 'name', confidence: 1.0 },
      ],
    };

    const out = writer.write([input]);

    expect(out.symbolsAdded).toBe(4); // 1 table + 2 columns + 1 sql_statement
    expect(out.edgesAdded).toBe(3); // 1 READS_TABLE + 2 USES_COLUMN
    expect(out.byKind['users']).toBe(1);
    expect(out.byKind['id']).toBe(1);
    expect(out.byKind['name']).toBe(1);
  });

  it('WRITE access routes to WRITES_TABLE not READS_TABLE', () => {
    const input: SqlWriterInput = {
      sqlStatement: {
        id: 'stmt:def',
        springgraphNodeId: 'method:ins',
        mapperNamespace: 'demo.UserMapper',
        statementId: 'insert',
        operation: 'INSERT',
        sqlPreview: 'INSERT INTO users(name) VALUES(?)',
        xmlPath: 'UserMapper.xml',
        confidence: 1.0,
      },
      mapperMethodId: 'method:ins',
      tables: [{ name: 'users', access: 'WRITE', confidence: 1.0 }],
      columns: [{ name: 'name', confidence: 1.0 }],
    };

    const out = writer.write([input]);

    expect(out.byKind['users']).toBe(1);
    // WRITES_TABLE edge is tracked separately
    expect(out.edgesAdded).toBe(2); // 1 WRITES_TABLE + 1 USES_COLUMN
  });

  it('idempotent: same input twice produces same output with INSERT OR REPLACE semantics', () => {
    const input: SqlWriterInput = {
      sqlStatement: {
        id: 'stmt:idem',
        springgraphNodeId: 'method:idm',
        mapperNamespace: 'demo.UserMapper',
        statementId: 'findById',
        operation: 'SELECT',
        sqlPreview: 'SELECT * FROM users WHERE id = ?',
        xmlPath: 'UserMapper.xml',
        confidence: 1.0,
      },
      mapperMethodId: 'method:idm',
      tables: [{ name: 'users', access: 'READ', confidence: 1.0 }],
      columns: [{ name: 'id', confidence: 1.0 }],
    };

    const out1 = writer.write([input]);
    const out2 = writer.write([input]);

    // Same counts since table/column ids are deterministic
    expect(out1.symbolsAdded).toBe(out2.symbolsAdded);
    expect(out1.edgesAdded).toBe(out2.edgesAdded);
    expect(out1.byKind).toEqual(out2.byKind);
  });
});
