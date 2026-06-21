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

describe('Java interface implementation dispatch', () => {
  let tmpDir: string | undefined;
  let cg: CodeGraph | undefined;
  afterEach(async () => {
    await safeCloseCodeGraph(cg);
    cg = undefined;
    await removeDirWithRetries(tmpDir);
    tmpDir = undefined;
  });

  it('synthesizes overrides edges from interface method to single implementation', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-java-iface-'));
    const javaDir = path.join(tmpDir, 'src/main/java/com/example');
    fs.mkdirSync(javaDir, { recursive: true });
    fs.writeFileSync(
      path.join(javaDir, 'Greeter.java'),
      'package com.example;\n' +
        'public interface Greeter {\n' +
        '  String greet(String name);\n' +
        '}\n'
    );
    fs.writeFileSync(
      path.join(javaDir, 'GreeterImpl.java'),
      'package com.example;\n' +
        'public class GreeterImpl implements Greeter {\n' +
        '  public String greet(String name) { return "hello " + name; }\n' +
        '}\n'
    );

    cg = CodeGraph.initSync(tmpDir);
    await cg.indexAll();

    const methods = cg.getNodesByKind('method').filter((n) => n.name === 'greet');
    expect(methods.length).toBe(2);
    const ifaceMethod = methods.find((n) => n.filePath.endsWith('Greeter.java'));
    const implMethod = methods.find((n) => n.filePath.endsWith('GreeterImpl.java'));
    expect(ifaceMethod).toBeDefined();
    expect(implMethod).toBeDefined();

    const edge = cg.getOutgoingEdges(ifaceMethod!.id).find(
      (e) => e.target === implMethod!.id && e.kind === 'overrides'
    );
    expect(edge).toBeDefined();
    expect(edge!.metadata?.synthesizedBy).toBe('java-interface-impl-dispatch');
    expect(edge!.metadata?.confidence).toBeGreaterThanOrEqual(0.9);
    expect(edge!.metadata?.ambiguous).toBe(false);
  });

  it('emits ambiguous overrides edges when multiple implementations exist', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-java-iface-multi-'));
    const javaDir = path.join(tmpDir, 'src/main/java/com/example');
    fs.mkdirSync(javaDir, { recursive: true });
    fs.writeFileSync(
      path.join(javaDir, 'Formatter.java'),
      'package com.example;\n' +
        'public interface Formatter {\n' +
        '  String format(String input);\n' +
        '}\n'
    );
    fs.writeFileSync(
      path.join(javaDir, 'UpperFormatter.java'),
      'package com.example;\n' +
        'public class UpperFormatter implements Formatter {\n' +
        '  public String format(String input) { return input.toUpperCase(); }\n' +
        '}\n'
    );
    fs.writeFileSync(
      path.join(javaDir, 'LowerFormatter.java'),
      'package com.example;\n' +
        'public class LowerFormatter implements Formatter {\n' +
        '  public String format(String input) { return input.toLowerCase(); }\n' +
        '}\n'
    );

    cg = CodeGraph.initSync(tmpDir);
    await cg.indexAll();

    const ifaceMethod = cg.getNodesByKind('method').find(
      (n) => n.name === 'format' && n.filePath.endsWith('Formatter.java')
    );
    expect(ifaceMethod).toBeDefined();

    const edges = cg.getOutgoingEdges(ifaceMethod!.id).filter(
      (e) => e.kind === 'overrides' && e.metadata?.synthesizedBy === 'java-interface-impl-dispatch'
    );
    expect(edges.length).toBe(2);
    for (const edge of edges) {
      expect(edge.metadata?.ambiguous).toBe(true);
      expect(edge.metadata?.confidence).toBeLessThanOrEqual(0.5);
    }
  });

  it('disambiguates overloaded interface methods by arity', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-java-iface-overload-'));
    const javaDir = path.join(tmpDir, 'src/main/java/com/example');
    fs.mkdirSync(javaDir, { recursive: true });
    fs.writeFileSync(
      path.join(javaDir, 'Calculator.java'),
      'package com.example;\n' +
        'public interface Calculator {\n' +
        '  int add(int a);\n' +
        '  int add(int a, int b);\n' +
        '}\n'
    );
    fs.writeFileSync(
      path.join(javaDir, 'CalculatorImpl.java'),
      'package com.example;\n' +
        'public class CalculatorImpl implements Calculator {\n' +
        '  public int add(int a) { return a; }\n' +
        '  public int add(int a, int b) { return a + b; }\n' +
        '}\n'
    );

    cg = CodeGraph.initSync(tmpDir);
    await cg.indexAll();

    const ifaceMethods = cg.getNodesByKind('method').filter(
      (n) => n.name === 'add' && n.filePath.endsWith('Calculator.java')
    );
    expect(ifaceMethods.length).toBe(2);

    for (const ifaceMethod of ifaceMethods) {
      const edges = cg.getOutgoingEdges(ifaceMethod.id).filter(
        (e) => e.kind === 'overrides' && e.metadata?.synthesizedBy === 'java-interface-impl-dispatch'
      );
      expect(edges.length).toBe(1);
      const implMethod = cg.getNode(edges[0]!.target);
      expect(implMethod).toBeDefined();
      expect(implMethod!.signature).toBe(ifaceMethod.signature);
    }
  });
});
