export interface SqlTableColumnResult {
  tables: { name: string; access: 'READ' | 'WRITE'; confidence: number }[];
  columns: { name: string; confidence: number }[];
  confidence: number;
}

const RESERVED_WORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER', 'CROSS', 'ON', 'USING',
  'GROUP', 'ORDER', 'BY', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'ALL', 'DISTINCT', 'AS', 'SET',
  'VALUES', 'INTO', 'UPDATE', 'DELETE', 'TABLE', 'INDEX', 'VIEW', 'DATABASE', 'SCHEMA', 'AND',
  'OR', 'NOT', 'NULL', 'IS', 'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'CASE', 'WHEN', 'THEN', 'ELSE',
  'END', 'WITH', 'RECURSIVE',
]);

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*(?:\.[A-Za-z_][A-Za-z0-9_$]*)?$/;
const BARE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;
const NUMERIC_LITERAL = /^\d+(?:\.\d+)?$/;

type TableAccess = 'READ' | 'WRITE';

export class SqlTableColumnExtractor {
  extract(sql: string, opts?: { dynamicTags?: Record<string, number> }): SqlTableColumnResult {
    const confidence = this.getConfidence(opts?.dynamicTags);
    const tables = new Map<string, TableAccess>();
    const columns = new Set<string>();
    const aliases = new Set<string>();
    const normalized = sql.replace(/\s+/g, ' ').trim();

    this.extractTables(normalized, tables, aliases);
    this.extractColumns(normalized, tables, aliases, columns);

    return {
      tables: Array.from(tables.entries()).map(([name, access]) => ({ name, access, confidence })),
      columns: Array.from(columns).map((name) => ({ name, confidence })),
      confidence,
    };
  }

  private extractTables(sql: string, tables: Map<string, TableAccess>, aliases: Set<string>): void {
    const addTable = (rawIdent: string | undefined, access: TableAccess, tail = ''): void => {
      const parsed = this.parseTableReference(rawIdent, tail);
      if (!parsed) return;
      tables.set(parsed.name, tables.get(parsed.name) ?? access);
      if (parsed.alias) aliases.add(parsed.alias);
    };

    for (const match of sql.matchAll(/\bFROM\s+([A-Za-z_][A-Za-z0-9_$.]*)([^,;)]*)/gi)) {
      addTable(match[1], 'READ', match[2] ?? '');
    }
    for (const match of sql.matchAll(/\bJOIN\s+([A-Za-z_][A-Za-z0-9_$.]*)([^,;)]*)/gi)) {
      addTable(match[1], 'READ', match[2] ?? '');
    }
    for (const match of sql.matchAll(/\bINSERT\s+INTO\s+([A-Za-z_][A-Za-z0-9_$.]*)([^,;)]*)/gi)) {
      addTable(match[1], 'WRITE', match[2] ?? '');
    }
    for (const match of sql.matchAll(/\bUPDATE\s+([A-Za-z_][A-Za-z0-9_$.]*)([^,;)]*)/gi)) {
      addTable(match[1], 'WRITE', match[2] ?? '');
    }
    for (const match of sql.matchAll(/\bDELETE\s+FROM\s+([A-Za-z_][A-Za-z0-9_$.]*)([^,;)]*)/gi)) {
      addTable(match[1], 'WRITE', match[2] ?? '');
    }
    for (const match of sql.matchAll(/\bTRUNCATE\s+TABLE\s+([A-Za-z_][A-Za-z0-9_$.]*)([^,;)]*)/gi)) {
      addTable(match[1], 'WRITE', match[2] ?? '');
    }
  }

  private extractColumns(
    sql: string,
    tables: Map<string, TableAccess>,
    aliases: Set<string>,
    columns: Set<string>,
  ): void {
    const selectMatch = /\bSELECT\s+([\s\S]*?)\s+FROM\b/i.exec(sql);
    if (selectMatch) {
      for (const part of selectMatch[1]!.split(',')) {
        const candidate = this.normalizeColumnToken(part, aliases, tables);
        if (candidate) columns.add(candidate);
      }
    }

    const insertMatch = /\bINSERT\s+INTO\s+[A-Za-z_][A-Za-z0-9_$.]*\s*\(([^)]*)\)\s*VALUES\b/i.exec(sql);
    if (insertMatch) {
      for (const part of insertMatch[1]!.split(',')) {
        const candidate = this.normalizeColumnToken(part, aliases, tables);
        if (candidate) columns.add(candidate);
      }
    }

    const updateMatch = /\bUPDATE\s+[A-Za-z_][A-Za-z0-9_$.]*(?:\s+[A-Za-z_][A-Za-z0-9_$]*)?\s+SET\s+([\s\S]*?)(?:\s+WHERE\s+([\s\S]*))?$/i.exec(sql);
    if (updateMatch) {
      for (const assignment of updateMatch[1]!.split(',')) {
        const candidate = this.normalizeColumnToken(assignment.split('=')[0] ?? '', aliases, tables);
        if (candidate) columns.add(candidate);
      }
      if (updateMatch[2]) {
        for (const match of updateMatch[2].matchAll(/\b([A-Za-z_][A-Za-z0-9_$.]*)\b/g)) {
          const token = match[1];
          if (!token) continue;
          const candidate = this.normalizeColumnToken(token, aliases, tables);
          if (candidate) columns.add(candidate);
        }
      }
    }

    const joinOnClauses = sql.matchAll(/\bON\s+([\s\S]*?)(?=\b(?:WHERE|GROUP|ORDER|HAVING|LIMIT|OFFSET|UNION)\b|$)/gi);
    for (const clause of joinOnClauses) {
      const onClause = clause[1];
      if (!onClause) continue;
      for (const match of onClause.matchAll(/\b([A-Za-z_][A-Za-z0-9_$.]*)\b/g)) {
        const token = match[1];
        if (!token) continue;
        const candidate = this.normalizeColumnToken(token, aliases, tables);
        if (candidate) columns.add(candidate);
      }
    }
  }

  private parseTableReference(rawIdent: string | undefined, tail: string): { name: string; alias?: string } | null {
    if (!rawIdent) return null;
    const stripped = this.stripSchema(rawIdent);
    if (!this.isValidIdentifier(stripped) || this.isReservedWord(stripped)) return null;

    const tokens = tail.trim().match(/[A-Za-z_][A-Za-z0-9_$]*|\(/g) ?? [];
    let alias: string | undefined;
    if (tokens[0] && !this.isReservedWord(tokens[0]) && tokens[1] !== '(') {
      alias = tokens[0];
    }
    if (tokens[0]?.toUpperCase() === 'AS' && tokens[1] && !this.isReservedWord(tokens[1]) && tokens[2] !== '(') {
      alias = tokens[1];
    }

    return { name: stripped, alias };
  }

  private normalizeColumnToken(token: string, aliases: Set<string>, tables: Map<string, TableAccess>): string | null {
    const cleaned = token
      .replace(/`|"|'|\[|\]/g, ' ')
      .replace(/\bAS\b[\s\S]*$/i, ' ')
      .trim();
    if (!cleaned || cleaned === '*' || NUMERIC_LITERAL.test(cleaned)) return null;

    const identifierMatch = cleaned.match(/[A-Za-z_][A-Za-z0-9_$.]*/);
    if (!identifierMatch) return null;

    let candidate = identifierMatch[0];
    if (candidate.includes('.')) {
      const [prefix, suffix] = candidate.split('.', 2);
      if (!prefix || !suffix) return null;
      if (aliases.has(prefix) || tables.has(this.stripSchema(prefix))) {
        candidate = suffix;
      } else {
        candidate = suffix;
      }
    }

    candidate = this.stripSchema(candidate);
    if (
      !BARE_IDENTIFIER.test(candidate) ||
      this.isReservedWord(candidate) ||
      NUMERIC_LITERAL.test(candidate)
    ) {
      return null;
    }

    return candidate;
  }

  private getConfidence(dynamicTags?: Record<string, number>): number {
    if (!dynamicTags || Object.keys(dynamicTags).length === 0) return 1;
    const tags = Object.keys(dynamicTags).map((tag) => tag.toLowerCase());
    if (tags.includes('foreach')) return 0.5;
    if (tags.some((tag) => tag === 'if' || tag === 'choose' || tag === 'when')) return 0.7;
    if (tags.every((tag) => tag === 'where' || tag === 'set')) return 0.9;
    return 1;
  }

  private stripSchema(identifier: string): string {
    return identifier.split('.').pop() ?? identifier;
  }

  private isReservedWord(value: string): boolean {
    return RESERVED_WORDS.has(value.toUpperCase());
  }

  private isValidIdentifier(value: string): boolean {
    return IDENTIFIER.test(value);
  }
}
