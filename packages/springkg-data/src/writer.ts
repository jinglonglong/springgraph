import type { SpringKgEnhanceOutput } from '@colbymchenry/springkg-shared';
import type { SqlTableColumnResult } from './sql-table-column';

export interface SqlWriterInput {
  sqlStatement: {
    id: string;
    codegraphNodeId: string;
    mapperNamespace: string;
    statementId: string;
    operation: string;
    sqlPreview: string;
    xmlPath: string;
    confidence: number;
  };
  mapperMethodId: string;
  tables: SqlTableColumnResult['tables'];
  columns: SqlTableColumnResult['columns'];
}

export class SqlWriter {
  write(inputs: SqlWriterInput[]): SpringKgEnhanceOutput {
    const symbolsAdded = { table: 0, column: 0, sql_statement: inputs.length };
    const edgesAdded = { READS_TABLE: 0, WRITES_TABLE: 0, USES_COLUMN: 0 };
    const byKind: Record<string, number> = {};

    for (const input of inputs) {
      // Table symbols
      for (const table of input.tables) {
        byKind[table.name] = (byKind[table.name] ?? 0) + 1;
        symbolsAdded.table++;
        edgesAdded[table.access === 'READ' ? 'READS_TABLE' : 'WRITES_TABLE']++;
      }

      // Column symbols
      for (const col of input.columns) {
        byKind[col.name] = (byKind[col.name] ?? 0) + 1;
        symbolsAdded.column++;
        edgesAdded.USES_COLUMN++;
      }
    }

    const totalSymbols = symbolsAdded.table + symbolsAdded.column + symbolsAdded.sql_statement;
    const totalEdges = edgesAdded.READS_TABLE + edgesAdded.WRITES_TABLE + edgesAdded.USES_COLUMN;

    return {
      symbolsAdded: totalSymbols,
      edgesAdded: totalEdges,
      byKind,
    };
  }
}
