import { describe, expect, it } from 'vitest';
import { JPAEntityResolver } from '../src/jpa-entity-resolver';
import type { SpringKgNode } from '@jinglonglong/springkg-shared';

const makeEntity = (id: string, name: string, decorators: string[]): SpringKgNode => ({
  id, kind: 'class', name, qualifiedName: `com.demo.${name}`, filePath: `${name}.java`,
  startLine: 1, endLine: 30, metadata: { decorators }, confidence: 1, createdAt: 0, updatedAt: 0,
});

describe('JPAEntityResolver', () => {
  it('emits table node for @Entity with explicit @Table name', () => {
    const resolver = new JPAEntityResolver();
    const entities = [makeEntity('ent:1', 'User', ['@Entity', '@Table(name = "t_user")'])];
    const { symbols, edges } = resolver.resolve(entities);

    expect(symbols).toHaveLength(1);
    expect(symbols[0].kind).toBe('table');
    expect(symbols[0].name).toBe('t_user');
    expect(edges).toHaveLength(1);
    expect(edges[0].kind).toBe('MAPS_TO_TABLE');
  });

  it('uses @Entity class name as table name when @Table has no name', () => {
    const resolver = new JPAEntityResolver();
    const entities = [makeEntity('ent:2', 'Product', ['@Entity'])];
    const { symbols } = resolver.resolve(entities);

    expect(symbols).toHaveLength(1);
    expect(symbols[0].name).toBe('product');
    expect(symbols[0].metadata).toMatchObject({ entityKind: 'jpa' });
  });

  it('skips classes without @Entity or @Table', () => {
    const resolver = new JPAEntityResolver();
    const entities = [
      makeEntity('ent:3', 'PlainClass', ['@Component']),
    ];
    const { symbols } = resolver.resolve(entities);
    expect(symbols).toHaveLength(0);
  });
});
