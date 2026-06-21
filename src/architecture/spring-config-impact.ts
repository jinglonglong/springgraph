import type { Edge, Node } from '../types';
import type { QueryBuilder } from '../db/queries';
import type { ResolutionContext } from '../resolution/types';

const JAVA_LANGS = new Set(['java', 'kotlin']);

export interface SpringConfigImpactResult {
  edgesInserted: number;
  warnings: string[];
}

function canonicalConfigKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '');
}

function findConfigKeyNode(queries: QueryBuilder, key: string): Node | null {
  const canon = canonicalConfigKey(key);
  const candidates = queries.getNodesByKind('constant').filter(
    n => (n.language === 'yaml' || n.language === 'properties') &&
      canonicalConfigKey(n.qualifiedName) === canon
  );
  if (candidates.length === 0) return null;
  const score = (n: Node) => {
    const base = n.filePath.split('/').pop() ?? '';
    const isBase = /^(application|bootstrap)\.(yml|yaml|properties)$/i.test(base);
    return (isBase ? 0 : 1) * 1000 + base.length;
  };
  return candidates.reduce((a, b) => (score(a) <= score(b) ? a : b));
}

function extractValueBindings(source: string): Array<{ key: string; line: number }> {
  const bindings: Array<{ key: string; line: number }> = [];
  const re = /@(?:[\w.]*\.)?Value\s*\(\s*["']\$\{([^}:]+)(?::[^}]*)?\}["']\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const key = m[1]?.trim();
    if (!key) continue;
    bindings.push({ key, line: source.slice(0, m.index).split('\n').length });
  }
  return bindings;
}

function extractConfigurationPropertiesPrefixes(source: string): Array<{ prefix: string; line: number }> {
  const bindings: Array<{ prefix: string; line: number }> = [];
  const re = /@(?:[\w.]*\.)?ConfigurationProperties\s*\(\s*(?:prefix\s*=\s*)?["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const prefix = m[1]?.trim();
    if (!prefix) continue;
    bindings.push({ prefix, line: source.slice(0, m.index).split('\n').length });
  }
  return bindings;
}

function nodeAtOrAfterLine<T extends Node>(nodes: T[], line: number): T | null {
  const exact = nodes.find((node) => node.startLine === line);
  if (exact) return exact;
  const later = nodes
    .filter((node) => node.startLine >= line)
    .sort((a, b) => a.startLine - b.startLine)[0];
  return later ?? null;
}

function classContainingLine(classes: Node[], line: number): Node | null {
  return classes.find((cls) => cls.startLine <= line && (cls.endLine ?? cls.startLine) >= line) ?? null;
}

export function synthesizeSpringConfigImpact(
  queries: QueryBuilder,
  ctx?: ResolutionContext,
): SpringConfigImpactResult {
  const result: SpringConfigImpactResult = { edgesInserted: 0, warnings: [] };
  const seen = new Set<string>();
  const javaFiles = queries.getNodesByKind('file').filter((n) => JAVA_LANGS.has(n.language));

  for (const fileNode of javaFiles) {
    const fileNodes = queries.getNodesByFile(fileNode.filePath);
    const source = ctx?.readFile(fileNode.filePath) ?? null;
    if (!source) continue;

    const fields = fileNodes.filter((n) => n.kind === 'field' || n.kind === 'property');
    const classes = fileNodes.filter((n) => n.kind === 'class');

    for (const binding of extractValueBindings(source)) {
      const field = nodeAtOrAfterLine(fields, binding.line);
      if (!field) continue;
      const target = findConfigKeyNode(queries, binding.key);
      if (!target) {
        result.warnings.push(`Unresolved @Value binding: ${binding.key}`);
        continue;
      }
      const edge: Edge = {
        source: field.id,
        target: target.id,
        kind: 'references',
        line: field.startLine,
        provenance: 'heuristic',
        metadata: {
          synthesizedBy: 'spring-config-impact',
          binding: '@Value',
          configKey: binding.key,
        },
      };
      const key = `${edge.source}>${edge.target}:${edge.kind}:${binding.key}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queries.insertEdge(edge);
      result.edgesInserted++;
    }

    for (const binding of extractConfigurationPropertiesPrefixes(source)) {
      const cls = classContainingLine(classes, binding.line);
      if (!cls) continue;
      const clsFields = fileNodes.filter(
        (n) => (n.kind === 'field' || n.kind === 'property') &&
          n.startLine >= cls.startLine && (n.endLine ?? n.startLine) <= (cls.endLine ?? cls.startLine)
      );

      for (const field of clsFields) {
        const configKey = `${binding.prefix}.${field.name}`;
        const target = findConfigKeyNode(queries, configKey);
        if (!target) {
          result.warnings.push(`Unresolved @ConfigurationProperties binding: ${configKey}`);
          continue;
        }
        const edge: Edge = {
          source: field.id,
          target: target.id,
          kind: 'references',
          line: field.startLine,
          provenance: 'heuristic',
          metadata: {
            synthesizedBy: 'spring-config-impact',
            binding: '@ConfigurationProperties',
            configKey,
            prefix: binding.prefix,
          },
        };
        const key = `${edge.source}>${edge.target}:${edge.kind}:${configKey}`;
        if (seen.has(key)) continue;
        seen.add(key);
        queries.insertEdge(edge);
        result.edgesInserted++;
      }
    }
  }

  return result;
}
