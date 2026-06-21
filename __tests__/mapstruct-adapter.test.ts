import { describe, it, expect, beforeEach } from 'vitest';
import { mapStructAdapter } from '../src/architecture/adapters/mapstruct';
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

describe('MapStructAdapter', () => {
  describe('supports', () => {
    it('should support @Mapper annotation', () => {
      const node = makeNode({
        decorators: ['@Mapper'],
      });
      expect(mapStructAdapter.supports(node, mockContext)).toBe(true);
    });

    it('should support @Mapper with componentModel', () => {
      const node = makeNode({
        decorators: ['@Mapper(componentModel = "spring")'],
      });
      expect(mapStructAdapter.supports(node, mockContext)).toBe(true);
    });

    it('should support @Mapping annotation', () => {
      const node = makeNode({
        decorators: ['@Mapping(source = "name", target = "name")'],
      });
      expect(mapStructAdapter.supports(node, mockContext)).toBe(true);
    });

    it('should not support non-MapStruct annotations', () => {
      const node = makeNode({
        decorators: ['@Service', '@Component'],
      });
      expect(mapStructAdapter.supports(node, mockContext)).toBe(false);
    });

    it('should not support nodes without decorators', () => {
      const node = makeNode({
        decorators: undefined,
      });
      expect(mapStructAdapter.supports(node, mockContext)).toBe(false);
    });
  });

  describe('collectFacts', () => {
    it('should collect bean fact for @Mapper interface', () => {
      const node = makeNode({
        id: 'mapper-1',
        name: 'UserMapper',
        kind: 'interface',
        decorators: ['@Mapper'],
      });

      const facts = mapStructAdapter.collectFacts(node, mockContext);
      expect(facts).toHaveLength(1);
      expect(facts[0].kind).toBe('bean');
      expect(facts[0].name).toBe('Mapper');
      expect(facts[0].metadata.onInterface).toBe(true);
    });

    it('should collect uses references from @Mapper', () => {
      const node = makeNode({
        id: 'mapper-1',
        name: 'UserMapper',
        kind: 'interface',
        decorators: ['@Mapper(uses = {AddressMapper.class})'],
      });

      const facts = mapStructAdapter.collectFacts(node, mockContext);
      expect(facts).toHaveLength(1);
      expect(facts[0].metadata.uses).toEqual(['AddressMapper']);
    });

    it('should collect Spring component role for componentModel=spring', () => {
      const node = makeNode({
        id: 'mapper-1',
        name: 'UserMapper',
        kind: 'interface',
        decorators: ['@Mapper(componentModel = "spring")'],
      });

      const facts = mapStructAdapter.collectFacts(node, mockContext);
      expect(facts).toHaveLength(2);
      
      const springFact = facts.find(f => f.name === 'SpringComponent');
      expect(springFact).toBeDefined();
      expect(springFact!.metadata.componentModel).toBe('spring');
    });

    it('should collect mapping facts for @Mapping', () => {
      const node = makeNode({
        id: 'mapper-1',
        name: 'toDTO',
        kind: 'method',
        decorators: ['@Mapping(source = "name", target = "fullName")'],
      });

      const facts = mapStructAdapter.collectFacts(node, mockContext);
      expect(facts).toHaveLength(1);
      expect(facts[0].kind).toBe('mapping');
      expect(facts[0].metadata.source).toBe('name');
      expect(facts[0].metadata.target).toBe('fullName');
    });
  });

  describe('synthesizeEdges', () => {
    it('should synthesize references edges for uses', () => {
      const fact = {
        adapterId: 'mapstruct',
        nodeId: 'mapper-1',
        kind: 'bean' as const,
        name: 'Mapper',
        metadata: {
          uses: ['AddressMapper', 'PhoneNumberMapper'],
        },
        confidence: 0.85,
        evidence: [],
      };

      const edges = mapStructAdapter.synthesizeEdges!(fact, mockContext);
      expect(edges).toHaveLength(2);
      expect(edges[0].kind).toBe('references');
      expect(edges[0].provenance).toBe('heuristic');
      expect(edges[0].target).toBe('AddressMapper');
      expect(edges[1].target).toBe('PhoneNumberMapper');
    });

    it('should return empty array for non-Mapper facts', () => {
      const fact = {
        adapterId: 'mapstruct',
        nodeId: 'mapper-1',
        kind: 'mapping' as const,
        name: 'Mapping',
        metadata: {},
        confidence: 0.8,
        evidence: [],
      };

      const edges = mapStructAdapter.synthesizeEdges!(fact, mockContext);
      expect(edges).toHaveLength(0);
    });
  });

  describe('assignFacet', () => {
    it('should assign Mapper role in data layer', () => {
      const fact = {
        adapterId: 'mapstruct',
        nodeId: 'mapper-1',
        kind: 'bean' as const,
        name: 'Mapper',
        metadata: {},
        confidence: 0.85,
        evidence: [],
      };

      const facets = mapStructAdapter.assignFacet!(fact, mockContext);
      expect(facets).toHaveLength(1);
      expect(facets[0].role).toBe('Mapper');
      expect(facets[0].layer).toBe('data');
    });

    it('should assign Component role for Spring component model', () => {
      const fact = {
        adapterId: 'mapstruct',
        nodeId: 'mapper-1',
        kind: 'bean' as const,
        name: 'SpringComponent',
        metadata: { componentModel: 'spring' },
        confidence: 0.8,
        evidence: [],
      };

      const facets = mapStructAdapter.assignFacet!(fact, mockContext);
      expect(facets).toHaveLength(1);
      expect(facets[0].role).toBe('Component');
      expect(facets[0].layer).toBe('infra');
    });
  });
});
