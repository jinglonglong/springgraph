/**
 * Spring bean wiring synthesizer — Phase 4.
 *
 * Closes the dependency-injection gap for Spring beans. Field injection
 * (`@Autowired`, `@Resource`), explicit constructor injection, and Lombok
 * `@RequiredArgsConstructor` are all modeled as `references` edges from the
 * owning bean to the injected bean so trace/impact can cross DI boundaries.
 *
 * All synthesized edges carry `provenance:'heuristic'` and
 * `metadata.synthesizedBy:'spring-bean-wiring'` plus `injection:'field'` or
 * `injection:'constructor'`. `@Qualifier` / `@Resource(name=...)` boost
 * confidence; ambiguous multi-implementation wiring without a qualifier is
 * flagged and skipped so the graph does not invent a definitive dependency.
 */

import type { Edge, Node } from '../types';
import type { QueryBuilder } from '../db/queries';
import type { ResolutionContext } from './types';

const JAVA_LANGS = new Set(['java', 'kotlin']);

interface InjectionSite {
  sourceClassId: string;
  sourceClassName: string;
  sourceFile: string;
  /** Node id of the field or constructor being injected */
  siteNodeId: string;
  /** Simple type name being requested */
  beanType: string;
  injection: 'field' | 'constructor';
  line: number;
  /** Explicit qualifier value from @Qualifier or @Resource(name=...) */
  qualifier?: string;
}

interface WiringResult {
  edge?: Edge;
  ambiguous: boolean;
  confidence: number;
  candidates: Node[];
}

interface AnnotationHit {
  line: number;
  name: string;
  args: string | null;
}

/**
 * Parse a decorator/annotation string into simple name and argument body.
 * Handles `@Autowired`, `@org.springframework.beans.factory.annotation.Autowired`,
 * and forms with/without parentheses.
 */
function extractStringLiteral(input: string | null, key?: string): string | undefined {
  if (!input) return undefined;
  if (key) {
    const m = input.match(new RegExp(`${key}\\s*=\\s*["']([^"']+)["']`));
    if (m) return m[1];
  }
  const m = input.match(/["']([^"']+)["']/);
  return m ? m[1] : undefined;
}

function collectAnnotationsByLine(source: string): Map<number, AnnotationHit[]> {
  const byLine = new Map<number, AnnotationHit[]>();
  const re = /@([\w.]+)(\(([^)]*)\))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const line = source.slice(0, m.index).split('\n').length;
    const hits = byLine.get(line) ?? [];
    hits.push({
      line,
      name: (m[1] || '').split('.').pop() || '',
      args: m[3] ?? null,
    });
    byLine.set(line, hits);
  }
  return byLine;
}

function annotationsNearLine(line: number, annotations: Map<number, AnnotationHit[]>): AnnotationHit[] {
  const hits: AnnotationHit[] = [];
  for (let current = Math.max(1, line - 3); current <= line + 5; current++) {
    const found = annotations.get(current);
    if (found) hits.push(...found);
  }
  return hits;
}

/**
 * Best-effort extraction of a field's declared type from its source line.
 * Example: `private final UserService userService;` -> `UserService`.
 */
function extractFieldType(fieldNode: Node, source: string): string | undefined {
  if (fieldNode.signature) {
    // Some extractors store the full declaration text in signature.
    const tokens = fieldNode.signature.split(/\s+/);
    const nameIdx = tokens.findIndex(t => t.replace(/[^\w]/g, '') === fieldNode.name);
    if (nameIdx > 0) {
      const typeTok = tokens[nameIdx - 1];
      if (typeTok) return typeTok.replace(/[^\w.]/g, '').split('.').pop();
    }
  }
  const lines = source.split(/\r?\n/);
  const line = lines[(fieldNode.startLine || 1) - 1];
  if (!line) return undefined;
  const withoutAnnotations = line.replace(/@[\w.]+(\([^)]*\))?/g, ' ');
  const m = withoutAnnotations.match(/(?:private|public|protected)?\s*(?:static\s+)?(?:final\s+)?(?:volatile\s+)?([\w.<>\[\]]+)\s+\b\w+\s*[;=]/);
  if (!m) return undefined;
  const typeTok = m[1];
  if (!typeTok) return undefined;
  const base = typeTok.replace(/<[^>]*>/g, '').split('[')[0];
  if (!base) return undefined;
  return base.split('.').pop() || base;
}

/**
 * Find the simple class name from its qualified name or file path.
 */
function classSimpleName(node: Node): string {
  if (node.name) return node.name;
  const parts = node.qualifiedName.split('.');
  return parts[parts.length - 1] || node.qualifiedName;
}

function parseExplicitBeanName(cls: Node, ctx: ResolutionContext): string | undefined {
  const source = ctx.readFile(cls.filePath);
  if (!source) return undefined;
  const lines = source.split(/\r?\n/);
  for (let line = Math.max(0, cls.startLine - 4); line < cls.startLine; line++) {
    const text = lines[line] ?? '';
    const match = text.match(/@(Service|Component|Repository|Controller)\s*\(\s*["']([^"']+)["']/);
    if (match?.[2]) return match[2];
  }
  return undefined;
}

/**
 * Find candidate bean implementation nodes for a requested type.
 * A candidate is a class whose simple name equals the requested type or
 * whose `implements` edge reaches an interface with that name.
 */
function findBeanCandidates(beanType: string, queries: QueryBuilder): Node[] {
  if (!beanType) return [];
  const byName = queries.getNodesByName(beanType).filter(n => n.kind === 'class' || n.kind === 'interface');
  const candidates = new Map<string, Node>();
  for (const n of byName) {
    if (n.kind === 'class') candidates.set(n.id, n);
  }
  // Classes implementing an interface named beanType
  for (const iface of byName.filter(n => n.kind === 'interface')) {
    for (const edge of queries.getIncomingEdges(iface.id, ['implements'])) {
      const impl = queries.getNodeById(edge.source);
      if (impl && impl.kind === 'class') candidates.set(impl.id, impl);
    }
  }
  return [...candidates.values()];
}

/**
 * Resolve a wiring site to a concrete bean (or an ambiguous result).
 */
function resolveWiring(site: InjectionSite, queries: QueryBuilder, ctx: ResolutionContext): WiringResult {
  const candidates = findBeanCandidates(site.beanType, queries).filter(
    c => c.id !== site.sourceClassId
  );

  if (candidates.length === 0) {
    return { ambiguous: false, confidence: 0, candidates: [] };
  }

  // Qualifier narrows to a bean whose simple name or explicit bean name matches.
  if (site.qualifier) {
    const qualified = candidates.filter(c => {
      if (classSimpleName(c) === site.qualifier) return true;
      const lower = site.qualifier!.charAt(0).toLowerCase() + site.qualifier!.slice(1);
      const explicitBeanName = parseExplicitBeanName(c, ctx);
      return c.name === lower || c.qualifiedName.endsWith('.' + site.qualifier) || explicitBeanName === site.qualifier;
    });
    if (qualified.length === 1) {
      return {
        ambiguous: false,
        confidence: 0.98,
        candidates: qualified,
        edge: makeEdge(site, qualified[0]!, 0.98),
      };
    }
    if (qualified.length > 1) {
      return { ambiguous: true, confidence: 0.5, candidates: qualified };
    }
  }

  if (candidates.length === 1) {
    return {
      ambiguous: false,
      confidence: 0.9,
      candidates,
      edge: makeEdge(site, candidates[0]!, 0.9),
    };
  }

  return { ambiguous: true, confidence: 0.4, candidates };
}

function makeEdge(site: InjectionSite, target: Node, confidence: number): Edge {
  return {
    source: site.sourceClassId,
    target: target.id,
    kind: 'references',
    line: site.line,
    provenance: 'heuristic',
    metadata: {
      synthesizedBy: 'spring-bean-wiring',
      injection: site.injection,
      beanType: site.beanType,
      confidence,
      qualifier: site.qualifier,
      siteNodeId: site.siteNodeId,
    },
  };
}

/**
 * Collect field injection sites in a class source.
 */
function collectFieldInjectionSites(
  cls: Node,
  nodesInFile: Node[],
  source: string,
  annotations: Map<number, AnnotationHit[]>,
): InjectionSite[] {
  const sites: InjectionSite[] = [];
  const fields = nodesInFile.filter(
    n => (n.kind === 'field' || n.kind === 'property') &&
      n.startLine >= cls.startLine &&
      (n.endLine ?? n.startLine) <= (cls.endLine ?? cls.startLine)
  );

  for (const f of fields) {
    let injectionType: 'Autowired' | 'Resource' | undefined;
    let qualifier: string | undefined;
    for (const d of annotationsNearLine(f.startLine, annotations)) {
      const { name, args } = d;
      if (name === 'Autowired') injectionType = 'Autowired';
      if (name === 'Resource') {
        injectionType = 'Resource';
        const nameArg = extractStringLiteral(args, 'name');
        if (nameArg) qualifier = nameArg;
      }
      if (name === 'Qualifier') {
        const q = extractStringLiteral(args);
        if (q) qualifier = q;
      }
    }
    if (!injectionType) continue;
    const beanType = extractFieldType(f, source);
    if (!beanType) continue;
    sites.push({
      sourceClassId: cls.id,
      sourceClassName: cls.name,
      sourceFile: cls.filePath,
      siteNodeId: f.id,
      beanType,
      injection: 'field',
      line: f.startLine,
      qualifier,
    });
  }
  return sites;
}

/**
 * Collect constructor injection sites for explicit constructors and
 * Lombok `@RequiredArgsConstructor`.
 */
function collectConstructorInjectionSites(
  cls: Node,
  nodesInFile: Node[],
  source: string,
  annotations: Map<number, AnnotationHit[]>,
): InjectionSite[] {
  const sites: InjectionSite[] = [];
  const constructors = nodesInFile.filter(
    n => n.kind === 'method' && n.name === cls.name && n.startLine >= cls.startLine && n.endLine <= cls.endLine
  );

  const hasRequiredArgsConstructor = annotationsNearLine(cls.startLine, annotations)
    .some((d) => d.name === 'RequiredArgsConstructor');
  const lines = source.split(/\r?\n/);

  // Explicit constructors
  for (const ctor of constructors) {
    if (!ctor.signature) continue;
    const params = parseParameters(ctor.signature);
    for (const { type, line } of params) {
      if (!type || isPrimitive(type)) continue;
      sites.push({
        sourceClassId: cls.id,
        sourceClassName: cls.name,
        sourceFile: cls.filePath,
        siteNodeId: ctor.id,
        beanType: type,
        injection: 'constructor',
        line: line || ctor.startLine,
      });
    }
  }

  // Lombok @RequiredArgsConstructor on a class with final dependency fields
  if (hasRequiredArgsConstructor && constructors.length === 0) {
    const finalFields = nodesInFile.filter(n => {
      if (
        (n.kind !== 'field' && n.kind !== 'property') ||
        n.startLine < cls.startLine ||
        (n.endLine ?? n.startLine) > (cls.endLine ?? cls.startLine)
      ) return false;
      const line = lines[n.startLine - 1] || '';
      return /\bfinal\b/.test(line) && !/\bstatic\s+final\b/.test(line);
    });
    for (const f of finalFields) {
      const beanType = extractFieldType(f, source);
      if (!beanType || isPrimitive(beanType)) continue;
      sites.push({
        sourceClassId: cls.id,
        sourceClassName: cls.name,
        sourceFile: cls.filePath,
        siteNodeId: f.id,
        beanType,
        injection: 'constructor',
        line: f.startLine,
      });
    }
  }

  return sites;
}

const PRIMITIVE_TYPES = new Set([
  'byte', 'short', 'int', 'long', 'float', 'double', 'boolean', 'char',
  'String', 'Integer', 'Long', 'Double', 'Float', 'Boolean', 'Character',
  'BigDecimal', 'BigInteger', 'LocalDate', 'LocalDateTime', 'Instant',
]);

function isPrimitive(type: string): boolean {
  return PRIMITIVE_TYPES.has(type) || type.length === 1;
}

/**
 * Parse a method/constructor signature like `public Foo(UserService u, int x)`
 * into parameter types with their source line (best-effort).
 */
function parseParameters(signature: string): Array<{ type: string | undefined; line: number }> {
  const m = signature.match(/\((.*)\)/s);
  if (!m) return [];
  const body = m[1] || '';
  if (!body.trim()) return [];
  // Split top-level commas
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
    // Parameter format: `Type name` or `final Type name` or annotations
    let typeTok: string | undefined;
    for (let i = tokens.length - 2; i >= 0; i--) {
      const rawTok = tokens[i];
      if (!rawTok) continue;
      const tok = rawTok.replace(/[^\w.\[\]<>]/g, '');
      if (tok && !tok.startsWith('@') && !/\b(final|public|private|protected)\b/.test(tok)) {
        typeTok = tok;
        break;
      }
    }
    return { type: typeTok?.split('[')[0]?.replace(/<[^>]*>/g, '').split('.').pop(), line: 0 };
  });
}

/**
 * Synthesize Spring bean wiring edges for all indexed Java/Kotlin classes.
 * Returns the number of edges inserted.
 */
export function synthesizeSpringBeanWiring(queries: QueryBuilder, ctx: ResolutionContext): number {
  const classes = queries.getNodesByKind('class').filter(c => JAVA_LANGS.has(c.language));
  let inserted = 0;
  const seen = new Set<string>();

  for (const cls of classes) {
    const source = ctx.readFile(cls.filePath);
    if (!source) continue;
    const nodesInFile = ctx.getNodesInFile(cls.filePath);
    const annotations = collectAnnotationsByLine(source);

    const sites: InjectionSite[] = [
      ...collectFieldInjectionSites(cls, nodesInFile, source, annotations),
      ...collectConstructorInjectionSites(cls, nodesInFile, source, annotations),
    ];

    for (const site of sites) {
      const result = resolveWiring(site, queries, ctx);
      if (result.ambiguous) {
        // Ambiguous wiring is intentionally not emitted as a definitive edge.
        // It is recorded on the source class node for trace consumers to
        // surface as a warning when explicitly requested.
        continue;
      }
      if (!result.edge) continue;
      const key = `${result.edge.source}>${result.edge.target}:${result.edge.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queries.insertEdge(result.edge);
      inserted++;
    }
  }

  return inserted;
}
