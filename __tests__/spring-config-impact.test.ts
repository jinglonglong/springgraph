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

describe('Spring config impact synthesizer', () => {
  let tmpDir: string | undefined;
  let cg: CodeGraph | undefined;
  afterEach(async () => {
    await safeCloseCodeGraph(cg);
    cg = undefined;
    await removeDirWithRetries(tmpDir);
    tmpDir = undefined;
  });

  it('emits config edges from @Value to YAML key', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-spring-config-yaml-'));
    const javaDir = path.join(tmpDir, 'src/main/java/com/example');
    const resDir = path.join(tmpDir, 'src/main/resources');
    fs.mkdirSync(javaDir, { recursive: true });
    fs.mkdirSync(resDir, { recursive: true });

    fs.writeFileSync(
      path.join(resDir, 'application.yml'),
      'service:\n  timeout: 5000\n'
    );
    fs.writeFileSync(
      path.join(javaDir, 'AppConfig.java'),
      'package com.example;\n' +
        '@org.springframework.stereotype.Component\n' +
        'public class AppConfig {\n' +
        '  @org.springframework.beans.factory.annotation.Value("${service.timeout}")\n' +
        '  private long timeout;\n' +
        '}\n'
    );

    cg = CodeGraph.initSync(tmpDir);
    await cg.indexAll();

    const field = cg.getNodesByKind('field').find((n) => n.name === 'timeout'
    );
    const keyNode = cg.getNodesByKind('constant').find(
      (n) => n.qualifiedName === 'service.timeout' && n.filePath.endsWith('application.yml')
    );
    expect(field).toBeDefined();
    expect(keyNode).toBeDefined();

    const edge = cg.getOutgoingEdges(field!.id).find(
      (e) => e.target === keyNode!.id && e.kind === 'references'
    );
    expect(edge).toBeDefined();
    expect(edge!.metadata?.synthesizedBy).toBe('spring-config-impact');
    expect(edge!.metadata?.binding).toBe('@Value');

  });

  it('emits config edges from @Value to .properties key', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-spring-config-props-'));
    const javaDir = path.join(tmpDir, 'src/main/java/com/example');
    const resDir = path.join(tmpDir, 'src/main/resources');
    fs.mkdirSync(javaDir, { recursive: true });
    fs.mkdirSync(resDir, { recursive: true });

    fs.writeFileSync(
      path.join(resDir, 'application.properties'),
      'service.timeout=5000\n'
    );
    fs.writeFileSync(
      path.join(javaDir, 'AppConfig.java'),
      'package com.example;\n' +
        '@org.springframework.stereotype.Component\n' +
        'public class AppConfig {\n' +
        '  @org.springframework.beans.factory.annotation.Value("${service.timeout}")\n' +
        '  private long timeout;\n' +
        '}\n'
    );

    cg = CodeGraph.initSync(tmpDir);
    await cg.indexAll();

    const field = cg.getNodesByKind('field').find((n) => n.name === 'timeout'
    );
    const keyNode = cg.getNodesByKind('constant').find(
      (n) => n.qualifiedName === 'service.timeout' && n.filePath.endsWith('application.properties')
    );
    expect(field).toBeDefined();
    expect(keyNode).toBeDefined();

    const edge = cg.getOutgoingEdges(field!.id).find(
      (e) => e.target === keyNode!.id && e.kind === 'references'
    );
    expect(edge).toBeDefined();

  });

  it('emits config edges from @ConfigurationProperties prefix + field name', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-spring-config-props-'));
    const javaDir = path.join(tmpDir, 'src/main/java/com/example');
    const resDir = path.join(tmpDir, 'src/main/resources');
    fs.mkdirSync(javaDir, { recursive: true });
    fs.mkdirSync(resDir, { recursive: true });

    fs.writeFileSync(
      path.join(resDir, 'application.yml'),
      'demo:\n  client:\n    timeout: 3000\n    retries: 5\n'
    );
    fs.writeFileSync(
      path.join(javaDir, 'ClientProperties.java'),
      'package com.example;\n' +
        '@org.springframework.boot.context.properties.ConfigurationProperties(prefix = "demo.client")\n' +
        'public class ClientProperties {\n' +
        '  private long timeout;\n' +
        '  private int retries;\n' +
        '}\n'
    );

    cg = CodeGraph.initSync(tmpDir);
    await cg.indexAll();

    const fields = cg.getNodesByKind('field').filter(
      (n) => n.name === 'timeout' || n.name === 'retries'
    );
    expect(fields.length).toBe(2);

    for (const field of fields) {
      const key = `demo.client.${field.name}`;
      const keyNode = cg.getNodesByKind('constant').find(
        (n) => n.qualifiedName === key && n.filePath.endsWith('application.yml')
      );
      expect(keyNode).toBeDefined();
      const edge = cg.getOutgoingEdges(field.id).find(
        (e) => e.target === keyNode!.id && e.kind === 'references'
      );
      expect(edge).toBeDefined();
      expect(edge!.metadata?.binding).toBe('@ConfigurationProperties');
    }

  });

  it('reports missing keys as warnings without throwing', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-spring-config-missing-'));
    const javaDir = path.join(tmpDir, 'src/main/java/com/example');
    fs.mkdirSync(javaDir, { recursive: true });

    fs.writeFileSync(
      path.join(javaDir, 'AppConfig.java'),
      'package com.example;\n' +
        '@org.springframework.stereotype.Component\n' +
        'public class AppConfig {\n' +
        '  @org.springframework.beans.factory.annotation.Value("${unknown.key}")\n' +
        '  private long timeout;\n' +
        '}\n'
    );

    cg = CodeGraph.initSync(tmpDir);
    await cg.indexAll();

    const field = cg.getNodesByKind('field').find((n) => n.name === 'timeout'
    );
    expect(field).toBeDefined();
    const edges = cg.getOutgoingEdges(field!.id).filter(
      (e) => e.kind === 'references' && e.metadata?.synthesizedBy === 'spring-config-impact'
    );
    expect(edges.length).toBe(0);

  });
});
