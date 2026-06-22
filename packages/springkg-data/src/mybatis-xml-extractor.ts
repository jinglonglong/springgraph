import { createHash } from 'node:crypto';

import type { SpringKgEdge, SpringKgNode, SpringKgSqlStatement } from '@colbymchenry/springkg-shared';

import { SqlTableColumnExtractor } from './sql-table-column';

type ExtractError = { message: string; line: number; severity: 'error' | 'warning' };
type Tag = { name: string; id: string; attrs: Record<string, string>; inner: string; line: number };
type ExtractResult = { symbols: SpringKgNode[]; sqlStatements: SpringKgSqlStatement[]; edges: SpringKgEdge[]; errors: ExtractError[] };

const TOP_LEVEL = /<(select|insert|update|delete|sql|resultMap)\b([^>]*)>/g;
const ATTR = /(\w+)\s*=\s*"([^"]*)"/g;
const INCLUDE = /<include\b[^>]*\brefid\s*=\s*"([^"]+)"[^>]*\/?>/g;
const DYNAMIC = /<(if|choose|when|otherwise|foreach|where|set|trim|bind)\b[^>]*\/?>|<\/(if|choose|when|otherwise|foreach|where|set|trim|bind)>/gi;
const RESULT_CHILD = /<(id|result|association|collection)\b([^>]*)\/?>/g;

export class MyBatisXmlExtractor {
  private readonly lineStarts: number[];
  private readonly sqlColumns = new SqlTableColumnExtractor();

  constructor(private readonly filePath: string, private readonly source: string) {
    this.lineStarts = [0];
    for (let i = 0; i < source.length; i += 1) if (source.charCodeAt(i) === 10) this.lineStarts.push(i + 1);
  }

  extract(): ExtractResult {
    const out: ExtractResult = { symbols: [], sqlStatements: [], edges: [], errors: [] };
    try {
      const mapper = this.findMapper();
      if (!mapper) return out;
      const tags = this.scanTags(mapper.body, mapper.offset);
      const fragmentTags = new Map(tags.filter((tag) => tag.name === 'sql').map((tag) => [tag.id, tag]));
      const fragmentNodes = new Map<string, SpringKgNode>();

      for (const tag of tags) {
        if (tag.name === 'resultMap') out.symbols.push(this.resultMapNode(mapper.namespace, tag));
        if (tag.name === 'sql') {
          const expanded = this.expand(tag.inner, fragmentTags, [tag.id]);
          const dynamicTags = this.dynamicTags(expanded.text);
          const confidence = this.confidence(dynamicTags, expanded.cycle);
          const node = this.symbol('mapper_method', mapper.namespace, tag.id, tag.line, confidence, {
            operation: 'FRAGMENT',
            sql_preview: this.preview(this.cleanSql(expanded.text).sql),
            dynamicTags,
            dynamic_cycle: expanded.cycle || undefined,
          });
          fragmentNodes.set(tag.id, node);
          out.symbols.push(node);
        }
      }

      for (const tag of tags) {
        if (!['select', 'insert', 'update', 'delete'].includes(tag.name)) continue;
        const expanded = this.expand(tag.inner, fragmentTags, []);
        const cleaned = this.cleanSql(expanded.text);
        const dynamicTags = this.dynamicTags(expanded.text);
        const confidence = this.confidence(dynamicTags, expanded.cycle);
        const method = this.symbol('mapper_method', mapper.namespace, tag.id, tag.line, confidence, {
          operation: tag.name.toUpperCase(),
          sql_preview: this.preview(cleaned.sql),
          dynamicTags,
          dynamic_cycle: expanded.cycle || undefined,
        });
        const sqlNode = this.symbol('sql_statement', mapper.namespace, `${tag.id}:sql`, tag.line, confidence, {
          mapperNamespace: mapper.namespace,
          statementId: tag.id,
          operation: tag.name.toUpperCase(),
          sql_preview: this.preview(cleaned.sql),
          xmlPath: this.filePath,
        });
        out.symbols.push(method, sqlNode);
        out.edges.push(this.edge(method.id, sqlNode.id, 'EXECUTES_SQL', confidence));

        for (const includeId of expanded.includes) {
          const fragment = fragmentNodes.get(includeId.split('.').pop() ?? includeId);
          if (fragment) out.edges.push(this.edge(method.id, fragment.id, 'BIND_TO', 1));
        }

        const tableInfo = this.sqlColumns.extract(cleaned.sql, { dynamicTags });
        out.sqlStatements.push({
          id: this.id('stmt', mapper.namespace, tag.id, cleaned.sql),
          mapperId: method.id,
          sqlHash: this.hash(cleaned.sql),
          sqlText: cleaned.sql,
          parameterCount: (cleaned.sql.match(/(#\{|\$\{|\?)/g) ?? []).length,
          tables: tableInfo.tables.map((table) => table.name),
          sourceFilePath: this.filePath,
          sourceLine: tag.line,
        });
      }
    } catch (error) {
      out.errors.push({ message: error instanceof Error ? error.message : String(error), line: 1, severity: 'error' });
      out.symbols.push(this.symbol('mapper_method', 'parse', 'parseError', 1, 0.4, { parseError: true }));
    }
    return out;
  }

  private findMapper(): { namespace: string; body: string; offset: number } | null {
    const match = /<mapper\b([^>]*)>/.exec(this.source);
    const namespace = match?.[1] ? this.attrs(match[1]).namespace : undefined;
    if (!match || !namespace) return null;
    const offset = match.index + match[0].length;
    const end = this.source.indexOf('</mapper>', offset);
    if (end < 0) throw new Error('Malformed mapper XML: missing </mapper>');
    return { namespace, body: this.source.slice(offset, end), offset };
  }

  private scanTags(body: string, offset: number): Tag[] {
    const tags: Tag[] = [];
    for (const match of body.matchAll(TOP_LEVEL)) {
      const name = match[1];
      const attrs = this.attrs(match[2] ?? '');
      const id = attrs.id;
      if (!name || !id) continue;
      const start = (match.index ?? 0) + match[0].length;
      const close = body.indexOf(`</${name}>`, start);
      if (close < 0) throw new Error(`Malformed mapper XML: missing </${name}> for ${id}`);
      tags.push({ name, id, attrs, inner: body.slice(start, close), line: this.line(offset + (match.index ?? 0)) });
    }
    return tags;
  }

  private expand(xml: string, fragments: Map<string, Tag>, seen: string[]): { text: string; includes: string[]; cycle: boolean } {
    const includes: string[] = [];
    let cycle = false;
    const text = xml.replace(INCLUDE, (_raw, refid: string) => {
      includes.push(refid);
      const local = refid.split('.').pop() ?? refid;
      if (seen.includes(local)) {
        cycle = true;
        return '';
      }
      const fragment = fragments.get(local);
      if (!fragment) return '';
      const expanded = this.expand(fragment.inner, fragments, [...seen, local]);
      cycle ||= expanded.cycle;
      includes.push(...expanded.includes);
      return expanded.text;
    });
    return { text, includes: [...new Set(includes)], cycle };
  }

  private cleanSql(xml: string): { sql: string } {
    return { sql: xml.replace(DYNAMIC, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() };
  }

  private dynamicTags(xml: string): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const match of xml.matchAll(DYNAMIC)) {
      const tag = (match[1] ?? match[2] ?? '').toLowerCase();
      if (tag) counts[tag] = (counts[tag] ?? 0) + 1;
    }
    return counts;
  }

  private resultMapNode(namespace: string, tag: Tag): SpringKgNode {
    const rows = Array.from(tag.inner.matchAll(RESULT_CHILD)).map((match) => {
      const attrs = this.attrs(match[2] ?? '');
      return { property: attrs.property, column: attrs.column, jdbcType: attrs.jdbcType };
    }).filter((row) => row.property || row.column || row.jdbcType);
    return this.symbol('mapper_method', namespace, tag.id, tag.line, 0.95, { operation: 'RESULT_MAP', resultMap: rows });
  }

  private confidence(dynamicTags: Record<string, number>, cycle: boolean): number {
    if (cycle) return 0.7;
    const tags = Object.keys(dynamicTags);
    if (tags.length === 0) return 0.9;
    if (tags.includes('foreach')) return 0.6;
    if (tags.some((tag) => ['if', 'choose', 'when', 'otherwise', 'trim', 'bind'].includes(tag))) return 0.7;
    return 0.8;
  }

  private symbol(kind: SpringKgNode['kind'], namespace: string, name: string, line: number, confidence: number, metadata: Record<string, unknown>): SpringKgNode {
    const id = this.id(kind, namespace, name, String(line));
    return {
      id,
      kind,
      springgraphNodeId: id,
      name,
      qualifiedName: `${namespace}.${name}`,
      filePath: this.filePath,
      startLine: line,
      endLine: line,
      metadata,
      confidence,
      createdAt: 0,
      updatedAt: 0,
    };
  }

  private edge(sourceId: string, targetId: string, kind: SpringKgEdge['kind'], confidence: number): SpringKgEdge {
    return { id: this.id(kind, sourceId, targetId), sourceId, targetId, kind, confidence, createdAt: 0 };
  }

  private attrs(raw: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const match of raw.matchAll(ATTR)) {
      const k = match[1];
      if (k) out[k] = match[2] || '';
    }
    return out;
  }

  private preview(sql: string): string { return sql.slice(0, 200); }
  private id(...parts: string[]): string { return `${parts[0]}:${this.hash(parts.join('|')).slice(0, 16)}`; }
  private hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }

  private line(offset: number): number {
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >>> 1;
      if ((this.lineStarts[mid] ?? 0) <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  }
}
