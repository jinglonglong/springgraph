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

describe('Spring bean wiring synthesizer', () => {
  let tmpDir: string | undefined;
  let cg: CodeGraph | undefined;
  afterEach(async () => {
    await safeCloseCodeGraph(cg);
    cg = undefined;
    await removeDirWithRetries(tmpDir);
    tmpDir = undefined;
  });

  it('emits references edges for @Autowired and @Resource field injection', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-spring-bean-'));
    const javaDir = path.join(tmpDir, 'src/main/java/com/example');
    fs.mkdirSync(javaDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'pom.xml'),
      '<project><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter</artifactId></dependency></dependencies></project>\n'
    );
    fs.writeFileSync(
      path.join(javaDir, 'UserService.java'),
      'package com.example;\n' +
        '@org.springframework.stereotype.Service\n' +
        'public class UserService {\n' +
        '  public void findUser() {}\n' +
        '}\n'
    );
    fs.writeFileSync(
      path.join(javaDir, 'UserController.java'),
      'package com.example;\n' +
        '@org.springframework.stereotype.Controller\n' +
        'public class UserController {\n' +
        '  @org.springframework.beans.factory.annotation.Autowired\n' +
        '  private UserService userService;\n' +
        '  @javax.annotation.Resource(name = "userService")\n' +
        '  private UserService userService2;\n' +
        '}\n'
    );

    cg = CodeGraph.initSync(tmpDir);
    await cg.indexAll();

    const classes = cg.getNodesByKind('class');
    const controller = classes.find((n) => n.name === 'UserController');
    const service = classes.find((n) => n.name === 'UserService');
    expect(controller).toBeDefined();
    expect(service).toBeDefined();

    const edges = cg.getOutgoingEdges(controller!.id).filter((e) => e.kind === 'references');
    expect(edges.length).toBeGreaterThanOrEqual(1);
    expect(edges.some((e) => e.target === service!.id)).toBe(true);
    for (const edge of edges) {
      expect(edge.provenance).toBe('heuristic');
      expect(edge.metadata?.synthesizedBy).toBe('spring-bean-wiring');
      expect(['field', 'constructor']).toContain(edge.metadata?.injection);
    }
  });

  it('treats @RequiredArgsConstructor + final field as constructor injection', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-spring-lombok-'));
    const javaDir = path.join(tmpDir, 'src/main/java/com/example');
    fs.mkdirSync(javaDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'pom.xml'),
      '<project><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter</artifactId></dependency></dependencies></project>\n'
    );
    fs.writeFileSync(
      path.join(javaDir, 'OrderService.java'),
      'package com.example;\n' +
        '@org.springframework.stereotype.Service\n' +
        'public class OrderService {\n' +
        '  public void createOrder() {}\n' +
        '}\n'
    );
    fs.writeFileSync(
      path.join(javaDir, 'OrderController.java'),
      'package com.example;\n' +
        '@org.springframework.stereotype.Controller\n' +
        '@lombok.RequiredArgsConstructor\n' +
        'public class OrderController {\n' +
        '  private final OrderService orderService;\n' +
        '}\n'
    );

    cg = CodeGraph.initSync(tmpDir);
    await cg.indexAll();

    const classes = cg.getNodesByKind('class');
    const controller = classes.find((n) => n.name === 'OrderController');
    const service = classes.find((n) => n.name === 'OrderService');
    expect(controller).toBeDefined();
    expect(service).toBeDefined();

    const edge = cg.getOutgoingEdges(controller!.id).find(
      (e) => e.target === service!.id && e.kind === 'references'
    );
    expect(edge).toBeDefined();
    expect(edge!.metadata?.injection).toBe('constructor');
    expect(edge!.metadata?.synthesizedBy).toBe('spring-bean-wiring');
  });

  it('does not emit a definitive edge for ambiguous multi-implementation wiring', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-spring-ambiguous-'));
    const javaDir = path.join(tmpDir, 'src/main/java/com/example');
    fs.mkdirSync(javaDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'pom.xml'),
      '<project><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter</artifactId></dependency></dependencies></project>\n'
    );
    fs.writeFileSync(
      path.join(javaDir, 'UserRepository.java'),
      'package com.example;\n' +
        'public interface UserRepository {\n' +
        '  void save();\n' +
        '}\n'
    );
    fs.writeFileSync(
      path.join(javaDir, 'JdbcUserRepository.java'),
      'package com.example;\n' +
        '@org.springframework.stereotype.Repository\n' +
        'public class JdbcUserRepository implements UserRepository {\n' +
        '  public void save() {}\n' +
        '}\n'
    );
    fs.writeFileSync(
      path.join(javaDir, 'MongoUserRepository.java'),
      'package com.example;\n' +
        '@org.springframework.stereotype.Repository\n' +
        'public class MongoUserRepository implements UserRepository {\n' +
        '  public void save() {}\n' +
        '}\n'
    );
    fs.writeFileSync(
      path.join(javaDir, 'UserService.java'),
      'package com.example;\n' +
        '@org.springframework.stereotype.Service\n' +
        'public class UserService {\n' +
        '  @org.springframework.beans.factory.annotation.Autowired\n' +
        '  private UserRepository repository;\n' +
        '}\n'
    );

    cg = CodeGraph.initSync(tmpDir);
    await cg.indexAll();

    const classes = cg.getNodesByKind('class');
    const service = classes.find((n) => n.name === 'UserService');
    expect(service).toBeDefined();

    const edges = cg.getOutgoingEdges(service!.id).filter(
      (e) => e.kind === 'references' && e.metadata?.synthesizedBy === 'spring-bean-wiring'
    );
    expect(edges.length).toBe(0);
  });
});
