import { Node } from '../../types';
import { ArchitectureContext, ArchitectureLayer, NodeArchitectureFacet } from '../types';
import { AnnotationAdapter, AnnotationFact } from './types';

const STEREOTYPE_ANNOTATIONS = [
  'Component',
  'Service',
  'Repository',
  'Controller',
  'RestController',
  'Configuration',
];

const SUPPORTED_ANNOTATIONS = [
  ...STEREOTYPE_ANNOTATIONS,
  'Bean',
  'Autowired',
  'Qualifier',
  'Resource',
  'Value',
  'ConfigurationProperties',
];

const STEREOTYPE_ROLE_MAP: Record<string, string> = {
  Component: 'Component',
  Service: 'Service',
  Repository: 'Repository',
  Controller: 'Controller',
  RestController: 'RestController',
  Configuration: 'Configuration',
};

const JAVA_MODIFIERS = new Set([
  'public',
  'private',
  'protected',
  'static',
  'final',
  'abstract',
  'transient',
  'volatile',
  'synchronized',
  'native',
  'strictfp',
]);

interface ParsedAnnotation {
  name: string;
  args: string | null;
}

function parseAnnotation(decorator: string): ParsedAnnotation {
  let raw = decorator.trim();
  if (raw.startsWith('@')) {
    raw = raw.slice(1);
  }

  const openParen = raw.indexOf('(');
  const hasArgs = openParen !== -1 && raw.endsWith(')');
  const fullName = hasArgs ? raw.slice(0, openParen) : raw;
  const name = fullName.split('.').pop() || fullName;
  const args = hasArgs ? raw.slice(openParen + 1, -1) : null;

  return { name, args };
}

function extractStringLiteral(input: string | null, key?: string): string | undefined {
  if (!input) {
    return undefined;
  }

  if (key) {
    const keyPattern = new RegExp(`${key}\\s*=\\s*["']([^"']+)["']`);
    const match = input.match(keyPattern);
    if (match) {
      return match[1];
    }
  }

  const firstMatch = input.match(/["']([^"']+)["']/);
  return firstMatch ? firstMatch[1] : undefined;
}

function extractFieldBeanType(node: Node): string | undefined {
  if (!node.signature) {
    return undefined;
  }

  const tokens = node.signature.split(/\s+/);
  const nameToken = tokens.find(token => token.replace(/[;:,=].*$/, '') === node.name);
  if (!nameToken) {
    return undefined;
  }

  const nameIndex = tokens.indexOf(nameToken);
  for (let i = nameIndex - 1; i >= 0; i--) {
    const token = tokens[i];
    if (!token) {
      continue;
    }
    const clean = token.replace(/[;:,=<>\[\](){}.]+/g, '');
    if (clean && !JAVA_MODIFIERS.has(clean) && !clean.startsWith('@')) {
      return clean;
    }
  }

  return undefined;
}

function getLayerForRole(role: string): ArchitectureLayer {
  switch (role) {
    case 'Controller':
    case 'RestController':
      return 'entry';
    case 'Service':
      return 'business';
    case 'Repository':
      return 'data';
    case 'Configuration':
    case 'Component':
    case 'FactoryBean':
    case 'InjectionPoint':
    case 'ConfigBinding':
    case 'ConfigProperties':
      return 'infra';
    default:
      return 'unknown';
  }
}

function buildEvidenceSignal(
  node: Node,
  annotationName: string,
  confidence: number,
  metadata: Record<string, unknown> = {}
): AnnotationFact['evidence'][number] {
  return {
    nodeId: node.id,
    facetName: 'spring-annotations',
    profileName: 'spring-cloud',
    confidence,
    evidence: [`Detected @${annotationName} on ${node.kind} ${node.qualifiedName}`],
    scope: 'node',
    filePath: node.filePath,
    metadata,
  };
}

class SpringAnnotationsAdapter implements AnnotationAdapter {
  id = 'spring-annotations';
  framework = 'spring';

  supports(node: Node, _context: ArchitectureContext): boolean {
    if (!node.decorators || node.decorators.length === 0) {
      return false;
    }

    return node.decorators.some(decorator => {
      const { name } = parseAnnotation(decorator);
      return SUPPORTED_ANNOTATIONS.includes(name);
    });
  }

  collectFacts(node: Node, _context: ArchitectureContext): AnnotationFact[] {
    const facts: AnnotationFact[] = [];

    if (!node.decorators) {
      return facts;
    }

    for (const decorator of node.decorators) {
      const parsed = parseAnnotation(decorator);
      const { name } = parsed;

      if (STEREOTYPE_ANNOTATIONS.includes(name)) {
        const role = STEREOTYPE_ROLE_MAP[name];
        facts.push({
          adapterId: this.id,
          nodeId: node.id,
          kind: 'bean',
          name: node.name,
          metadata: { annotation: name, role },
          confidence: 0.9,
          evidence: [buildEvidenceSignal(node, name, 0.9, { annotation: name, role })],
        });
      }

      if (name === 'Bean' && node.kind === 'method') {
        const explicitName = extractStringLiteral(parsed.args, 'name') ?? extractStringLiteral(parsed.args);
        const beanName = explicitName || node.name;
        facts.push({
          adapterId: this.id,
          nodeId: node.id,
          kind: 'bean',
          name: beanName,
          metadata: { annotation: name, role: 'FactoryBean', methodName: node.name },
          confidence: 0.9,
          evidence: [
            buildEvidenceSignal(node, name, 0.9, {
              annotation: name,
              role: 'FactoryBean',
              methodName: node.name,
            }),
          ],
        });
      }

      if ((name === 'Autowired' || name === 'Resource') && (node.kind === 'field' || node.kind === 'property')) {
        const beanType = extractFieldBeanType(node);
        facts.push({
          adapterId: this.id,
          nodeId: node.id,
          kind: 'injection',
          name: node.name,
          metadata: { annotation: name, beanType, fieldName: node.name },
          confidence: 0.7,
          evidence: [
            buildEvidenceSignal(node, name, 0.7, {
              annotation: name,
              beanType,
              fieldName: node.name,
            }),
          ],
        });
      }

      if (name === 'Qualifier') {
        const qualifier = extractStringLiteral(parsed.args);
        facts.push({
          adapterId: this.id,
          nodeId: node.id,
          kind: 'injection',
          name: node.name,
          metadata: { annotation: name, qualifier },
          confidence: 0.7,
          evidence: [
            buildEvidenceSignal(node, name, 0.7, {
              annotation: name,
              qualifier,
            }),
          ],
        });
      }

      if (name === 'Value') {
        const propertyKey = extractStringLiteral(parsed.args);
        facts.push({
          adapterId: this.id,
          nodeId: node.id,
          kind: 'config-binding',
          name: node.name,
          metadata: { annotation: name, propertyKey },
          confidence: 0.8,
          evidence: [
            buildEvidenceSignal(node, name, 0.8, {
              annotation: name,
              propertyKey,
            }),
          ],
        });
      }

      if (name === 'ConfigurationProperties') {
        const prefix = extractStringLiteral(parsed.args, 'prefix') ?? extractStringLiteral(parsed.args);
        facts.push({
          adapterId: this.id,
          nodeId: node.id,
          kind: 'config-binding',
          name: node.name,
          metadata: { annotation: name, prefix },
          confidence: 0.8,
          evidence: [
            buildEvidenceSignal(node, name, 0.8, {
              annotation: name,
              prefix,
            }),
          ],
        });
      }
    }

    return facts;
  }

  assignFacet(fact: AnnotationFact, _context: ArchitectureContext): Partial<NodeArchitectureFacet>[] {
    let role: string;
    if (fact.kind === 'bean') {
      role = (fact.metadata?.role as string) || fact.name;
    } else if (fact.kind === 'injection') {
      role = 'InjectionPoint';
    } else if (fact.kind === 'config-binding') {
      role =
        (fact.metadata?.annotation as string) === 'ConfigurationProperties'
          ? 'ConfigProperties'
          : 'ConfigBinding';
    } else {
      role = fact.name;
    }

    const layer = getLayerForRole(role);
    const confidence = fact.kind === 'bean' ? 0.9 : fact.kind === 'injection' ? 0.7 : 0.8;

    const evidenceMessages = fact.evidence.flatMap(signal => signal.evidence);

    return [
      {
        nodeId: fact.nodeId,
        facetName: this.id,
        role,
        layer,
        confidence,
        evidence: evidenceMessages,
        profileId: 'spring-cloud',
      },
    ];
  }
}

export const springAnnotationsAdapter: AnnotationAdapter = new SpringAnnotationsAdapter();
