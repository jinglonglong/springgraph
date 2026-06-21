/**
 * MyBatis relationship synthesizer — Phase 4.
 *
 * Links Java Mapper interface methods to their XML statement counterparts and
 * Entity fields to MyBatis XML column references. This closes the Java ↔ XML
 * boundary so trace/impact can follow a request through the data-access layer.
 *
 * All synthesized edges carry `provenance:'heuristic'` and
 * `metadata.synthesizedBy:'mybatis-xml-impact'`.
 */

import type { Edge, Node } from '../../types';
import type { QueryBuilder } from '../../db/queries';
import type { ResolutionContext } from '../types';

const JAVA_LANGS = new Set(['java', 'kotlin']);

interface XmlStatement {
  node: Node;
  namespace: string;
  statementId: string;
  tableHints: string[];
  columnHints: string[];
}

interface EntityField {
  node: Node;
  classNode: Node;
  columnName?: string;
  normalizedName: string;
}

/**
 * Parse a decorator/annotation string into simple name and argument body.
 */
function parseAnnotation(decorator: string): { name: string; args: string | null } {
  let raw = decorator.trim();
  if (raw.startsWith('@')) raw = raw.slice(1);
  const openParen = raw.indexOf('(');
  const hasArgs = openParen !== -1 && raw.endsWith(')');
  const fullName = hasArgs ? raw.slice(0, openParen) : raw;
  const name = fullName.split('.').pop() || fullName;
  const args = hasArgs ? raw.slice(openParen + 1, -1) : null;
  return { name, args };
}

function extractStringLiteral(input: string | null, key?: string): string | undefined {
  if (!input) return undefined;
  if (key) {
    const m = input.match(new RegExp(`${key}\\s*=\\s*["']([^"']+)["']`));
    if (m) return m[1];
  }
  const m = input.match(/["']([^"']+)["']/);
  return m ? m[1] : undefined;
}

function normalizeName(name: string): string {
  return name.replace(/_/g, '').toLowerCase();
}

/**
 * Parse XML statement nodes produced by MyBatisExtractor.
 * Qualified name format: `<namespace>::<id>`.
 */
function parseXmlStatements(queries: QueryBuilder): XmlStatement[] {
  const statements: XmlStatement[] = [];
  for (const node of queries.getNodesByKind('method')) {
    if (node.language !== 'xml') continue;
    const qn = node.qualifiedName;
    const sep = qn.indexOf('::');
    if (sep < 0) continue;
    const namespace = qn.slice(0, sep);
    const statementId = qn.slice(sep + 2);
    const meta = node.metadata || {};
    statements.push({
      node,
      namespace,
      statementId,
      tableHints: (meta.tableHints as string[]) || [],
      columnHints: (meta.columnHints as string[]) || [],
    });
  }
  return statements;
}

/**
 * Find the qualified class name (package + class) for a Java node by walking
 * up to its file's package declaration or using the node qualifiedName.
 */
function qualifiedClassName(cls: Node, ctx: ResolutionContext): string | undefined {
  if (cls.qualifiedName && cls.qualifiedName.includes('.')) {
    return cls.qualifiedName;
  }
  const nodesInFile = ctx.getNodesInFile(cls.filePath);
  const pkg = nodesInFile.find(n => n.kind === 'module');
  if (pkg) {
    const pkgName = pkg.name;
    return pkgName ? `${pkgName}.${cls.name}` : cls.name;
  }
  return cls.name;
}

/**
 * Build a map from `qualifiedClassName.methodName` to Java method node.
 */
function buildJavaMethodIndex(queries: QueryBuilder, ctx: ResolutionContext): Map<string, Node> {
  const index = new Map<string, Node>();
  for (const node of queries.getNodesByKind('method')) {
    if (!JAVA_LANGS.has(node.language)) continue;
    const cls = findEnclosingClass(node, queries);
    if (!cls) continue;
    // Primary: use qualifiedClassName (package.ClassName.methodName)
    const qcn = qualifiedClassName(cls, ctx);
    if (qcn) {
      index.set(`${qcn}.${node.name}`, node);
    }
    // Fallback: use method's own qualifiedName which may carry the full package path
    // even when no module node exists for the package declaration.
    // Java extractor uses :: as separator, e.g. "com.example::UserMapper::selectById"
    if (node.qualifiedName) {
      const key = node.qualifiedName.replace(/::/g, '.');
      if (!index.has(key)) index.set(key, node);
    }
  }
  return index;
}

function findEnclosingClass(method: Node, queries: QueryBuilder): Node | null {
  // Prefer contains edge from a class or interface
  for (const edge of queries.getIncomingEdges(method.id, ['contains'])) {
    const parent = queries.getNodeById(edge.source);
    if (parent && (parent.kind === 'class' || parent.kind === 'interface')) return parent;
  }
  return null;
}

/**
 * Collect Entity fields with explicit @TableField mapping or a normalized name.
 */
function collectEntityFields(queries: QueryBuilder): EntityField[] {
  const fields: EntityField[] = [];
  const classes = queries.getNodesByKind('class').filter(c => JAVA_LANGS.has(c.language));
  for (const cls of classes) {
    const childEdges = queries.getOutgoingEdges(cls.id, ['contains']);
    for (const edge of childEdges) {
      const node = queries.getNodeById(edge.target);
      if (!node || (node.kind !== 'field' && node.kind !== 'property')) continue;
      let columnName: string | undefined;
      if (node.decorators) {
        for (const d of node.decorators) {
          const { name, args } = parseAnnotation(d);
          if (name === 'TableField') {
            columnName = extractStringLiteral(args) || extractStringLiteral(args, 'value');
          }
        }
      }
      fields.push({
        node,
        classNode: cls,
        columnName,
        normalizedName: normalizeName(node.name),
      });
    }
  }
  return fields;
}

/**
 * Best-effort extraction of table and column references from MyBatis SQL.
 */
export function extractSqlHints(sql: string): { tables: string[]; columns: string[] } {
  const tables: string[] = [];
  const columns: string[] = [];
  if (!sql) return { tables, columns };

  // Remove XML tags and MyBatis placeholders
  const cleaned = sql
    .replace(/<[^\>]+>/g, ' ')
    .replace(/#{[^}]+}/g, ' ? ')
    .replace(/\${[^}]+}/g, ' ? ')
    .replace(/--[^\n]*/g, ' ');

  // Tables: FROM / JOIN / INTO / UPDATE table_name
  const tableRe = /\b(?:from|join|into|update)\s+([`"]?[\w]+[`"]?)(?:\s+as\s+\w+)?/gi;
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(cleaned)) !== null) {
    tables.push(m[1]!.replace(/[`"]/g, ''));
  }

  // Columns: lightweight identifier extraction around common SQL keywords
  // Heuristic: identifiers before/after operators or in SELECT lists
  const columnRe = /\b([a-zA-Z_]\w*)\s*(?:=|!=|<>|<=|>=|<|>|like|in\s*\()/gi;
  while ((m = columnRe.exec(cleaned)) !== null) {
    const col = m[1]!;
    // Skip SQL keywords and obvious non-column tokens
    if (isSqlKeyword(col)) continue;
    columns.push(col);
  }

  // SELECT list identifiers: SELECT a, b, c FROM
  const selectRe = /\bselect\b([\s\S]*?)\bfrom\b/i;
  const selectMatch = selectRe.exec(cleaned);
  if (selectMatch) {
    const list = selectMatch[1]!;
    for (const part of list.split(',')) {
      const trimmed = part.trim();
      const aliasMatch = trimmed.match(/([\w.]+)(?:\s+as\s+)?\s*(\w+)?$/i);
      if (aliasMatch) {
        const rawId = aliasMatch[2] || aliasMatch[1] || '';
        const id = rawId.replace(/.*\./, '');
        if (id && !isSqlKeyword(id)) columns.push(id);
      }
    }
  }

  return {
    tables: [...new Set(tables)],
    columns: [...new Set(columns)],
  };
}

const SQL_KEYWORDS = new Set([
  'select', 'from', 'where', 'and', 'or', 'not', 'null', 'is', 'in', 'like',
  'between', 'exists', 'case', 'when', 'then', 'else', 'end', 'as', 'distinct',
  'count', 'sum', 'avg', 'min', 'max', 'order', 'by', 'group', 'having', 'limit',
  'offset', 'union', 'all', 'insert', 'update', 'delete', 'values', 'set', 'on',
  'inner', 'outer', 'left', 'right', 'full', 'join', 'cross', 'natural',
]);

function isSqlKeyword(word: string): boolean {
  return SQL_KEYWORDS.has(word.toLowerCase());
}

/**
 * Synthesize MyBatis edges:
 *  - Java Mapper method -> XML statement (by namespace + statement id)
 *  - XML statement column reference -> Entity field (by @TableField or naming)
 * Returns the number of edges inserted.
 */
export function synthesizeMyBatisEdges(queries: QueryBuilder, ctx: ResolutionContext): number {
  let inserted = 0;
  const seen = new Set<string>();

  const statements = parseXmlStatements(queries);
  const javaMethodIndex = buildJavaMethodIndex(queries, ctx);
  const entityFields = collectEntityFields(queries);

  for (const stmt of statements) {
    // 1. Link Java Mapper method to XML statement
    const javaKey = `${stmt.namespace}.${stmt.statementId}`;
    const javaMethod = javaMethodIndex.get(javaKey);
    if (javaMethod) {
      const edge: Edge = {
        source: javaMethod.id,
        target: stmt.node.id,
        kind: 'references',
        line: javaMethod.startLine,
        provenance: 'heuristic',
        metadata: {
          synthesizedBy: 'mybatis-xml-impact',
          linkType: 'mapper-method-to-xml-statement',
          namespace: stmt.namespace,
          statementId: stmt.statementId,
        },
      };
      const key = `${edge.source}>${edge.target}:${edge.kind}`;
      if (!seen.has(key)) {
        seen.add(key);
        queries.insertEdge(edge);
        inserted++;
      }
    }

    // 2. Link XML statement columns to Entity fields
    for (const col of stmt.columnHints) {
      const normalizedCol = normalizeName(col);
      const field = entityFields.find(f => f.columnName === col || f.normalizedName === normalizedCol);
      if (field) {
        const edge: Edge = {
          source: stmt.node.id,
          target: field.node.id,
          kind: 'references',
          line: stmt.node.startLine,
          provenance: 'heuristic',
          metadata: {
            synthesizedBy: 'mybatis-xml-impact',
            linkType: 'xml-column-to-entity-field',
            column: col,
            fieldRef: true,
          },
        };
        const key = `${edge.source}>${edge.target}:${edge.kind}:${col}`;
        if (!seen.has(key)) {
          seen.add(key);
          queries.insertEdge(edge);
          inserted++;
        }
      }
    }
  }

  return inserted;
}
