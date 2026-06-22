/**
 * AnnotationSqlExtractor — parses Java/Kotlin source for MyBatis annotation SQL.
 *
 * Handles: @Select, @Insert, @Update, @Delete, @SelectProvider,
 * @InsertProvider, @UpdateProvider, @DeleteProvider.
 */

import { createHash } from 'node:crypto';
import type { SpringKgNode, SpringKgEdge } from '@jinglonglong/springkg-shared';

export interface AnnotationSqlExtractorResult {
  symbols: SpringKgNode[];
  sqlStatements: Array<{
    id: string;
    springgraphNodeId: string;
    mapperNamespace: string;
    statementId: string;
    operation: string;
    sqlPreview: string;
    xmlPath: string;
    confidence: number;
  }>;
  edges: SpringKgEdge[];
  errors: Array<{ message: string; line: number; severity: 'error' | 'warning' }>;
}

function generateNodeId(kind: string, qualified: string): string {
  return `${kind}:${createHash('sha256').update(kind + qualified).digest('hex').slice(0, 16)}`;
}

function normalizeSql(sql: string): string {
  return sql
    .replace(/#\{[^}]+\}/g, '?')
    .replace(/\$\{[^}]+\}/g, '?')
    .replace(/@\{[^}]+\}/g, '?')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectDynamicTags(sql: string): Record<string, number> {
  const tags: Record<string, number> = {};
  if (/#\{/.test(sql)) tags['parameter'] = (sql.match(/#\{/g) ?? []).length;
  if (/\$\{/.test(sql)) { tags['bind'] = (sql.match(/\$\{/g) ?? []).length; tags['unsafe'] = 1; }
  if (/@\{/.test(sql)) tags['spel'] = (sql.match(/@\{/g) ?? []).length;
  return tags;
}

export class AnnotationSqlExtractor {
  constructor(
    private readonly filePath: string,
    private readonly source: string,
  ) {}

  extract(): AnnotationSqlExtractorResult {
    const symbols: SpringKgNode[] = [];
    const sqlStatements: AnnotationSqlExtractorResult['sqlStatements'] = [];
    const edges: SpringKgEdge[] = [];
    const errors: AnnotationSqlExtractorResult['errors'] = [];

    try {
      // Match annotation-based SQL methods — works with multi-line SQL
      // Group 1 = annotation name (e.g. "@Select"), Group 2 = raw SQL string
      const methodRegex = /@(Select|Insert|Update|Delete|SelectProvider|InsertProvider|UpdateProvider|DeleteProvider)\s*\(\s*"(.*?)"\s*\)/gs;
      // For provider: @SelectProvider(type=Mapper.class, method="buildSelect")
      const providerRegex = /@(SelectProvider|InsertProvider|UpdateProvider|DeleteProvider)\s*\(\s*type\s*=\s*([\w.]+)\s*,\s*method\s*=\s*"([^"]+)"\s*\)/g;

      let m: RegExpExecArray | null;

      // Direct SQL annotations
      while ((m = methodRegex.exec(this.source)) !== null) {
        const annotation = '@' + m[1]!;
        const rawSql = m[2] ?? '';
        const line = this.getLine(m.index);

        const dynamicTags = detectDynamicTags(rawSql);
        const sqlText = normalizeSql(rawSql);
        const confidence = this.computeConfidence(dynamicTags);
        const qualifiedName = `${this.filePath}:${sqlText.slice(0, 50)}:${line}`;
        const nodeId = generateNodeId('mapper_method', qualifiedName);
        const stmtId = generateNodeId('sql_statement', qualifiedName);
        const metadata: Record<string, unknown> = {
          operation: annotation.replace('@', '').toUpperCase(),
          sqlPreview: sqlText.slice(0, 200),
          dynamicTags,
        };

        symbols.push(this.buildMethodNode(nodeId, sqlText.slice(0, 50), metadata, confidence, line));

        sqlStatements.push({
          id: stmtId,
          springgraphNodeId: nodeId,
          mapperNamespace: this.filePath,
          statementId: sqlText.slice(0, 50),
          operation: annotation.replace('@', '').toUpperCase(),
          sqlPreview: sqlText.slice(0, 200),
          xmlPath: this.filePath,
          confidence,
        });

        edges.push({
          id: generateNodeId('EXECUTES_SQL', `${nodeId}->${stmtId}`),
          sourceId: nodeId,
          targetId: stmtId,
          kind: 'EXECUTES_SQL',
          metadata,
          confidence,
          createdAt: Date.now(),
        });
      }

      // Provider annotations
      while ((m = providerRegex.exec(this.source)) !== null) {
        const annotation = '@' + m[1]!;
        const providerType = m[2] ?? '';
        const providerMethod = m[3] ?? 'unknown';
        const line = this.getLine(m.index);
        const qualifiedName = `${this.filePath}:${providerMethod}:${line}`;
        const nodeId = generateNodeId('mapper_method', qualifiedName);
        const stmtId = generateNodeId('sql_statement', qualifiedName);
        const metadata: Record<string, unknown> = {
          operation: annotation.replace('@', '').toUpperCase(),
          providerMethod,
          providerType,
          sqlPreview: `[PROVIDER:${providerMethod}]`,
        };

        symbols.push(this.buildMethodNode(nodeId, providerMethod, metadata, 0.5, line));
        sqlStatements.push({
          id: stmtId,
          springgraphNodeId: nodeId,
          mapperNamespace: this.filePath,
          statementId: providerMethod,
          operation: annotation.replace('@', '').toUpperCase(),
          sqlPreview: `[PROVIDER:${providerMethod}]`,
          xmlPath: this.filePath,
          confidence: 0.5,
        });
      }
    } catch (err) {
      errors.push({
        message: err instanceof Error ? err.message : String(err),
        line: 1,
        severity: 'error',
      });
    }

    return { symbols, sqlStatements, edges, errors };
  }

  private buildMethodNode(
    id: string,
    name: string,
    metadata: Record<string, unknown>,
    confidence: number,
    startLine: number,
  ): SpringKgNode {
    return {
      id,
      kind: 'mapper_method',
      springgraphNodeId: id,
      name,
      filePath: this.filePath,
      startLine,
      endLine: startLine,
      metadata,
      confidence,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  /*
  private findResultsNear(_sql: string, _line: number): Array<{ property: string; column: string; jdbcType?: string }> {
    // Find @Results annotation following the method — simplified approach
    // Look for @Result entries within ~5 lines after the annotation
    const results: Array<{ property: string; column: string; jdbcType?: string }> = [];
    const resultEntryRegex = /@Result\s*\([^)]*\bproperty\s*=\s*"([^"]+)"[^)]*\bcolumn\s*=\s*"([^"]+)"[^)]*(?:\bjdbcType\s*=\s*"([^"]+)")?[^)]*\)/g;
    let rm: RegExpExecArray | null;
    while ((rm = resultEntryRegex.exec(this.source)) !== null) {
      results.push({ property: rm[1]!, column: rm[2]!, jdbcType: rm[3] });
    }
    return results;
  }
  */

  private computeConfidence(dynamicTags: Record<string, number>): number {
    const keys = Object.keys(dynamicTags);
    if (keys.includes('unsafe') || keys.includes('spel')) return 0.5;
    if (keys.includes('bind')) return 0.6;
    if (keys.includes('parameter')) return 0.8;
    return 1.0;
  }

  private lineStarts: number[] = [];
  private computeLineStarts(): void {
    this.lineStarts = [0];
    for (let i = 0; i < this.source.length; i++) {
      if (this.source.charCodeAt(i) === 10) this.lineStarts.push(i + 1);
    }
  }

  private getLine(offset: number): number {
    if (this.lineStarts.length === 0) this.computeLineStarts();
    let lo = 0, hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (this.lineStarts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }
}
