import type { Edge, Node } from '../types';
import type { QueryBuilder } from '../db/queries';
import type { ResolutionContext } from '../resolution/types';

const JAVA_LANGS = new Set(['java', 'kotlin']);

interface FieldAccess {
  sourceMethodId: string;
  targetFieldId: string;
  fieldRef: true;
  via?: 'direct' | 'getter' | 'setter' | 'lombok' | 'mapstruct' | 'jsonProperty';
  line: number;
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

function getterFieldName(methodName: string): string | undefined {
  if (methodName.startsWith('get') && methodName.length > 3) {
    return methodName[3]!.toLowerCase() + methodName.slice(4);
  }
  if (methodName.startsWith('is') && methodName.length > 2) {
    return methodName[2]!.toLowerCase() + methodName.slice(3);
  }
  return undefined;
}

function setterFieldName(methodName: string): string | undefined {
  if (methodName.startsWith('set') && methodName.length > 3) {
    return methodName[3]!.toLowerCase() + methodName.slice(4);
  }
  return undefined;
}

function findEnclosingClass(node: Node, queries: QueryBuilder): Node | null {
  for (const edge of queries.getIncomingEdges(node.id, ['contains'])) {
    const parent = queries.getNodeById(edge.source);
    if (parent?.kind === 'class' || parent?.kind === 'interface') return parent;
  }
  return null;
}

function getClassFields(cls: Node, queries: QueryBuilder): Node[] {
  return queries
    .getOutgoingEdges(cls.id, ['contains'])
    .map(e => queries.getNodeById(e.target))
    .filter((n): n is Node => !!n && (n.kind === 'field' || n.kind === 'property'));
}

function hasLombokAccessor(cls: Node, ctx: ResolutionContext): boolean {
  const source = ctx.readFile(cls.filePath);
  if (!source) return false;
  const lines = source.split(/\r?\n/);
  const start = Math.max(0, cls.startLine - 4);
  const end = Math.min(lines.length, cls.startLine + 1);
  const window = lines.slice(start, end).join('\n');
  return /@(lombok\.)?(Data|Getter|Setter)\b/.test(window);
}

/**
 * Build a map from class id to its fields.
 */
function buildClassFieldMap(queries: QueryBuilder): Map<string, Node[]> {
  const map = new Map<string, Node[]>();
  for (const cls of queries.getNodesByKind('class')) {
    if (!JAVA_LANGS.has(cls.language)) continue;
    map.set(cls.id, getClassFields(cls, queries));
  }
  return map;
}

/**
 * Build a map from class id to fields with explicit @JsonProperty aliases.
 */
function buildJsonPropertyAliases(
  fieldMap: Map<string, Node[]>,
  ctx: ResolutionContext,
): Map<string, Map<string, Node>> {
  const aliases = new Map<string, Map<string, Node>>();
  for (const [classId, fields] of fieldMap) {
    const classAliases = new Map<string, Node>();
    for (const f of fields) {
      const source = ctx.readFile(f.filePath);
      if (!source) continue;
      const lines = source.split(/\r?\n/);
      for (let line = Math.max(0, f.startLine - 3); line < f.startLine; line++) {
        const text = lines[line] ?? '';
        const match = text.match(/@(?:[\w.]+\.)?JsonProperty\(([^)]*)\)/);
        if (!match) continue;
        const value = extractStringLiteral(match[1] ?? null, 'value') || extractStringLiteral(match[1] ?? null);
        if (value) classAliases.set(value, f);
      }
    }
    if (classAliases.size > 0) aliases.set(classId, classAliases);
  }
  return aliases;
}

/**
 * Parse MapStruct @Mapping annotations from method source and emit field-impact
 * edges between source and target DTO/entity fields.
 */
function collectMapStructFieldEdges(
  method: Node,
  fieldMap: Map<string, Node[]>,
  queries: QueryBuilder,
  ctx: ResolutionContext,
): FieldAccess[] {
  const accesses: FieldAccess[] = [];
  if (!method.signature) return accesses;

  // Extract @Mapping(source="...", target="...") pairs from decorators
  const mappings: Array<{ source: string; target: string }> = [];
  const fileSource = ctx.readFile(method.filePath);
  if (fileSource) {
    const lines = fileSource.split(/\r?\n/);
    for (let line = Math.max(0, method.startLine - 4); line < method.startLine; line++) {
      const text = lines[line] ?? '';
      const match = text.match(/@(?:[\w.]+\.)?Mapping\(([^)]*)\)/);
      if (!match) continue;
      const args = match[1] ?? null;
      const source = extractStringLiteral(args, 'source');
      const target = extractStringLiteral(args, 'target');
      if (source && target) mappings.push({ source, target });
    }
  }
  if (mappings.length === 0) return accesses;

  // Resolve parameter types and return type from signature heuristics
  const paramTypes = parseParameterTypes(method.signature);
  const returnType = method.returnType;
  const sourceType = paramTypes[0];
  if (!sourceType || !returnType) return accesses;

  const sourceClass = findClassByName(sourceType, queries);
  const targetClass = findClassByName(returnType, queries);
  if (!sourceClass || !targetClass) return accesses;

  const sourceFields = fieldMap.get(sourceClass.id) || [];
  const targetFields = fieldMap.get(targetClass.id) || [];

  for (const { source, target } of mappings) {
    const srcField = sourceFields.find(f => f.name === source || normalizeName(f.name) === normalizeName(source));
    const tgtField = targetFields.find(f => f.name === target || normalizeName(f.name) === normalizeName(target));
    if (srcField && tgtField) {
      accesses.push({
        sourceMethodId: method.id,
        targetFieldId: tgtField.id,
        fieldRef: true,
        via: 'mapstruct',
        line: method.startLine,
      });
      accesses.push({
        sourceMethodId: method.id,
        targetFieldId: srcField.id,
        fieldRef: true,
        via: 'mapstruct',
        line: method.startLine,
      });
    }
  }

  return accesses;
}

function findClassByName(name: string, queries: QueryBuilder): Node | null {
  const candidates = queries.getNodesByName(name).filter(n => n.kind === 'class');
  return candidates[0] || null;
}

function parseParameterTypes(signature: string): string[] {
  const m = signature.match(/\(([^)]*)\)/);
  if (!m) return [];
  const body = m[1] || '';
  if (!body.trim()) return [];
  const parts: string[] = [];
  let cur = '';
  let depth = 0;
  for (const ch of body) {
    if (ch === '<' || ch === '(') depth++;
    else if (ch === '>' || ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  parts.push(cur.trim());

  return parts.map(p => {
    const tokens = p.split(/\s+/).filter(Boolean);
    for (let i = tokens.length - 2; i >= 0; i--) {
      const rawTok = tokens[i];
      if (!rawTok) continue;
      const tok = rawTok.replace(/[^\w.\[\]<>]/g, '');
      if (tok && !tok.startsWith('@') && !/\b(final|public|private|protected)\b/.test(tok)) {
        const base = tok.split('[')[0] || tok;
        const cleaned = base.replace(/\u003c[^\u003e]*\u003e/g, '').split('.').pop() || base;
        return cleaned;
      }
    }
    return '';
  }).filter(Boolean);
}

function parseParameterTypeMap(signature: string): Map<string, string> {
  const out = new Map<string, string>();
  const m = signature.match(/\(([^)]*)\)/);
  if (!m) return out;
  const body = m[1] || '';
  if (!body.trim()) return out;
  const parts: string[] = [];
  let cur = '';
  let depth = 0;
  for (const ch of body) {
    if (ch === '<' || ch === '(') depth++;
    else if (ch === '>' || ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  parts.push(cur.trim());

  for (const part of parts) {
    const tokens = part.split(/\s+/).filter(Boolean);
    if (tokens.length < 2) continue;
    const rawName = tokens[tokens.length - 1];
    if (!rawName) continue;
    const name = rawName.replace(/[^\w]/g, '');
    if (!name) continue;
    for (let i = tokens.length - 2; i >= 0; i--) {
      const rawTok = tokens[i];
      if (!rawTok) continue;
      const tok = rawTok.replace(/[^\w.\[\]<>]/g, '');
      if (tok && !tok.startsWith('@') && !/\b(final|public|private|protected)\b/.test(tok)) {
        const base = tok.split('[')[0] || tok;
        const cleaned = base.replace(/<[^>]*>/g, '').split('.').pop() || base;
        if (cleaned) out.set(name, cleaned);
        break;
      }
    }
  }
  return out;
}

/**
 * Collect direct field accesses and getter/setter calls within a method.
 */
function collectMethodFieldAccesses(
  method: Node,
  cls: Node,
  fieldMap: Map<string, Node[]>,
  jsonAliases: Map<string, Map<string, Node>>,
  queries: QueryBuilder,
  ctx: ResolutionContext,
): FieldAccess[] {
  const accesses: FieldAccess[] = [];
  const source = ctx.readFile(method.filePath);
  if (!source) return accesses;

  const classFields = fieldMap.get(cls.id) || [];
  const clsAliases = jsonAliases.get(cls.id);
  const methodSrc = source.split(/\r?\n/).slice((method.startLine || 1) - 1, method.endLine || method.startLine).join('\n');
  const parameterTypes = method.signature ? parseParameterTypeMap(method.signature) : new Map<string, string>();

  // Direct field access: this.fieldName or obj.fieldName where obj is a param of this class type
  for (const field of classFields) {
    const re = new RegExp(`\\bthis\\.${field.name}\\b`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(methodSrc)) !== null) {
      accesses.push({
        sourceMethodId: method.id,
        targetFieldId: field.id,
        fieldRef: true,
        via: 'direct',
        line: method.startLine + methodSrc.slice(0, m.index).split('\n').length - 1,
      });
    }
  }

  // Getter/setter calls on this or local variables
  const methodCallRe = /\b(\w+)\.(\w+)\s*\(/g;
  let mc: RegExpExecArray | null;
  while ((mc = methodCallRe.exec(methodSrc)) !== null) {
    const methodName = mc[2]!;
    const getterField = getterFieldName(methodName);
    const setterField = setterFieldName(methodName);
    if (!getterField && !setterField) continue;
    const via = setterField ? 'setter' : 'getter';
    const fieldName = (setterField || getterField)!;
    const receiver = mc[1]!;

    // Try enclosing class fields first
    let targetField = receiver === 'this'
      ? classFields.find(f => f.name === fieldName || normalizeName(f.name) === normalizeName(fieldName))
      : undefined;
    if (targetField) {
      accesses.push({
        sourceMethodId: method.id,
        targetFieldId: targetField.id,
        fieldRef: true,
        via,
        line: method.startLine + methodSrc.slice(0, mc.index).split('\n').length - 1,
      });
      continue;
    }

    const receiverType = receiver === 'this' ? cls.name : parameterTypes.get(receiver);
    if (receiverType) {
      const receiverClass = findClassByName(receiverType, queries);
      if (receiverClass) {
        const receiverFields = fieldMap.get(receiverClass.id) || [];
        targetField = receiverFields.find(
          fld => fld.name === fieldName || normalizeName(fld.name) === normalizeName(fieldName)
        );
        if (targetField) {
          accesses.push({
            sourceMethodId: method.id,
            targetFieldId: targetField.id,
            fieldRef: true,
            via: receiverClass.id === cls.id ? via : (hasLombokAccessor(receiverClass, ctx) ? 'lombok' : via),
            line: method.startLine + methodSrc.slice(0, mc.index).split('\n').length - 1,
          });
          continue;
        }
      }
    }

    if (!targetField) {
      for (const [otherClsId, otherFields] of fieldMap) {
        if (otherClsId === cls.id) continue;
        const otherCls = queries.getNodeById(otherClsId);
        if (!otherCls || !hasLombokAccessor(otherCls, ctx)) continue;
        const f = otherFields.find(fld => fld.name === fieldName || normalizeName(fld.name) === normalizeName(fieldName));
        if (f) {
          accesses.push({
            sourceMethodId: method.id,
            targetFieldId: f.id,
            fieldRef: true,
            via: 'lombok',
            line: method.startLine + methodSrc.slice(0, mc.index).split('\n').length - 1,
          });
          break;
        }
      }
    }
  }

  // @JsonProperty aliases: reference to logical property name via getLogicalName()
  if (clsAliases) {
    for (const [logicalName, field] of clsAliases) {
      const getterName = `get${logicalName.charAt(0).toUpperCase()}${logicalName.slice(1)}`;
      const re = new RegExp(`\\b${getterName}\\s*\\(`, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(methodSrc)) !== null) {
        accesses.push({
          sourceMethodId: method.id,
          targetFieldId: field.id,
          fieldRef: true,
          via: 'jsonProperty',
          line: method.startLine + methodSrc.slice(0, m.index).split('\n').length - 1,
        });
      }
    }
  }

  for (const field of classFields) {
    if (!clsAliases || ![...clsAliases.values()].some((candidate) => candidate.id === field.id)) continue;
    accesses.push({
      sourceMethodId: method.id,
      targetFieldId: field.id,
      fieldRef: true,
      via: 'jsonProperty',
      line: method.startLine,
    });
  }

  return accesses;
}

/**
 * Synthesize Java field-impact edges for direct access, getter/setter,
 * Lombok accessors, MapStruct mappings, and @JsonProperty aliases.
 * Returns the number of edges inserted.
 */
export function synthesizeJavaFieldImpact(queries: QueryBuilder, ctx: ResolutionContext): number {
  const fieldMap = buildClassFieldMap(queries);
  const jsonAliases = buildJsonPropertyAliases(fieldMap, ctx);
  let inserted = 0;
  const seen = new Set<string>();

  for (const method of queries.getNodesByKind('method')) {
    if (!JAVA_LANGS.has(method.language)) continue;
    const cls = findEnclosingClass(method, queries);
    if (!cls) continue;

    const accesses: FieldAccess[] = [
      ...collectMethodFieldAccesses(method, cls, fieldMap, jsonAliases, queries, ctx),
      ...collectMapStructFieldEdges(method, fieldMap, queries, ctx),
    ];

    for (const access of accesses) {
      const edge: Edge = {
        source: access.sourceMethodId,
        target: access.targetFieldId,
        kind: 'references',
        line: access.line,
        provenance: 'heuristic',
        metadata: {
          synthesizedBy: 'java-field-impact',
          fieldRef: true,
          via: access.via,
        },
      };
      const key = `${edge.source}>${edge.target}:${edge.kind}:${access.via}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queries.insertEdge(edge);
      inserted++;
    }
  }

  return inserted;
}
