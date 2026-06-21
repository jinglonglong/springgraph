import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CodeGraph } from '../src';
import { initGrammars, loadAllGrammars } from '../src/extraction/grammars';
import { removeDirWithRetries, safeCloseCodeGraph } from './setup';

beforeAll(async () => {
  await initGrammars();
  await loadAllGrammars();
});

describe('Java field impact synthesizer', () => {
  let tmpDir: string | undefined;
  let cg: CodeGraph | undefined;
  afterEach(async () => {
    await safeCloseCodeGraph(cg);
    cg = undefined;
    await removeDirWithRetries(tmpDir);
    tmpDir = undefined;
  });

  it('emits fieldRef references edges for direct field access', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-java-field-'));
    const javaDir = path.join(tmpDir, 'src/main/java/com/example');
    fs.mkdirSync(javaDir, { recursive: true });
    fs.writeFileSync(
      path.join(javaDir, 'Account.java'),
      'package com.example;\n' +
        'public class Account {\n' +
        '  private String owner;\n' +
        '  public void touch() {\n' +
        '    System.out.println(this.owner);\n' +
        '  }\n' +
        '}\n'
    );

    cg = CodeGraph.initSync(tmpDir);
    await cg.indexAll();

    const method = cg.getNodesByKind('method').find((n) => n.name === 'touch');
    const field = cg.getNodesByKind('field').find((n) => n.name === 'owner');
    expect(method).toBeDefined();
    expect(field).toBeDefined();

    const edge = cg.getOutgoingEdges(method!.id).find(
      (e) => e.target === field!.id && e.kind === 'references'
    );
    expect(edge).toBeDefined();
    expect(edge!.metadata?.fieldRef).toBe(true);
    expect(edge!.metadata?.synthesizedBy).toBe('java-field-impact');
  });

  it('links getter and setter calls to backing fields', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-java-getter-'));
    const javaDir = path.join(tmpDir, 'src/main/java/com/example');
    fs.mkdirSync(javaDir, { recursive: true });
    fs.writeFileSync(
      path.join(javaDir, 'Person.java'),
      'package com.example;\n' +
        'public class Person {\n' +
        '  private String name;\n' +
        '  public String getName() { return name; }\n' +
        '  public void setName(String name) { this.name = name; }\n' +
        '}\n'
    );
    fs.writeFileSync(
      path.join(javaDir, 'PersonService.java'),
      'package com.example;\n' +
        'public class PersonService {\n' +
        '  public void update(Person p) {\n' +
        '    String n = p.getName();\n' +
        '    p.setName(n.toUpperCase());\n' +
        '  }\n' +
        '}\n'
    );

    cg = CodeGraph.initSync(tmpDir);
    await cg.indexAll();

    const updateMethod = cg.getNodesByKind('method').find((n) => n.name === 'update');
    const nameField = cg.getNodesByKind('field').find((n) => n.name === 'name');
    expect(updateMethod).toBeDefined();
    expect(nameField).toBeDefined();

    const edges = cg.getOutgoingEdges(updateMethod!.id).filter(
      (e) => e.target === nameField!.id && e.kind === 'references' && e.metadata?.synthesizedBy === 'java-field-impact'
    );
    expect(edges.length).toBeGreaterThanOrEqual(1);

  });

  it('links Lombok accessor calls to backing fields without materializing method nodes', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-java-lombok-field-'));
    const javaDir = path.join(tmpDir, 'src/main/java/com/example');
    fs.mkdirSync(javaDir, { recursive: true });
    fs.writeFileSync(
      path.join(javaDir, 'Book.java'),
      'package com.example;\n' +
        '@lombok.Data\n' +
        'public class Book {\n' +
        '  private String title;\n' +
        '}\n'
    );
    fs.writeFileSync(
      path.join(javaDir, 'BookService.java'),
      'package com.example;\n' +
        'public class BookService {\n' +
        '  public void print(Book b) {\n' +
        '    System.out.println(b.getTitle());\n' +
        '  }\n' +
        '}\n'
    );

    cg = CodeGraph.initSync(tmpDir);
    await cg.indexAll();

    const printMethod = cg.getNodesByKind('method').find((n) => n.name === 'print');
    const titleField = cg.getNodesByKind('field').find((n) => n.name === 'title');
    expect(printMethod).toBeDefined();
    expect(titleField).toBeDefined();

    const edge = cg.getOutgoingEdges(printMethod!.id).find(
      (e) => e.target === titleField!.id && e.kind === 'references' && e.metadata?.via === 'lombok'
    );
    expect(edge).toBeDefined();

    // No synthetic getTitle method node should be created
    const syntheticGetter = cg.getNodesByKind('method').find((n) => n.name === 'getTitle'
    );
    expect(syntheticGetter).toBeUndefined();

  });

  it('links @JsonProperty logical name to the backing field', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-java-json-prop-'));
    const javaDir = path.join(tmpDir, 'src/main/java/com/example');
    fs.mkdirSync(javaDir, { recursive: true });
    fs.writeFileSync(
      path.join(javaDir, 'Customer.java'),
      'package com.example;\n' +
        'public class Customer {\n' +
        '  @com.fasterxml.jackson.annotation.JsonProperty("customer_name")\n' +
        '  private String customerName;\n' +
        '  public String getCustomerName() { return customerName; }\n' +
        '}\n'
    );

    cg = CodeGraph.initSync(tmpDir);
    await cg.indexAll();

    const method = cg.getNodesByKind('method').find((n) => n.name === 'getCustomerName');
    const field = cg.getNodesByKind('field').find((n) => n.name === 'customerName');
    expect(method).toBeDefined();
    expect(field).toBeDefined();

    const edge = cg.getOutgoingEdges(method!.id).find(
      (e) => e.target === field!.id && e.kind === 'references' && e.metadata?.via === 'jsonProperty'
    );
    expect(edge).toBeDefined();

  });

  it('emits field-impact edges for MapStruct @Mapping source/target pairs', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-java-mapstruct-'));
    const javaDir = path.join(tmpDir, 'src/main/java/com/example');
    fs.mkdirSync(javaDir, { recursive: true });
    fs.writeFileSync(
      path.join(javaDir, 'UserEntity.java'),
      'package com.example;\n' +
        'public class UserEntity {\n' +
        '  private String userName;\n' +
        '  public String getUserName() { return userName; }\n' +
        '  public void setUserName(String userName) { this.userName = userName; }\n' +
        '}\n'
    );
    fs.writeFileSync(
      path.join(javaDir, 'UserDto.java'),
      'package com.example;\n' +
        'public class UserDto {\n' +
        '  private String displayName;\n' +
        '  public String getDisplayName() { return displayName; }\n' +
        '  public void setDisplayName(String displayName) { this.displayName = displayName; }\n' +
        '}\n'
    );
    fs.writeFileSync(
      path.join(javaDir, 'UserMapper.java'),
      'package com.example;\n' +
        '@org.mapstruct.Mapper\n' +
        'public interface UserMapper {\n' +
        '  @org.mapstruct.Mapping(source = "userName", target = "displayName")\n' +
        '  com.example.UserDto toDto(com.example.UserEntity entity);\n' +
        '}\n'
    );

    cg = CodeGraph.initSync(tmpDir);
    await cg.indexAll();

    const mapMethod = cg.getNodesByKind('method').find((n) => n.name === 'toDto'
    );
    const sourceField = cg.getNodesByKind('field').find((n) => n.name === 'userName');
    const targetField = cg.getNodesByKind('field').find((n) => n.name === 'displayName');
    expect(mapMethod).toBeDefined();
    expect(sourceField).toBeDefined();
    expect(targetField).toBeDefined();

    const edges = cg.getOutgoingEdges(mapMethod!.id).filter(
      (e) => e.kind === 'references' && e.metadata?.via === 'mapstruct'
    );
    expect(edges.length).toBeGreaterThanOrEqual(2);
    expect(edges.some((e) => e.target === sourceField!.id)).toBe(true);
    expect(edges.some((e) => e.target === targetField!.id)).toBe(true);

  });
});
