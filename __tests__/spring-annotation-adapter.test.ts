import { describe, it, expect, beforeEach } from 'vitest';
import { springAnnotationsAdapter } from '../src/architecture/adapters/spring-annotations';
import { Node } from '../src/types';
import { ArchitectureContext } from '../src/architecture/types';

function makeNode(partial: Partial<Node> = {}): Node {
  return {
    id: partial.id ?? 'node-1',
    name: partial.name ?? 'TestNode',
    kind: partial.kind ?? 'class',
    filePath: partial.filePath ?? 'TestNode.java',
    language: partial.language ?? 'java',
    startLine: partial.startLine ?? 1,
    endLine: partial.endLine ?? 10,
    startColumn: partial.startColumn ?? 0,
    endColumn: partial.endColumn ?? 0,
    updatedAt: partial.updatedAt ?? Date.now(),
    decorators: partial.decorators,
    signature: partial.signature,
    qualifiedName: partial.qualifiedName ?? partial.name ?? 'TestNode',
  } as Node;
}

const mockContext: ArchitectureContext = {
  db: {} as any,
  projectRoot: '/tmp/test',
};

describe('SpringAnnotationsAdapter', () => {
  describe('supports', () => {
    it('should support @Service annotation', () => {
      const node = makeNode({
        decorators: ['@Service'],
      });
      expect(springAnnotationsAdapter.supports(node, mockContext)).toBe(true);
    });

    it('should support @Controller annotation', () => {
      const node = makeNode({
        decorators: ['@Controller'],
      });
      expect(springAnnotationsAdapter.supports(node, mockContext)).toBe(true);
    });

    it('should support @RestController annotation', () => {
      const node = makeNode({
        decorators: ['@RestController'],
      });
      expect(springAnnotationsAdapter.supports(node, mockContext)).toBe(true);
    });

    it('should support @Repository annotation', () => {
      const node = makeNode({
        decorators: ['@Repository'],
      });
      expect(springAnnotationsAdapter.supports(node, mockContext)).toBe(true);
    });

    it('should support @Component annotation', () => {
      const node = makeNode({
        decorators: ['@Component'],
      });
      expect(springAnnotationsAdapter.supports(node, mockContext)).toBe(true);
    });

    it('should support @Autowired annotation', () => {
      const node = makeNode({
        decorators: ['@Autowired'],
      });
      expect(springAnnotationsAdapter.supports(node, mockContext)).toBe(true);
    });

    it('should not support non-Spring annotations', () => {
      const node = makeNode({
        decorators: ['@Getter', '@Data'],
      });
      expect(springAnnotationsAdapter.supports(node, mockContext)).toBe(false);
    });

    it('should not support nodes without decorators', () => {
      const node = makeNode({
        decorators: undefined,
      });
      expect(springAnnotationsAdapter.supports(node, mockContext)).toBe(false);
    });
  });

  describe('collectFacts', () => {
    it('should collect bean fact for @Service', () => {
      const node = makeNode({
        id: 'service-1',
        name: 'UserService',
        kind: 'class',
        decorators: ['@Service'],
      });

      const facts = springAnnotationsAdapter.collectFacts(node, mockContext);
      expect(facts).toHaveLength(1);
      expect(facts[0].kind).toBe('bean');
      expect(facts[0].name).toBe('UserService');
      expect(facts[0].metadata.role).toBe('Service');
    });

    it('should collect bean fact for @RestController', () => {
      const node = makeNode({
        id: 'controller-1',
        name: 'UserController',
        kind: 'class',
        decorators: ['@RestController'],
      });

      const facts = springAnnotationsAdapter.collectFacts(node, mockContext);
      expect(facts).toHaveLength(1);
      expect(facts[0].kind).toBe('bean');
      expect(facts[0].metadata.role).toBe('RestController');
    });

    it('should collect injection fact for @Autowired field', () => {
      const node = makeNode({
        id: 'field-1',
        name: 'userRepository',
        kind: 'field',
        decorators: ['@Autowired'],
        signature: 'private UserRepository userRepository;',
      });

      const facts = springAnnotationsAdapter.collectFacts(node, mockContext);
      expect(facts).toHaveLength(1);
      expect(facts[0].kind).toBe('injection');
      expect(facts[0].name).toBe('userRepository');
    });

    it('should collect config-binding fact for @Value', () => {
      const node = makeNode({
        id: 'field-1',
        name: 'appName',
        kind: 'field',
        decorators: ['@Value("${app.name}")'],
      });

      const facts = springAnnotationsAdapter.collectFacts(node, mockContext);
      expect(facts).toHaveLength(1);
      expect(facts[0].kind).toBe('config-binding');
      expect(facts[0].metadata.propertyKey).toBe('${app.name}');
    });

    it('should collect config-binding fact for @ConfigurationProperties', () => {
      const node = makeNode({
        id: 'class-1',
        name: 'AppProperties',
        kind: 'class',
        decorators: ['@ConfigurationProperties(prefix = "app")'],
      });

      const facts = springAnnotationsAdapter.collectFacts(node, mockContext);
      expect(facts).toHaveLength(1);
      expect(facts[0].kind).toBe('config-binding');
      expect(facts[0].metadata.prefix).toBe('app');
    });
  });

  describe('assignFacet', () => {
    it('should assign Service role in business layer', () => {
      const fact = {
        adapterId: 'spring-annotations',
        nodeId: 'service-1',
        kind: 'bean' as const,
        name: 'UserService',
        metadata: { role: 'Service' },
        confidence: 0.9,
        evidence: [],
      };

      const facets = springAnnotationsAdapter.assignFacet(fact, mockContext);
      expect(facets).toHaveLength(1);
      expect(facets[0].role).toBe('Service');
      expect(facets[0].layer).toBe('business');
    });

    it('should assign Controller role in entry layer', () => {
      const fact = {
        adapterId: 'spring-annotations',
        nodeId: 'controller-1',
        kind: 'bean' as const,
        name: 'UserController',
        metadata: { role: 'RestController' },
        confidence: 0.9,
        evidence: [],
      };

      const facets = springAnnotationsAdapter.assignFacet(fact, mockContext);
      expect(facets).toHaveLength(1);
      expect(facets[0].role).toBe('RestController');
      expect(facets[0].layer).toBe('entry');
    });

    it('should assign InjectionPoint role for injection facts', () => {
      const fact = {
        adapterId: 'spring-annotations',
        nodeId: 'field-1',
        kind: 'injection' as const,
        name: 'userRepository',
        metadata: {},
        confidence: 0.7,
        evidence: [],
      };

      const facets = springAnnotationsAdapter.assignFacet(fact, mockContext);
      expect(facets).toHaveLength(1);
      expect(facets[0].role).toBe('InjectionPoint');
      expect(facets[0].layer).toBe('infra');
    });
  });
});
