import { Node } from '../../types';
import { ArchitectureContext, ArchitectureSignal, NodeArchitectureFacet } from '../types';
import { AnnotationAdapter, AnnotationFact } from './types';

/**
 * MyBatis SQL statement annotations.
 */
const SQL_ANNOTATIONS = ['Select', 'Insert', 'Update', 'Delete'] as const;

/**
 * MyBatis result-mapping annotations.
 */
const RESULT_ANNOTATIONS = ['Results', 'Result'] as const;

/**
 * MyBatis parameter-name annotation.
 */
const PARAM_ANNOTATION = 'Param';

/**
 * All MyBatis annotations recognized by this adapter.
 */
const MYBATIS_ANNOTATION_NAMES = new Set<string>([
  ...SQL_ANNOTATIONS,
  ...RESULT_ANNOTATIONS,
  PARAM_ANNOTATION,
]);

type SqlAnnotation = (typeof SQL_ANNOTATIONS)[number];

/**
 * Parsed column -> field mapping for @Result / @Results.
 */
interface ResultMapping {
  property?: string;
  column?: string;
  javaType?: string;
  jdbcType?: string;
  id?: boolean;
}

interface AnnotationParseResult {
  name: string;
  rawValue?: string;
}

/**
 * Parse a decorator/annotation string such as `@Select("SELECT * FROM users")`
 * or `@org.apache.ibatis.annotations.Select(...)` into its simple name and raw
 * argument body.
 */
function parseAnnotationDecorator(decorator: string): AnnotationParseResult {
  let raw = decorator.trim();
  if (raw.startsWith('@')) {
    raw = raw.slice(1);
  }

  const openParen = raw.indexOf('(');
  const hasArgs = openParen !== -1 && raw.endsWith(')');
  const fullName = hasArgs ? raw.slice(0, openParen) : raw;
  const name = fullName.split('.').pop() || fullName;
  const rawValue = hasArgs ? raw.slice(openParen + 1, -1).trim() : undefined;

  return { name, rawValue };
}

/**
 * Extract the contents of a single- or double-quoted string literal.
 */
function extractStringLiteral(value: string): string | undefined {
  const m = value.match(/^(["'])([\s\S]*?)\1$/);
  return m ? m[2] : undefined;
}

/**
 * Extract `key = "value"` property assignments from an annotation body.
 * Handles string literals; nested braces are skipped by the non-greedy match.
 */
function parsePropertyAssignments(body: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of body.matchAll(/(\w+)\s*=\s*(["'])([\s\S]*?)\2/g)) {
    const key = match[1];
    const value = match[3];
    if (key !== undefined && value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Parse a single `@Result(property = "x", column = "y")` body.
 */
function parseResultMapping(rawValue: string): ResultMapping {
  const props = parsePropertyAssignments(rawValue);
  return {
    property: props.property,
    column: props.column,
    javaType: props.javaType,
    jdbcType: props.jdbcType,
    id: props.id ? props.id.toLowerCase() === 'true' : undefined,
  };
}

/**
 * Parse a `@Results({ @Result(...), @Result(...) })` body into individual mappings.
 */
function parseResultsMapping(rawValue: string): ResultMapping[] {
  const mappings: ResultMapping[] = [];
  for (const match of rawValue.matchAll(/@Result\s*\(([\s\S]*?)\)/g)) {
    const body = match[1];
    if (body !== undefined) {
      mappings.push(parseResultMapping(body));
    }
  }
  return mappings;
}

function createSignal(
  node: Node,
  adapterId: string,
  message: string,
  metadata?: Record<string, unknown>
): ArchitectureSignal {
  return {
    nodeId: node.id,
    facetName: adapterId,
    profileName: 'mybatis',
    confidence: 0.85,
    evidence: [message],
    scope: 'node',
    filePath: node.filePath,
    metadata,
  };
}

/**
 * Adapter that detects MyBatis annotations on Java/Kotlin mapper interfaces/methods
 * and produces architecture facts for SQL statements, result mappings, and parameter names.
 */
export class MyBatisAnnotationsAdapter implements AnnotationAdapter {
  readonly id = 'mybatis-annotations';
  readonly framework = 'mybatis';

  supports(node: Node, _context: ArchitectureContext): boolean {
    if (!node.decorators || node.decorators.length === 0) {
      return false;
    }
    return node.decorators.some((d) => {
      const { name } = parseAnnotationDecorator(d);
      return MYBATIS_ANNOTATION_NAMES.has(name);
    });
  }

  collectFacts(node: Node, _context: ArchitectureContext): AnnotationFact[] {
    const facts: AnnotationFact[] = [];
    if (!node.decorators) return facts;

    for (const decorator of node.decorators) {
      const { name, rawValue } = parseAnnotationDecorator(decorator);

      if ((SQL_ANNOTATIONS as readonly string[]).includes(name)) {
        const sql = rawValue ? extractStringLiteral(rawValue) || rawValue : '';
        facts.push({
          adapterId: this.id,
          nodeId: node.id,
          kind: 'sql-statement',
          name: node.name,
          metadata: {
            statementType: name as SqlAnnotation,
            sql,
            role: 'Mapper',
          },
          confidence: 0.85,
          evidence: [
            createSignal(node, this.id, `Detected MyBatis @${name} SQL statement annotation`, {
              statementType: name,
              sql,
            }),
          ],
        });
      } else if (name === 'Results') {
        const mappings = rawValue ? parseResultsMapping(rawValue) : [];
        facts.push({
          adapterId: this.id,
          nodeId: node.id,
          kind: 'mapping',
          name: node.name,
          metadata: {
            resultMappings: mappings,
            mappingType: 'Results',
          },
          confidence: 0.85,
          evidence: [
            createSignal(node, this.id, `Detected MyBatis @Results mapping annotation`, {
              resultMappings: mappings,
            }),
          ],
        });
      } else if (name === 'Result') {
        const mapping = rawValue ? parseResultMapping(rawValue) : {};
        facts.push({
          adapterId: this.id,
          nodeId: node.id,
          kind: 'mapping',
          name: node.name,
          metadata: {
            resultMapping: mapping,
            mappingType: 'Result',
          },
          confidence: 0.85,
          evidence: [
            createSignal(node, this.id, `Detected MyBatis @Result mapping annotation`, {
              resultMapping: mapping,
            }),
          ],
        });
      } else if (name === 'Param') {
        const paramName = rawValue ? extractStringLiteral(rawValue) || rawValue : node.name;
        facts.push({
          adapterId: this.id,
          nodeId: node.id,
          kind: 'mapping',
          name: node.name,
          metadata: {
            paramName,
            mappingType: 'Param',
          },
          confidence: 0.85,
          evidence: [
            createSignal(node, this.id, `Detected MyBatis @Param annotation`, {
              paramName,
            }),
          ],
        });
      }
    }

    return facts;
  }

  assignFacet(_fact: AnnotationFact, _context: ArchitectureContext): Partial<NodeArchitectureFacet>[] {
    return [
      {
        role: 'Mapper',
        layer: 'data',
        confidence: 0.85,
      },
    ];
  }
}

export const mybatisAnnotationsAdapter: AnnotationAdapter = new MyBatisAnnotationsAdapter();
