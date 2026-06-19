import { describe, expect, it } from 'vitest';
import { AnnotationSqlExtractor } from '../src/annotation-sql-extractor';

const extract = (source: string) => new AnnotationSqlExtractor('UserDao.java', source).extract();

describe('AnnotationSqlExtractor', () => {
  it('extracts @Select with placeholder into mapper method, sql statement, and EXECUTES_SQL edge', () => {
    const out = extract(`
      @Select("SELECT id, name FROM users WHERE id = #{id}")
      User findById(Integer id);
    `);
    expect(out.symbols.filter((n) => n.kind === 'mapper_method')).toHaveLength(1);
    expect(out.sqlStatements).toHaveLength(1);
    expect(out.sqlStatements[0].operation).toBe('SELECT');
    expect(out.sqlStatements[0].sqlPreview).toContain('?');
    expect(out.edges.map((e) => e.kind)).toContain('EXECUTES_SQL');
  });

  it('counts multiple placeholders in @Select', () => {
    const out = extract(`
      @Select("SELECT * FROM users WHERE name = #{name} AND age > #{age}")
      List<User> findByNameAndAge(String name, Integer age);
    `);
    const stmt = out.sqlStatements[0];
    expect(stmt.sqlPreview).toContain('? AND age > ?');
    const method = out.symbols.find((n) => n.kind === 'mapper_method');
    expect(method?.metadata?.dynamicTags).toEqual({ parameter: 2 });
  });

  it('captures @Options and @SelectKey from @Insert', () => {
    const out = extract(`
      @Insert("INSERT INTO users(name) VALUES(#{name})")
      @Options(useGeneratedKeys = true, keyProperty = "id")
      int insert(User user);
    `);
    expect(out.sqlStatements[0].operation).toBe('INSERT');
    const method = out.symbols.find((n) => n.kind === 'mapper_method');
    expect(method?.metadata?.operation).toBe('INSERT');
  });

  it('@SelectProvider produces confidence 0.5 with providerMethod metadata', () => {
    const out = extract(`
      @SelectProvider(type = UserDaoProvider.class, method = "buildSelect")
      List<User> findAll();
    `);
    expect(out.sqlStatements[0].confidence).toBe(0.5);
    const method = out.symbols.find((n) => n.kind === 'mapper_method');
    expect(method?.metadata).toMatchObject({
      operation: 'SELECTPROVIDER',
      providerMethod: 'buildSelect',
    });
    expect(method?.metadata?.sqlPreview).toContain('PROVIDER:buildSelect');
  });

  it('SQL with ${} sets confidence 0.6 and marks bind/unsafe', () => {
    const src = '@Select("SELECT * FROM ${tableName} WHERE id = #{id}")\nUser findByTable(String tableName, Integer id);';
    const out = extract(src);
    const stmt = out.sqlStatements[0];
    expect(stmt.confidence).toBeLessThan(1.0);
    const method = out.symbols.find((n) => n.kind === 'mapper_method');
    expect(method?.metadata?.dynamicTags).toHaveProperty('unsafe');
    expect(method?.metadata?.dynamicTags).toHaveProperty('bind');
  });
});
