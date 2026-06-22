import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Springgraph } from '../src';
import { initGrammars, loadAllGrammars } from '../src/extraction/grammars';
import { removeDirWithRetries, safeCloseSpringgraph } from './setup';

beforeAll(async () => {
  await initGrammars();
  await loadAllGrammars();
});

describe('MyBatis XML impact synthesizer', () => {
  let tmpDir: string | undefined;
  let cg: Springgraph | undefined;
  afterEach(async () => {
    await safeCloseSpringgraph(cg);
    cg = undefined;
    await removeDirWithRetries(tmpDir);
    tmpDir = undefined;
  });

  it('links Java Mapper method to XML statement by namespace and id', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-mybatis-'));
    const javaDir = path.join(tmpDir, 'src/main/java/com/example');
    const mapperDir = path.join(tmpDir, 'src/main/resources/mapper');
    fs.mkdirSync(javaDir, { recursive: true });
    fs.mkdirSync(mapperDir, { recursive: true });

    fs.writeFileSync(
      path.join(javaDir, 'UserMapper.java'),
      'package com.example;\n' +
        'import org.apache.ibatis.annotations.Mapper;\n' +
        '@Mapper\n' +
        'public interface UserMapper {\n' +
        '  com.example.User selectById(Long id);\n' +
        '}\n'
    );
    fs.writeFileSync(
      path.join(javaDir, 'User.java'),
      'package com.example;\n' +
        'public class User {\n' +
        '  private Long id;\n' +
        '  private String userName;\n' +
        '  public Long getId() { return id; }\n' +
        '  public String getUserName() { return userName; }\n' +
        '}\n'
    );
    fs.writeFileSync(
      path.join(mapperDir, 'UserMapper.xml'),
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN" "http://mybatis.org/dtd/mybatis-3-mapper.dtd">\n' +
        '<mapper namespace="com.example.UserMapper">\n' +
        '  <select id="selectById" resultType="com.example.User">\n' +
        '    SELECT id, user_name FROM user_account WHERE id = #{id}\n' +
        '  </select>\n' +
        '</mapper>\n'
    );

    cg = Springgraph.initSync(tmpDir);
    await cg.indexAll();

    const javaMethod = cg.getNodesByKind('method').find(
      (n) => n.name === 'selectById' && n.filePath.endsWith('UserMapper.java')
    );
    const xmlMethod = cg.getNodesByKind('method').find(
      (n) => n.qualifiedName === 'com.example.UserMapper::selectById'
    );
    expect(javaMethod).toBeDefined();
    expect(xmlMethod).toBeDefined();

    const edge = cg.getOutgoingEdges(javaMethod!.id).find(
      (e) => e.target === xmlMethod!.id && e.kind === 'references'
    );
    expect(edge).toBeDefined();
    expect(edge!.metadata?.synthesizedBy).toBe('mybatis-xml-impact');
    expect(edge!.metadata?.linkType).toBe('mapper-method-to-xml-statement');
  });

  it('extracts table and column hints from XML SQL', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-mybatis-hints-'));
    const mapperDir = path.join(tmpDir, 'src/main/resources/mapper');
    fs.mkdirSync(mapperDir, { recursive: true });

    fs.writeFileSync(
      path.join(mapperDir, 'OrderMapper.xml'),
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<mapper namespace="com.example.OrderMapper">\n' +
        '  <select id="selectOrder" resultType="com.example.Order">\n' +
        '    SELECT order_id, status FROM order_table WHERE user_id = #{userId}\n' +
        '  </select>\n' +
        '</mapper>\n'
    );

    cg = Springgraph.initSync(tmpDir);
    await cg.indexAll();

    const xmlMethod = cg.getNodesByKind('method').find(
      (n) => n.qualifiedName === 'com.example.OrderMapper::selectOrder'
    );
    expect(xmlMethod).toBeDefined();
    expect(xmlMethod!.metadata?.tableHints).toContain('order_table');
    expect(xmlMethod!.metadata?.columnHints).toContain('order_id');
    expect(xmlMethod!.metadata?.columnHints).toContain('status');
    expect(xmlMethod!.metadata?.columnHints).toContain('user_id');
  });

  it('links XML column references to entity fields via naming convention', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-mybatis-col-'));
    const javaDir = path.join(tmpDir, 'src/main/java/com/example');
    const mapperDir = path.join(tmpDir, 'src/main/resources/mapper');
    fs.mkdirSync(javaDir, { recursive: true });
    fs.mkdirSync(mapperDir, { recursive: true });

    fs.writeFileSync(
      path.join(javaDir, 'User.java'),
      'package com.example;\n' +
        'public class User {\n' +
        '  private Long id;\n' +
        '  private String userName;\n' +
        '}\n'
    );
    fs.writeFileSync(
      path.join(javaDir, 'UserMapper.java'),
      'package com.example;\n' +
        'public interface UserMapper {\n' +
        '  com.example.User selectById(Long id);\n' +
        '}\n'
    );
    fs.writeFileSync(
      path.join(mapperDir, 'UserMapper.xml'),
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<mapper namespace="com.example.UserMapper">\n' +
        '  <select id="selectById" resultType="com.example.User">\n' +
        '    SELECT id, user_name FROM user_account WHERE id = #{id}\n' +
        '  </select>\n' +
        '</mapper>\n'
    );

    cg = Springgraph.initSync(tmpDir);
    await cg.indexAll();

    const xmlMethod = cg.getNodesByKind('method').find(
      (n) => n.qualifiedName === 'com.example.UserMapper::selectById'
    );
    const userNameField = cg.getNodesByKind('field').find(
      (n) => n.name === 'userName' && n.filePath.endsWith('User.java')
    );
    expect(xmlMethod).toBeDefined();
    expect(userNameField).toBeDefined();

    const edge = cg.getOutgoingEdges(xmlMethod!.id).find(
      (e) => e.target === userNameField!.id && e.kind === 'references'
    );
    expect(edge).toBeDefined();
    expect(edge!.metadata?.fieldRef).toBe(true);
    expect(edge!.metadata?.linkType).toBe('xml-column-to-entity-field');
  });
});
