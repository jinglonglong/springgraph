import { describe, it, expect, beforeEach } from 'vitest';
import { lombokAdapter } from '../src/architecture/adapters/lombok';
import { Node } from '../src/types';
import { ArchitectureContext } from '../src/architecture/types';
import * as fs from 'fs';
import * as path from 'path';

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

describe('LombokAdapter', () => {
  describe('supports', () => {
    it('should support @Getter annotation', () => {
      const node = makeNode({
        decorators: ['Getter'],
      });
      expect(lombokAdapter.supports(node, mockContext)).toBe(true);
    });

    it('should support @Setter annotation', () => {
      const node = makeNode({
        decorators: ['Setter'],
      });
      expect(lombokAdapter.supports(node, mockContext)).toBe(true);
    });

    it('should support @Data annotation', () => {
      const node = makeNode({
        decorators: ['Data'],
      });
      expect(lombokAdapter.supports(node, mockContext)).toBe(true);
    });

    it('should support @RequiredArgsConstructor', () => {
      const node = makeNode({
        decorators: ['RequiredArgsConstructor'],
      });
      expect(lombokAdapter.supports(node, mockContext)).toBe(true);
    });

    it('should support @Slf4j annotation', () => {
      const node = makeNode({
        decorators: ['Slf4j'],
      });
      expect(lombokAdapter.supports(node, mockContext)).toBe(true);
    });

    it('should not support non-Lombok annotations', () => {
      const node = makeNode({
        decorators: ['Service', 'Component'],
      });
      expect(lombokAdapter.supports(node, mockContext)).toBe(false);
    });

    it('should not support nodes without decorators', () => {
      const node = makeNode({
        decorators: undefined,
      });
      expect(lombokAdapter.supports(node, mockContext)).toBe(false);
    });
  });

  describe('collectFacts', () => {
    it('should collect generated-property fact for @Getter', () => {
      const node = makeNode({
        id: 'user-1',
        name: 'User',
        kind: 'class',
        decorators: ['Getter'],
      });

      const facts = lombokAdapter.collectFacts(node, mockContext);
      expect(facts).toHaveLength(1);
      expect(facts[0].kind).toBe('generated-property');
      expect(facts[0].name).toBe('Getter');
      expect(facts[0].metadata.generates).toEqual(['getter']);
    });

    it('should collect generated-property fact for @Data', () => {
      const node = makeNode({
        id: 'user-1',
        name: 'User',
        kind: 'class',
        decorators: ['Data'],
      });

      const facts = lombokAdapter.collectFacts(node, mockContext);
      expect(facts).toHaveLength(1);
      expect(facts[0].kind).toBe('generated-property');
      expect(facts[0].name).toBe('Data');
      expect(facts[0].metadata.generates).toEqual(['getter', 'setter']);
    });

    it('should collect generated-method fact for @NoArgsConstructor', () => {
      const node = makeNode({
        id: 'user-1',
        name: 'User',
        kind: 'class',
        decorators: ['NoArgsConstructor'],
      });

      const facts = lombokAdapter.collectFacts(node, mockContext);
      expect(facts).toHaveLength(1);
      expect(facts[0].kind).toBe('generated-method');
      expect(facts[0].name).toBe('NoArgsConstructor');
      expect(facts[0].metadata.generates).toBe('constructor');
    });

    it('should collect lifecycle fact for @Slf4j', () => {
      const node = makeNode({
        id: 'service-1',
        name: 'UserService',
        kind: 'class',
        decorators: ['Slf4j'],
      });

      const facts = lombokAdapter.collectFacts(node, mockContext);
      expect(facts).toHaveLength(1);
      expect(facts[0].kind).toBe('lifecycle');
      expect(facts[0].name).toBe('Slf4j');
      expect(facts[0].metadata.generates).toBe('logger');
    });

    it('should not create node explosion for @RequiredArgsConstructor', () => {
      const node = makeNode({
        id: 'service-1',
        name: 'UserService',
        kind: 'class',
        decorators: ['RequiredArgsConstructor'],
      });

      // Without final fields, should not generate constructor injection fact
      const facts = lombokAdapter.collectFacts(node, mockContext);
      expect(facts).toHaveLength(0);
    });
  });
});
