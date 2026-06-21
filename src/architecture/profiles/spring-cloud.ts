import * as fs from 'fs';
import * as path from 'path';
import { DatabaseConnection } from '../../db';
import {
  ArchitectureContext,
  ArchitectureFacet,
  ArchitectureLayer,
  ArchitectureProfile,
  ArchitectureProfileMatch,
  ArchitectureSignal,
} from '../types';
import { annotationAdapterRegistry } from '../adapters/registry';
import { AnnotationAdapter, AnnotationFact } from '../adapters/types';
import { facetRegistry } from '../facet-engine';
import { genericProfile, profileRegistry } from '../profile-registry';
import { Language, Node, NodeKind } from '../../types';

/**
 * Spring Cloud architecture profile.
 *
 * Defines six logical layers, fifteen supported architectural roles, and four
 * facets that detect Spring-centric projects:
 *   - spring-naming    (file/class naming suffixes)
 *   - spring-annotation (delegates to Phase 2 Spring annotation adapters)
 *   - maven-module     (pom.xml / Gradle multi-module detection)
 *   - spring-entrypoint (Controller / Scheduler / EventListener / Filter / WebSocket)
 */

export const SPRING_CLOUD_LAYERS: {
  id: ArchitectureLayer;
  label: string;
  tier: number;
}[] = [
  { id: 'entry', label: 'Entry Layer', tier: 1 },
  { id: 'remote', label: 'Remote Layer', tier: 2 },
  { id: 'business', label: 'Business Layer', tier: 3 },
  { id: 'data', label: 'Data Layer', tier: 4 },
  { id: 'model', label: 'Model Layer', tier: 5 },
  { id: 'infra', label: 'Infrastructure Layer', tier: 6 },
];

export const SPRING_CLOUD_ROLES: {
  id: string;
  label: string;
  layerId: ArchitectureLayer;
  entrypoint?: boolean;
}[] = [
  { id: 'controller', label: 'Controller', layerId: 'entry', entrypoint: true },
  { id: 'controller-advice', label: 'Controller Advice', layerId: 'entry' },
  { id: 'scheduler', label: 'Scheduler', layerId: 'entry', entrypoint: true },
  { id: 'event-listener', label: 'Event Listener', layerId: 'entry', entrypoint: true },
  { id: 'filter', label: 'Filter', layerId: 'entry', entrypoint: true },
  { id: 'websocket', label: 'WebSocket Endpoint', layerId: 'entry', entrypoint: true },
  { id: 'feign-client', label: 'Feign Client', layerId: 'remote' },
  { id: 'service', label: 'Service', layerId: 'business' },
  { id: 'service-impl', label: 'Service Implementation', layerId: 'business' },
  { id: 'mapper', label: 'Mapper', layerId: 'data' },
  { id: 'repository', label: 'Repository', layerId: 'data' },
  { id: 'entity', label: 'Entity', layerId: 'model' },
  { id: 'config', label: 'Configuration', layerId: 'infra' },
  { id: 'component', label: 'Component', layerId: 'infra' },
  { id: 'app', label: 'Application', layerId: 'infra', entrypoint: true },
];

const SUPPORTED_ROLE_IDS = new Set(SPRING_CLOUD_ROLES.map(r => r.id));

/**
 * Canonicalize adapter-specific role names into the Spring Cloud profile role set.
 */
const ROLE_CANONICALIZATION: Record<string, string> = {
  Controller: 'controller',
  RestController: 'controller',
  Endpoint: 'controller',
  Service: 'service',
  ServiceImpl: 'service-impl',
  'Service-Impl': 'service-impl',
  Repository: 'repository',
  Mapper: 'mapper',
  Entity: 'entity',
  Configuration: 'config',
  Config: 'config',
  ConfigBinding: 'config',
  ConfigProperties: 'config',
  Component: 'component',
  FactoryBean: 'component',
  InjectionPoint: 'component',
  ScheduledJob: 'scheduler',
  EventListener: 'event-listener',
  Application: 'app',
  App: 'app',
};

function canonicalizeRole(role: string | undefined): string | undefined {
  if (!role) return undefined;
  const mapped = ROLE_CANONICALIZATION[role] || ROLE_CANONICALIZATION[role.replace(/^@/, '')];
  const normalized = mapped || role.toLowerCase();
  if (SUPPORTED_ROLE_IDS.has(normalized)) return normalized;
  return undefined;
}

function getLayerForRole(role: string): ArchitectureLayer {
  const layer = SPRING_CLOUD_ROLES.find(r => r.id === role)?.layerId;
  return layer || 'unknown';
}

// =============================================================================
// Node/file loading helpers (synchronous, works in both FacetEngine modes)
// =============================================================================

function parseJson<T>(raw: string | null): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function rowToNode(row: Record<string, unknown>): Node {
  return {
    id: String(row.id),
    kind: String(row.kind) as NodeKind,
    name: String(row.name),
    qualifiedName: String(row.qualified_name),
    filePath: String(row.file_path),
    language: String(row.language) as Language,
    startLine: Number(row.start_line),
    endLine: Number(row.end_line),
    startColumn: Number(row.start_column),
    endColumn: Number(row.end_column),
    docstring: row.docstring ? String(row.docstring) : undefined,
    signature: row.signature ? String(row.signature) : undefined,
    visibility: row.visibility ? (String(row.visibility) as Node['visibility']) : undefined,
    isExported: row.is_exported === 1,
    isAsync: row.is_async === 1,
    isStatic: row.is_static === 1,
    isAbstract: row.is_abstract === 1,
    decorators: parseJson<string[]>(row.decorators ? String(row.decorators) : null),
    typeParameters: parseJson<string[]>(row.type_parameters ? String(row.type_parameters) : null),
    returnType: row.return_type ? String(row.return_type) : undefined,
    updatedAt: Number(row.updated_at),
  };
}

function getNodesFromDb(db: DatabaseConnection): Node[] {
  try {
    const rows = db
      .getDb()
      .prepare(
        `SELECT id, kind, name, qualified_name, file_path, language, start_line, end_line,
                start_column, end_column, docstring, signature, visibility, is_exported,
                is_async, is_static, is_abstract, decorators, type_parameters, return_type,
                updated_at
         FROM nodes`
      )
      .all() as Record<string, unknown>[];
    return rows.map(rowToNode);
  } catch {
    return [];
  }
}

function getFilePathsFromDb(db: DatabaseConnection): string[] {
  try {
    const rows = db.getDb().prepare('SELECT path FROM files').all() as { path: string }[];
    return rows.map(r => r.path);
  } catch {
    return [];
  }
}

function getNodes(context: ArchitectureContext): Node[] {
  if (context.getNodes) {
    const maybeNodes = context.getNodes() as Node[] | Promise<Node[]>;
    if (Array.isArray(maybeNodes)) {
      return maybeNodes;
    }
  }
  return getNodesFromDb(context.db);
}

function getFilePaths(context: ArchitectureContext): string[] {
  const fromDb = getFilePathsFromDb(context.db);
  if (fromDb.length > 0) return fromDb;

  const fromNodes = getNodes(context)
    .filter(n => n.kind === 'file')
    .map(n => n.filePath);
  return fromNodes;
}

// =============================================================================
// spring-naming facet
// =============================================================================

interface NamingRule {
  suffix: string;
  role: string;
  layer: ArchitectureLayer;
  entrypoint?: boolean;
}

const NAMING_RULES: NamingRule[] = [
  { suffix: 'Controller', role: 'controller', layer: 'entry', entrypoint: true },
  { suffix: 'RestController', role: 'controller', layer: 'entry', entrypoint: true },
  { suffix: 'ServiceImpl', role: 'service-impl', layer: 'business' },
  { suffix: 'Service', role: 'service', layer: 'business' },
  { suffix: 'Mapper', role: 'mapper', layer: 'data' },
  { suffix: 'Repository', role: 'repository', layer: 'data' },
  { suffix: 'Entity', role: 'entity', layer: 'model' },
  { suffix: 'Filter', role: 'filter', layer: 'entry', entrypoint: true },
  { suffix: 'Configuration', role: 'config', layer: 'infra' },
  { suffix: 'Config', role: 'config', layer: 'infra' },
  { suffix: 'Application', role: 'app', layer: 'infra', entrypoint: true },
  { suffix: 'Interceptor', role: 'component', layer: 'infra' },
  { suffix: 'Aspect', role: 'component', layer: 'infra' },
  { suffix: 'DTO', role: 'component', layer: 'infra' },
  { suffix: 'Bean', role: 'component', layer: 'infra' },
  { suffix: 'Component', role: 'component', layer: 'infra' },
  { suffix: 'Client', role: 'feign-client', layer: 'remote' },
];

export const springNamingFacet: ArchitectureFacet = {
  id: 'spring-naming',
  name: 'Spring Naming Conventions',
  description: 'Classifies Spring components by file/class naming suffixes.',

  detect(context: ArchitectureContext): ArchitectureSignal[] {
    const signals: ArchitectureSignal[] = [];
    const nodes = getNodes(context).filter(
      n => n.kind === 'class' || n.kind === 'interface'
    );

    for (const node of nodes) {
      for (const rule of NAMING_RULES) {
        if (node.name.endsWith(rule.suffix)) {
          const evidence = `Class/interface "${node.name}" follows Spring naming convention "*${rule.suffix}"`;
          signals.push({
            nodeId: node.id,
            facetName: 'spring-naming',
            profileName: 'spring-cloud',
            confidence: 0.75,
            evidence: [evidence],
            scope: 'node',
            filePath: node.filePath,
            metadata: {
              role: rule.role,
              layer: rule.layer,
              isEntrypoint: rule.entrypoint ?? false,
              suffix: rule.suffix,
            },
          });
          break;
        }
      }
    }

    return signals;
  },
};

// =============================================================================
// spring-annotation facet
// =============================================================================

function isSpringAdapter(adapter: AnnotationAdapter): boolean {
  return adapter.framework === 'spring';
}

function evidenceFromFact(fact: AnnotationFact): string[] {
  return fact.evidence.flatMap(signal => signal.evidence);
}

export const springAnnotationFacet: ArchitectureFacet = {
  id: 'spring-annotation',
  name: 'Spring Annotation Adapter Facet',
  description: 'Delegates node-level annotation detection to Phase 2 Spring adapters.',

  detect(context: ArchitectureContext): ArchitectureSignal[] {
    const signals: ArchitectureSignal[] = [];
    const nodes = getNodes(context);
    const adapters = annotationAdapterRegistry.getAdapters().filter(isSpringAdapter);

    for (const node of nodes) {
      for (const adapter of adapters) {
        if (!adapter.supports(node, context)) continue;
        const facts = adapter.collectFacts(node, context);
        for (const fact of facts) {
          if (!adapter.assignFacet) continue;
          const partials = adapter.assignFacet(fact, context);
          for (const partial of partials) {
            const rawRole = partial.role || (fact.metadata?.role as string) || fact.name;
            const role = canonicalizeRole(rawRole);
            if (!role) continue;

            const layer = (partial.layer as ArchitectureLayer) || getLayerForRole(role);
            const confidence = partial.confidence ?? fact.confidence;
            const evidence = partial.evidence?.length
              ? partial.evidence
              : evidenceFromFact(fact);

            signals.push({
              nodeId: fact.nodeId,
              facetName: 'spring-annotation',
              profileName: 'spring-cloud',
              confidence,
              evidence,
              scope: 'node',
              filePath: node.filePath,
              metadata: {
                role,
                layer,
                isEntrypoint: partial.isEntrypoint ?? false,
                adapterId: adapter.id,
                annotation: fact.metadata?.annotation || fact.name,
              },
            });
          }
        }
      }
    }

    return signals;
  },
};

// =============================================================================
// maven-module facet
// =============================================================================

function hasModuleDeclaration(pomContent: string): boolean {
  return /<module\s*>/i.test(pomContent) || /<modules\s*>/i.test(pomContent);
}

export const mavenModuleFacet: ArchitectureFacet = {
  id: 'maven-module',
  name: 'Maven / Gradle Module Detection',
  description: 'Detects multi-module Java projects via pom.xml and Gradle build files.',

  detect(context: ArchitectureContext): ArchitectureSignal[] {
    const signals: ArchitectureSignal[] = [];
    const filePaths = getFilePaths(context);

    const pomPaths = filePaths.filter(p => path.basename(p).toLowerCase() === 'pom.xml');
    const gradlePaths = filePaths.filter(p => /build\.gradle(?:\.kts)?$/i.test(p));

    if (pomPaths.length > 0) {
      let moduleCount = 0;
      for (const pomPath of pomPaths) {
        try {
          const content = fs.readFileSync(
            path.resolve(context.projectRoot, pomPath),
            'utf-8'
          );
          if (hasModuleDeclaration(content)) moduleCount++;
        } catch {
          // Ignore unreadable files
        }
      }

      const isMultiModule = moduleCount > 0 || pomPaths.length > 1;
      const confidence = Math.min(0.25 + (pomPaths.length - 1) * 0.05 + (isMultiModule ? 0.1 : 0), 0.6);
      signals.push({
        facetName: 'maven-module',
        profileName: 'spring-cloud',
        confidence,
        evidence: [
          `Found ${pomPaths.length} pom.xml file${pomPaths.length === 1 ? '' : 's'}` +
            (isMultiModule ? '; multi-module Maven layout detected' : ''),
        ],
        scope: 'project',
        metadata: {
          moduleType: 'maven',
          pomCount: pomPaths.length,
          isMultiModule,
        },
      });
    }

    if (gradlePaths.length > 0) {
      signals.push({
        facetName: 'maven-module',
        profileName: 'spring-cloud',
        confidence: 0.25,
        evidence: [
          `Found ${gradlePaths.length} Gradle build file${gradlePaths.length === 1 ? '' : 's'}`,
        ],
        scope: 'project',
        metadata: {
          moduleType: 'gradle',
          gradleCount: gradlePaths.length,
        },
      });
    }

    return signals;
  },
};

// =============================================================================
// spring-entrypoint facet
// =============================================================================

interface ParsedDecorator {
  name: string;
  args: string | null;
}

function parseDecorator(decorator: string): ParsedDecorator {
  let raw = decorator.trim();
  if (raw.startsWith('@')) raw = raw.slice(1);

  const openParen = raw.indexOf('(');
  const hasArgs = openParen !== -1 && raw.endsWith(')');
  const fullName = hasArgs ? raw.slice(0, openParen) : raw;
  const name = fullName.split('.').pop() || fullName;
  const args = hasArgs ? raw.slice(openParen + 1, -1) : null;
  return { name, args };
}

const ENTRYPOINT_ANNOTATIONS: Record<string, string> = {
  Controller: 'controller',
  RestController: 'controller',
  Scheduled: 'scheduler',
  EventListener: 'event-listener',
  ApplicationListener: 'event-listener',
  WebSocket: 'websocket',
  ServerEndpoint: 'websocket',
  Filter: 'filter',
};

export const springEntrypointFacet: ArchitectureFacet = {
  id: 'spring-entrypoint',
  name: 'Spring Entrypoint Detection',
  description: 'Marks Controller, Scheduler, EventListener, Filter, and WebSocket handlers as entry points.',

  detect(context: ArchitectureContext): ArchitectureSignal[] {
    const signals: ArchitectureSignal[] = [];
    const nodes = getNodes(context);

    for (const node of nodes) {
      if (!node.decorators || node.decorators.length === 0) continue;

      for (const decorator of node.decorators) {
        const { name } = parseDecorator(decorator);
        const role = ENTRYPOINT_ANNOTATIONS[name];
        if (!role) continue;

        signals.push({
          nodeId: node.id,
          facetName: 'spring-entrypoint',
          profileName: 'spring-cloud',
          confidence: 0.9,
          evidence: [`@${name} marks ${node.kind} ${node.qualifiedName} as a Spring entry point`],
          scope: 'node',
          filePath: node.filePath,
          metadata: {
            role,
            layer: 'entry',
            isEntrypoint: true,
            annotation: name,
          },
        });
      }
    }

    return signals;
  },
};

export const springCloudFacets: ArchitectureFacet[] = [
  springNamingFacet,
  springAnnotationFacet,
  mavenModuleFacet,
  springEntrypointFacet,
];

// =============================================================================
// Spring Cloud profile
// =============================================================================

export const springCloudProfile: ArchitectureProfile = {
  id: 'spring-cloud',
  name: 'Spring Cloud',
  description:
    'Spring Boot / Spring Cloud / Spring MVC microservice architecture with MyBatis, MapStruct, and Lombok conventions.',
  facetIds: springCloudFacets.map(f => f.id),
  layers: SPRING_CLOUD_LAYERS,
  roles: SPRING_CLOUD_ROLES,

  detect(signals: ArchitectureSignal[]): ArchitectureProfileMatch {
    const nodeSignals = signals.filter(s => s.nodeId);
    const projectSignals = signals.filter(s => !s.nodeId);
    const nodeCount = new Set(nodeSignals.map(s => s.nodeId)).size;

    const layerBreakdown: Record<string, number> = {};
    const roleBreakdown: Record<string, number> = {};

    for (const signal of nodeSignals) {
      const role = signal.metadata?.role as string | undefined;
      const layer = signal.metadata?.layer as string | undefined;
      if (role) {
        roleBreakdown[role] = (roleBreakdown[role] || 0) + 1;
      }
      if (layer) {
        layerBreakdown[layer] = (layerBreakdown[layer] || 0) + 1;
      }
    }

    let confidence = 0;
    if (signals.length > 0) {
      confidence = signals.reduce((sum, s) => sum + s.confidence, 0) / signals.length;
    }

    // A Maven/Gradle module signal is a strong project-level Spring Cloud indicator.
    if (projectSignals.length > 0) {
      confidence = Math.min(confidence + 0.05, 1);
    }

    return {
      profileName: 'spring-cloud',
      confidence,
      nodeCount,
      layerBreakdown,
      roleBreakdown,
      signals,
    };
  },
};

/**
 * Register the Spring Cloud profile and its facets with the singleton registries.
 * Generic fallback is registered as well so the architecture detector can fall
 * back to activeProfile: "generic" when no Spring signals are present.
 */
export function registerSpringCloudProfile(): void {
  if (!profileRegistry.getProfiles().some(p => p.id === genericProfile.id)) {
    profileRegistry.register(genericProfile);
  }
  if (!profileRegistry.getProfiles().some(p => p.id === springCloudProfile.id)) {
    profileRegistry.register(springCloudProfile);
  }
  for (const facet of springCloudFacets) {
    if (!facetRegistry.getFacet(facet.id)) {
      facetRegistry.register(facet);
    }
  }
}

registerSpringCloudProfile();
