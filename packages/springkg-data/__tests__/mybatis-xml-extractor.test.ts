import { describe, expect, it } from 'vitest';

import { MyBatisXmlExtractor } from '../src/mybatis-xml-extractor';

const extract = (source: string) => new MyBatisXmlExtractor('UserMapper.xml', source).extract();

describe('MyBatisXmlExtractor', () => {
  it('extracts simple SELECT into mapper method, sql statement, and EXECUTES_SQL edge', () => {
    const out = extract('<mapper namespace="demo.UserMapper"><select id="findAll">SELECT id FROM users</select></mapper>');
    expect(out.symbols.filter((node) => node.kind === 'mapper_method')).toHaveLength(1);
    expect(out.symbols.filter((node) => node.kind === 'sql_statement')).toHaveLength(1);
    expect(out.edges.map((edge) => edge.kind)).toEqual(['EXECUTES_SQL']);
  });

  it('expands include fragments and creates a BIND_TO edge', () => {
    const out = extract('<mapper namespace="demo.UserMapper"><sql id="baseCols">id, name</sql><select id="findAll">SELECT <include refid="baseCols"/> FROM users</select></mapper>');
    const stmt = out.symbols.find((node) => node.kind === 'sql_statement');
    expect(stmt?.metadata?.sql_preview).toBe('SELECT id, name FROM users');
    expect(out.edges.some((edge) => edge.kind === 'BIND_TO')).toBe(true);
  });

  it('tracks nested dynamic tags and lowers confidence for foreach', () => {
    const out = extract('<mapper namespace="demo.UserMapper"><select id="findByIds"><where><if test="ids != null">id in <foreach collection="ids" item="id" open="(" separator="," close=")">#{id}</foreach></if></where></select></mapper>');
    const method = out.symbols.find((node) => node.kind === 'mapper_method');
    expect(method?.metadata?.dynamicTags).toEqual({ where: 2, if: 2, foreach: 2 });
    expect(method?.confidence).toBe(0.6);
  });

  it('captures resultMap association rows in metadata', () => {
    const out = extract('<mapper namespace="demo.UserMapper"><resultMap id="userMap" type="User"><id property="id" column="user_id" jdbcType="BIGINT"/><association property="dept" column="dept_id" jdbcType="BIGINT"/></resultMap></mapper>');
    const resultMap = out.symbols.find((node) => node.metadata?.operation === 'RESULT_MAP');
    expect(resultMap?.metadata?.resultMap).toEqual([
      { property: 'id', column: 'user_id', jdbcType: 'BIGINT' },
      { property: 'dept', column: 'dept_id', jdbcType: 'BIGINT' },
    ]);
  });

  it('detects fragment include cycles and marks metadata.dynamic_cycle', () => {
    const out = extract('<mapper namespace="demo.UserMapper"><sql id="A"><include refid="B"/></sql><sql id="B"><include refid="A"/></sql><select id="findAll">SELECT <include refid="A"/> FROM users</select></mapper>');
    const method = out.symbols.find((node) => node.kind === 'mapper_method' && node.name === 'findAll');
    expect(method?.metadata?.dynamic_cycle).toBe(true);
    expect(method?.confidence).toBe(0.7);
  });
});
