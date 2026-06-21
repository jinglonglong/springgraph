/**
 * Java interface-to-implementation dispatch synthesizer — Phase 4.
 *
 * Static parsing misses interface dispatch: a call to `FooService.save()` only
 * resolves to the interface method, so impact/trace stop there. This pass links
 * each interface method to every matching implementation method with an
 * `overrides` edge so the graph can follow dispatch statically.
 *
 * Matching is by method name + parameter arity (not just simple name), which
 * handles overloaded and generic interface methods after type erasure. All
 * synthesized edges carry `provenance:'heuristic'` and
 * `metadata.synthesizedBy:'java-interface-impl-dispatch'`. Multi-implementation
 * matches are flagged `ambiguous` and given low confidence so default trace can
 * skip them.
 */

import type { Edge, Node } from '../types';
import type { QueryBuilder } from '../db/queries';

const JAVA_LANGS = new Set(['java', 'kotlin']);

interface DispatchMatch {
  interfaceMethodId: string;
  implementationMethodId: string;
  confidence: number;
  ambiguous: boolean;
}

/**
 * Parse parameter arity from a method signature string.
 * Accepts signatures like `int foo(String a, int b)` or `(String, int)`.
 * Returns 0 for no-argument methods, null if arity cannot be determined.
 */
function parseArity(signature: string | undefined): number | null {
  if (!signature) return null;
  const m = signature.match(/\(([^)]*)\)/);
  if (!m) return null;
  const body = m[1]!.trim();
  if (!body) return 0;
  // Split top-level commas, ignoring nested generics/arrays
  let count = 1;
  let depth = 0;
  for (const ch of body) {
    if (ch === '<' || ch === '(') depth++;
    else if (ch === '>' || ch === ')') depth--;
    else if (ch === ',' && depth === 0) count++;
  }
  return count;
}

/**
 * Find the immediate implementing classes of an interface by walking incoming
 * `implements` edges.
 */
function findImplementations(iface: Node, queries: QueryBuilder): Node[] {
  const impls: Node[] = [];
  for (const edge of queries.getIncomingEdges(iface.id, ['implements'])) {
    const node = queries.getNodeById(edge.source);
    if (node && node.kind === 'class') impls.push(node);
  }
  return impls;
}

/**
 * Find all methods declared inside a class by inspecting outgoing `contains`
 * edges whose targets fall within the class line range.
 */
function findClassMethods(cls: Node, queries: QueryBuilder): Node[] {
  return queries
    .getOutgoingEdges(cls.id, ['contains'])
    .map(e => queries.getNodeById(e.target))
    .filter((n): n is Node => !!n && n.kind === 'method' && n.name !== cls.name);
}

/**
 * Score how well an implementation method matches an interface method.
 * Name + arity match is the primary signal. Return-type equality adds a small
 * bonus. Confidence is scaled by implementation count elsewhere.
 */
function matchMethod(interfaceMethod: Node, implMethod: Node): number {
  if (interfaceMethod.name !== implMethod.name) return 0;
  const ifaceArity = parseArity(interfaceMethod.signature);
  const implArity = parseArity(implMethod.signature);
  if (ifaceArity === null || implArity === null) {
    // Arity unknown: fall back to name-only with lower confidence
    return 0.5;
  }
  if (ifaceArity !== implArity) return 0;
  let score = 0.9;
  if (interfaceMethod.returnType && implMethod.returnType && interfaceMethod.returnType === implMethod.returnType) {
    score += 0.05;
  }
  return score;
}

/**
 * Find the immediate subclasses of a class by walking incoming `extends` edges.
 */
function findSubclasses(cls: Node, queries: QueryBuilder): Node[] {
  const subs: Node[] = [];
  for (const edge of queries.getIncomingEdges(cls.id, ['extends'])) {
    const node = queries.getNodeById(edge.source);
    if (node && node.kind === 'class') subs.push(node);
  }
  return subs;
}

/**
 * Synthesize `overrides` edges from base-class methods to subclass methods
 * that override them (via `extends`). Symmetric to the interface-impl pass
 * but walks the class-inheritance hierarchy instead.
 *
 * Returns the number of edges inserted.
 */
export function synthesizeClassExtendsDispatch(queries: QueryBuilder): number {
  const classes = queries.getNodesByKind('class').filter(c => JAVA_LANGS.has(c.language));
  let inserted = 0;
  const seen = new Set<string>();

  for (const cls of classes) {
    const subClasses = findSubclasses(cls, queries);
    if (subClasses.length === 0) continue;

    const baseMethods = findClassMethods(cls, queries).filter(m => m.kind === 'method');
    if (baseMethods.length === 0) continue;

    for (const baseMethod of baseMethods) {
      const matches: DispatchMatch[] = [];
      for (const sub of subClasses) {
        for (const subMethod of findClassMethods(sub, queries)) {
          const score = matchMethod(baseMethod, subMethod);
          if (score <= 0) continue;
          matches.push({
            interfaceMethodId: baseMethod.id,
            implementationMethodId: subMethod.id,
            confidence: score,
            ambiguous: false,
          });
        }
      }

      const ambiguous = matches.length > 1;
      for (const match of matches) {
        let confidence = match.confidence;
        if (ambiguous) {
          confidence = Math.min(confidence, 0.5);
        } else {
          confidence = Math.max(confidence, 0.9);
        }

        const edge: Edge = {
          source: match.interfaceMethodId,
          target: match.implementationMethodId,
          kind: 'overrides',
          line: baseMethod.startLine,
          provenance: 'heuristic',
          metadata: {
            synthesizedBy: 'java-class-extends-dispatch',
            confidence,
            ambiguous,
            baseClassName: cls.name,
          },
        };

        const key = `${edge.source}>${edge.target}:${edge.kind}`;
        if (seen.has(key)) continue;
        seen.add(key);
        queries.insertEdge(edge);
        inserted++;
      }
    }
  }

  return inserted;
}

/**
 * Synthesize `overrides` edges from interface methods to their implementation
 * methods. Returns the number of edges inserted.
 */
export function synthesizeInterfaceImplDispatch(queries: QueryBuilder): number {
  const interfaces = queries.getNodesByKind('interface').filter(i => JAVA_LANGS.has(i.language));
  let inserted = 0;
  const seen = new Set<string>();

  for (const iface of interfaces) {
    const implClasses = findImplementations(iface, queries);
    if (implClasses.length === 0) continue;

    const ifaceMethods = findClassMethods(iface, queries).filter(m => m.kind === 'method');
    if (ifaceMethods.length === 0) continue;

    for (const ifaceMethod of ifaceMethods) {
      const matches: DispatchMatch[] = [];
      for (const impl of implClasses) {
        for (const implMethod of findClassMethods(impl, queries)) {
          const score = matchMethod(ifaceMethod, implMethod);
          if (score <= 0) continue;
          matches.push({
            interfaceMethodId: ifaceMethod.id,
            implementationMethodId: implMethod.id,
            confidence: score,
            ambiguous: false,
          });
        }
      }

      const ambiguous = matches.length > 1;
      for (const match of matches) {
        let confidence = match.confidence;
        if (ambiguous) {
          confidence = Math.min(confidence, 0.5);
        } else {
          confidence = Math.max(confidence, 0.9);
        }

        const edge: Edge = {
          source: match.interfaceMethodId,
          target: match.implementationMethodId,
          kind: 'overrides',
          line: ifaceMethod.startLine,
          provenance: 'heuristic',
          metadata: {
            synthesizedBy: 'java-interface-impl-dispatch',
            confidence,
            ambiguous,
            interfaceName: iface.name,
          },
        };

        const key = `${edge.source}>${edge.target}:${edge.kind}`;
        if (seen.has(key)) continue;
        seen.add(key);
        queries.insertEdge(edge);
        inserted++;
      }
    }
  }

  return inserted;
}
