import { describe, expect, it } from 'vitest';
import { MyBatisPlusResolver } from '../src/mybatis-plus-resolver';
import type { SpringKgNode } from '@colbymchenry/springkg-shared';

const makeClass = (id: string, name: string, decorators: string[]): SpringKgNode => ({
  id, kind: 'class', name, qualifiedName: `com.demo.${name}`, filePath: `${name}.java`,
  startLine: 1, endLine: 20, metadata: { decorators }, confidence: 1, createdAt: 0, updatedAt: 0,
});

describe('MyBatisPlusResolver', () => {
  it('emits table node + MAPS_TO_TABLE edge for @TableName annotated class', () => {
    const resolver = new MyBatisPlusResolver();
    const classes = [makeClass('cls:1', 'UserDO', ['@Mapper', '@TableName("sys_user")'])];
    const { symbols, edges } = resolver.resolve(classes);

    expect(symbols).toHaveLength(1);
    expect(symbols[0].kind).toBe('table');
    expect(symbols[0].name).toBe('sys_user');
    expect(edges).toHaveLength(1);
    expect(edges[0].kind).toBe('MAPS_TO_TABLE');
    expect(edges[0].metadata).toMatchObject({ tableName: 'sys_user', annotation: '@TableName' });
  });

  it('derives table name from class name via snake_case convention', () => {
    const resolver = new MyBatisPlusResolver();
    const classes = [makeClass('cls:2', 'UserProfile', ['@Mapper'])];
    const { symbols } = resolver.resolve(classes);

    expect(symbols).toHaveLength(1);
    expect(symbols[0].name).toBe('user_profile');
    expect(symbols[0].metadata).toMatchObject({ entityKind: 'mybatis_plus', className: 'UserProfile' });
  });

  it('strips DO/VO/DTO/Entity suffix before snake_case conversion', () => {
    const resolver = new MyBatisPlusResolver();
    const classes = [
      makeClass('cls:3', 'UserDO', ['@Mapper']),
      makeClass('cls:4', 'OrderVO', ['@Mapper']),
      makeClass('cls:5', 'ProductDTO', ['@Mapper']),
    ];
    const { symbols } = resolver.resolve(classes);
    expect(symbols.map((s) => s.name)).toEqual(['user', 'order', 'product']);
  });
});
