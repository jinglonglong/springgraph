import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { DatabaseConnection } from '../src/db';
import { facetRegistry } from '../src/architecture/facet-engine';
import { profileRegistry } from '../src/architecture/profile-registry';
import { detectArchitectureProfile } from '../src/architecture/profile-detector';
import {
  springCloudProfile,
  springCloudFacets,
  springNamingFacet,
  springAnnotationFacet,
  mavenModuleFacet,
  springEntrypointFacet,
  registerSpringCloudProfile,
} from '../src/architecture/profiles/spring-cloud';
import { ArchitectureContext, ArchitectureSignal } from '../src/architecture/types';
import { Node } from '../src/types';

describe('spring-cloud profile', () => {
  let db: DatabaseConnection;
  let dbPath: string;
  let tempDir: string;

  beforeEach(() => {
    profileRegistry.clear();
    facetRegistry.clear();
    registerSpringCloudProfile();

    tempDir = path.join(__dirname, '../temp-spring-cloud-profile-test');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const springgraphDir = path.join(tempDir, '.springgraph');
    if (!fs.existsSync(springgraphDir)) {
      fs.mkdirSync(springgraphDir, { recursive: true });
    }
    dbPath = path.join(springgraphDir, 'springgraph.db');
    if (fs.existsSync(dbPath)) {
      try {
        fs.unlinkSync(dbPath);
      } catch {}
    }
    db = DatabaseConnection.initialize(dbPath);
  });

  afterEach(() => {
    if (db && db.isOpen()) {
      db.close();
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    profileRegistry.clear();
    facetRegistry.clear();
  });

  function createNode(overrides: Partial<Node> & { id: string; name: string }): Node {
    return {
      id: overrides.id,
      name: overrides.name,
      kind: 'class',
      qualifiedName: overrides.qualifiedName || overrides.name,
      filePath: overrides.filePath || `${overrides.name}.java`,
      language: 'java',
      startLine: 1,
      endLine: 10,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
      ...overrides,
    };
  }

  function insertNode(node: Node): void {
    db
      .getDb()
      .prepare(
        `INSERT INTO nodes (
          id, kind, name, qualified_name, file_path, language,
          start_line, end_line, start_column, end_column,
          docstring, signature, visibility,
          is_exported, is_async, is_static, is_abstract,
          decorators, type_parameters, return_type, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        node.id,
        node.kind,
        node.name,
        node.qualifiedName,
        node.filePath,
        node.language,
        node.startLine,
        node.endLine,
        node.startColumn,
        node.endColumn,
        node.docstring ?? null,
        node.signature ?? null,
        node.visibility ?? null,
        node.isExported ? 1 : 0,
        node.isAsync ? 1 : 0,
        node.isStatic ? 1 : 0,
        node.isAbstract ? 1 : 0,
        node.decorators ? JSON.stringify(node.decorators) : null,
        node.typeParameters ? JSON.stringify(node.typeParameters) : null,
        node.returnType ?? null,
        node.updatedAt
      );
  }

  function makeContext(nodes: Node[]): ArchitectureContext {
    return {
      db,
      projectRoot: tempDir,
      getNodes: () => nodes,
    } as unknown as ArchitectureContext;
  }

  it('defines the six Spring Cloud layers', () => {
    const layerIds = springCloudProfile.layers.map((l) => l.id);
    expect(layerIds).toEqual(['entry', 'remote', 'business', 'data', 'model', 'infra']);
  });

  it('defines the fifteen Spring Cloud roles', () => {
    const roleIds = springCloudProfile.roles.map((r) => r.id);
    expect(roleIds).toEqual(
      expect.arrayContaining([
        'controller',
        'controller-advice',
        'scheduler',
        'event-listener',
        'filter',
        'websocket',
        'feign-client',
        'service',
        'service-impl',
        'mapper',
        'repository',
        'entity',
        'config',
        'component',
        'app',
      ])
    );
    expect(springCloudProfile.roles.length).toBe(15);
  });

  it('registers the four required facets', () => {
    expect(springCloudProfile.facetIds).toEqual(
      expect.arrayContaining(['spring-naming', 'spring-annotation', 'maven-module', 'spring-entrypoint'])
    );
    expect(springCloudProfile.facetIds.length).toBe(4);
    for (const id of springCloudProfile.facetIds) {
      expect(facetRegistry.getFacet(id)).toBeDefined();
    }
  });

  describe('spring-naming facet', () => {
    it('classifies classes by Spring naming suffixes', () => {
      const nodes: Node[] = [
        createNode({ id: 'c1', name: 'UserController' }),
        createNode({ id: 'c2', name: 'UserServiceImpl' }),
        createNode({ id: 'c3', name: 'UserMapper' }),
        createNode({ id: 'c4', name: 'UserEntity' }),
        createNode({ id: 'c5', name: 'AppConfig' }),
        createNode({ id: 'c6', name: 'OrderClient' }),
      ];

      const signals = springNamingFacet.detect(makeContext(nodes));
      const byRole = groupByRole(signals);

      expect(byRole.controller).toHaveLength(1);
      expect(byRole['service-impl']).toHaveLength(1);
      expect(byRole.mapper).toHaveLength(1);
      expect(byRole.entity).toHaveLength(1);
      expect(byRole.config).toHaveLength(1);
      expect(byRole['feign-client']).toHaveLength(1);

      const controller = byRole.controller![0];
      expect(controller.metadata?.role).toBe('controller');
      expect(controller.metadata?.layer).toBe('entry');
      expect(controller.metadata?.isEntrypoint).toBe(true);
      expect(controller.evidence[0]).toContain('UserController');
    });

    it('gives longer suffixes precedence (ServiceImpl over Service)', () => {
      const nodes: Node[] = [createNode({ id: 's1', name: 'OrderServiceImpl' })];
      const signals = springNamingFacet.detect(makeContext(nodes));
      expect(signals).toHaveLength(1);
      expect(signals[0].metadata?.role).toBe('service-impl');
      expect(signals[0].metadata?.layer).toBe('business');
    });
  });

  describe('spring-annotation facet', () => {
    it('delegates Spring annotations to Phase 2 adapters', () => {
      const nodes: Node[] = [
        createNode({ id: 'r1', name: 'UserController', decorators: ['@RestController'] }),
        createNode({ id: 's1', name: 'UserService', decorators: ['@Service'] }),
        createNode({ id: 'repo1', name: 'UserRepository', decorators: ['@Repository'] }),
        createNode({ id: 'l1', name: 'UserLombok', decorators: ['@Data'] }),
      ];

      const signals = springAnnotationFacet.detect(makeContext(nodes));
      const byNode = groupByNodeId(signals);

      expect(byNode.get('r1')?.metadata?.role).toBe('controller');
      expect(byNode.get('r1')?.metadata?.layer).toBe('entry');
      expect(byNode.get('s1')?.metadata?.role).toBe('service');
      expect(byNode.get('s1')?.metadata?.layer).toBe('business');
      expect(byNode.get('repo1')?.metadata?.role).toBe('repository');
      expect(byNode.get('repo1')?.metadata?.layer).toBe('data');
      expect(byNode.has('l1')).toBe(false); // Lombok is not a Spring adapter
    });

    it('canonicalizes adapter-specific role names to the profile role set', () => {
      const nodes: Node[] = [
        createNode({
          id: 'e1',
          name: 'createUser',
          kind: 'method',
          decorators: ['@GetMapping("/users")'],
        }),
      ];

      const signals = springAnnotationFacet.detect(makeContext(nodes));
      expect(signals).toHaveLength(1);
      expect(signals[0].metadata?.role).toBe('controller');
      expect(signals[0].metadata?.layer).toBe('entry');
      expect(signals[0].metadata?.isEntrypoint).toBe(true);
    });
  });

  describe('maven-module facet', () => {
    it('detects Maven module structure from file nodes', () => {
      const nodes: Node[] = [
        createNode({
          id: 'f1',
          name: 'pom.xml',
          kind: 'file',
          filePath: 'pom.xml',
          language: 'xml',
        }),
        createNode({
          id: 'f2',
          name: 'pom.xml',
          kind: 'file',
          filePath: 'module1/pom.xml',
          language: 'xml',
        }),
      ];

      const signals = mavenModuleFacet.detect(makeContext(nodes));
      expect(signals).toHaveLength(1);
      expect(signals[0].facetName).toBe('maven-module');
      expect(signals[0].metadata?.moduleType).toBe('maven');
      expect(signals[0].confidence).toBeGreaterThan(0);
      expect(signals[0].evidence[0]).toContain('pom.xml');
      expect(signals[0].metadata?.isMultiModule).toBe(true);
    });

    it('detects Gradle build files', () => {
      const nodes: Node[] = [
        createNode({
          id: 'g1',
          name: 'build.gradle',
          kind: 'file',
          filePath: 'build.gradle',
          language: 'unknown',
        }),
      ];

      const signals = mavenModuleFacet.detect(makeContext(nodes));
      expect(signals).toHaveLength(1);
      expect(signals[0].metadata?.moduleType).toBe('gradle');
    });
  });

  describe('spring-entrypoint facet', () => {
    it('marks Controller, Scheduler, EventListener, Filter, and WebSocket as entry points', () => {
      const nodes: Node[] = [
        createNode({ id: 'ctrl', name: 'UserController', decorators: ['@RestController'] }),
        createNode({
          id: 'job',
          name: 'cleaner',
          kind: 'method',
          decorators: ['@Scheduled(cron = "0 0 * * *")'],
        }),
        createNode({ id: 'evt', name: 'onUserCreated', kind: 'method', decorators: ['@EventListener'] }),
        createNode({ id: 'ws', name: 'ChatSocket', decorators: ['@ServerEndpoint'] }),
      ];

      const signals = springEntrypointFacet.detect(makeContext(nodes));
      const byRole = groupByRole(signals);

      expect(byRole.controller).toHaveLength(1);
      expect(byRole.scheduler).toHaveLength(1);
      expect(byRole['event-listener']).toHaveLength(1);
      expect(byRole.websocket).toHaveLength(1);

      for (const signal of signals) {
        expect(signal.metadata?.isEntrypoint).toBe(true);
        expect(signal.metadata?.layer).toBe('entry');
      }
    });
  });

  describe('profile-level detect()', () => {
    it('aggregates facet signals with confidence, node count, and breakdowns', () => {
      const signals: ArchitectureSignal[] = [
        {
          nodeId: 'n1',
          facetName: 'spring-naming',
          profileName: 'spring-cloud',
          confidence: 0.75,
          evidence: ['UserController naming match'],
          metadata: { role: 'controller', layer: 'entry' },
        },
        {
          nodeId: 'n2',
          facetName: 'spring-naming',
          profileName: 'spring-cloud',
          confidence: 0.75,
          evidence: ['UserService naming match'],
          metadata: { role: 'service', layer: 'business' },
        },
        {
          nodeId: 'n3',
          facetName: 'spring-naming',
          profileName: 'spring-cloud',
          confidence: 0.75,
          evidence: ['UserMapper naming match'],
          metadata: { role: 'mapper', layer: 'data' },
        },
        {
          facetName: 'maven-module',
          profileName: 'spring-cloud',
          confidence: 0.4,
          evidence: ['Found pom.xml'],
          scope: 'project',
          metadata: { moduleType: 'maven' },
        },
      ];

      const match = springCloudProfile.detect(signals);

      expect(match.profileName).toBe('spring-cloud');
      expect(match.nodeCount).toBe(3);
      expect(match.roleBreakdown.controller).toBe(1);
      expect(match.roleBreakdown.service).toBe(1);
      expect(match.roleBreakdown.mapper).toBe(1);
      expect(match.layerBreakdown.entry).toBe(1);
      expect(match.layerBreakdown.business).toBe(1);
      expect(match.layerBreakdown.data).toBe(1);
      expect(match.confidence).toBeGreaterThan(0);
      expect(match.signals).toEqual(signals);
    });

    it('returns zero confidence and empty breakdowns when there are no signals', () => {
      const match = springCloudProfile.detect([]);
      expect(match.confidence).toBe(0);
      expect(match.nodeCount).toBe(0);
      expect(Object.keys(match.roleBreakdown)).toHaveLength(0);
      expect(Object.keys(match.layerBreakdown)).toHaveLength(0);
    });
  });

  describe('architecture detector integration', () => {
    it('falls back to generic profile when no Spring signals are present', () => {
      const result = detectArchitectureProfile([], db);
      expect(result.activeProfile).toBe('generic');

      const springMatch = result.allMatches.find((m) => m.profileName === 'spring-cloud');
      expect(springMatch).toBeDefined();
      expect(springMatch!.confidence).toBe(0);
      expect(springMatch!.nodeCount).toBe(0);

      const genericMatch = result.allMatches.find((m) => m.profileName === 'generic');
      expect(genericMatch).toBeDefined();
      expect(genericMatch!.confidence).toBe(0.1);
    });

    it('selects spring-cloud when Spring naming signals are present in the DB', () => {
      insertNode(createNode({ id: 'ctrl', name: 'UserController' }));
      insertNode(createNode({ id: 'svc', name: 'UserService' }));

      const result = detectArchitectureProfile([], db);
      expect(result.activeProfile).toBe('spring-cloud');

      const springMatch = result.allMatches.find((m) => m.profileName === 'spring-cloud');
      expect(springMatch).toBeDefined();
      expect(springMatch!.confidence).toBeGreaterThan(0);
      expect(springMatch!.nodeCount).toBe(2);
      expect(springMatch!.roleBreakdown.controller).toBe(1);
      expect(springMatch!.roleBreakdown.service).toBe(1);
    });

    it('gives spring-cloud higher confidence than generic with annotation + module evidence', () => {
      insertNode(
        createNode({ id: 'ctrl', name: 'UserController', decorators: ['@RestController'] })
      );
      insertNode(createNode({ id: 'svc', name: 'UserService', decorators: ['@Service'] }));

      const result = detectArchitectureProfile([], db);
      expect(result.activeProfile).toBe('spring-cloud');
      const springMatch = result.allMatches.find((m) => m.profileName === 'spring-cloud')!;
      const genericMatch = result.allMatches.find((m) => m.profileName === 'generic')!;
      expect(springMatch.confidence).toBeGreaterThan(genericMatch.confidence);
    });
  });
});

function groupByRole(signals: ArchitectureSignal[]): Record<string, ArchitectureSignal[]> {
  const map: Record<string, ArchitectureSignal[]> = {};
  for (const signal of signals) {
    const role = signal.metadata?.role as string | undefined;
    if (!role) continue;
    (map[role] ||= []).push(signal);
  }
  return map;
}

function groupByNodeId(signals: ArchitectureSignal[]): Map<string, ArchitectureSignal> {
  const map = new Map<string, ArchitectureSignal>();
  for (const signal of signals) {
    if (signal.nodeId) {
      map.set(signal.nodeId, signal);
    }
  }
  return map;
}
