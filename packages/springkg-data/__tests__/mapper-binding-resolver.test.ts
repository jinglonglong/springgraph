import { describe, expect, it } from 'vitest';
import { MapperBindingResolver } from '../src/mapper-binding-resolver';
import type { SpringKgNode } from '@colbymchenry/springkg-shared';

const makeInterface = (id: string, fqn: string, methods: string[]): { interfaceNode: SpringKgNode; methods: SpringKgNode[] } => ({
  interfaceNode: { id, kind: 'class', qualifiedName: fqn, name: fqn.split('.').pop(), filePath: 'UserDao.java', startLine: 1, endLine: 10, metadata: { decorators: ['@Mapper'] }, confidence: 1, createdAt: 0, updatedAt: 0 },
  methods: methods.map((name, i) => ({ id: `${id}:method:${name}`, kind: 'method' as const, name, qualifiedName: `${fqn}::${name}`, filePath: 'UserDao.java', startLine: i + 2, endLine: i + 2, metadata: {}, confidence: 1, createdAt: 0, updatedAt: 0 })),
});

describe('MapperBindingResolver', () => {
  it('emits mapper, mapper_method, BIND_TO and CALLS edges for XML-matched methods', () => {
    const resolver = new MapperBindingResolver();
    const mappers = [makeInterface('dao:user', 'demo.UserDao', ['findAll', 'findById', 'insert'])];
    const xmlStatements = [
      { namespace: 'demo.UserDao', statementId: 'findAll', id: 'sql:findAll' },
      { namespace: 'demo.UserDao', statementId: 'findById', id: 'sql:findById' },
    ];
    const annotationStatements: Array<{ filePath: string; statementId: string; id: string }> = [];

    const { symbols, edges, output } = resolver.resolve(mappers, xmlStatements, annotationStatements);

    expect(symbols.filter((s) => s.kind === 'mapper')).toHaveLength(1);
    expect(symbols.filter((s) => s.kind === 'mapper_method')).toHaveLength(2); // insert has no XML match
    expect(edges.filter((e) => e.kind === 'BIND_TO')).toHaveLength(2);
    expect(edges.filter((e) => e.kind === 'CALLS')).toHaveLength(2);
    expect(output.symbolsAdded).toBe(3); // 1 mapper + 2 mapper_method
  });

  it('annotation-only methods get mapper_method from annotationStatements', () => {
    const resolver = new MapperBindingResolver();
    const mapperInterface: SpringKgNode = {
      id: 'iface:user2', kind: 'class', name: 'UserDao2', qualifiedName: 'demo.UserDao2',
      filePath: 'UserDao2.java', startLine: 1, endLine: 5,
      metadata: { decorators: ['@Mapper'] }, confidence: 1, createdAt: 0, updatedAt: 0,
    };
    const methodNode: SpringKgNode = {
      id: 'method:user2:count', kind: 'method', name: 'count',
      qualifiedName: 'demo.UserDao2::count', filePath: 'UserDao2.java',
      startLine: 3, endLine: 3, metadata: {}, confidence: 1, createdAt: 0, updatedAt: 0,
    };
    const mappers = [{ interfaceNode: mapperInterface, methods: [methodNode] }];
    const xmlStatements: Array<{ namespace: string; statementId: string; id: string }> = [];
    const annotationStatements = [{ filePath: 'UserDao2.java', statementId: 'count', id: 'ann:count' }];

    const { symbols, edges } = resolver.resolve(mappers, xmlStatements, annotationStatements);

    expect(symbols.filter((s) => s.kind === 'mapper_method')).toHaveLength(1);
    const methodSymbol = symbols.find((s) => s.kind === 'mapper_method');
    expect(methodSymbol?.metadata).toMatchObject({ source: 'annotation', statementId: 'count' });
    expect(edges.filter((e) => e.kind === 'BIND_TO')).toHaveLength(1);
    expect(edges.filter((e) => e.kind === 'BIND_TO')[0]?.targetId).toBe('ann:count');
  });

  it('interface with no matching XML still emits mapper row', () => {
    const resolver = new MapperBindingResolver();
    const mappers = [makeInterface('dao:orphan', 'demo.OrphanDao', ['findOrphan'])];
    const xmlStatements: Array<{ namespace: string; statementId: string; id: string }> = [];
    const annotationStatements: Array<{ filePath: string; statementId: string; id: string }> = [];

    const { symbols, edges } = resolver.resolve(mappers, xmlStatements, annotationStatements);

    expect(symbols.filter((s) => s.kind === 'mapper')).toHaveLength(1);
    expect(symbols.filter((s) => s.kind === 'mapper_method')).toHaveLength(0); // no match
    expect(edges).toHaveLength(0);
  });
});
