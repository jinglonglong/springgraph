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

/**
 * Regression for Java/JVM polymorphic dispatch in getCallers/getCallees.
 * Queries on either side of a supertype-method ↔ implementation-method pair
 * should return the union of static callers/callees across the dispatch group.
 */
describe('getCallers / getCallees follow JVM dispatch', () => {
  let tmpDir: string | undefined;
  let cg: CodeGraph | undefined;
  afterEach(async () => {
    await safeCloseCodeGraph(cg);
    cg = undefined;
    await removeDirWithRetries(tmpDir);
    tmpDir = undefined;
  });

  function writeJava(dir: string, name: string, body: string): void {
    fs.writeFileSync(path.join(dir, name), body);
  }

  function findMethod(name: string, file: string): ReturnType<CodeGraph['getNodesByKind']>[number] | undefined {
    return cg!
      .getNodesByKind('method')
      .find((n) => n.name === name && n.filePath.endsWith(file));
  }

  it('impl method surfaces callers from the interface (cross-class via dispatch)', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-dispatch-callers-impl-'));
    const dir = path.join(tmpDir, 'src/main/java/com/example');
    fs.mkdirSync(dir, { recursive: true });

    writeJava(
      dir,
      'UserService.java',
      'package com.example;\n' +
        'public interface UserService {\n' +
        '  String findById(Long id);\n' +
        '}\n'
    );
    writeJava(
      dir,
      'UserServiceImpl.java',
      'package com.example;\n' +
        'public class UserServiceImpl implements UserService {\n' +
        // Internal cross-method call inside the impl — the *only* same-file
        // caller before the dispatch fix.
        '  public String findById(Long id) { return lookup(id); }\n' +
        '  private String lookup(Long id) { return String.valueOf(id); }\n' +
        '}\n'
    );
    writeJava(
      dir,
      'UserController.java',
      'package com.example;\n' +
        'public class UserController {\n' +
        // The interface call site — invisible to getCallers(impl) before the
        // dispatch fix.
        '  private final UserService service;\n' +
        '  public String get(Long id) { return service.findById(id); }\n' +
        '}\n'
    );

    cg = CodeGraph.initSync(tmpDir);
    await cg.indexAll();

    const implMethod = findMethod('findById', 'UserServiceImpl.java');
    const ifaceMethod = findMethod('findById', 'UserService.java');
    const controllerCaller = findMethod('get', 'UserController.java');
    expect(implMethod).toBeDefined();
    expect(ifaceMethod).toBeDefined();
    expect(controllerCaller).toBeDefined();

    const implCallers = cg.getCallers(implMethod!.id);
    const implCallerIds = new Set(implCallers.map((c) => c.node.id));
    expect(implCallerIds.has(controllerCaller!.id)).toBe(true);

    const ifaceCallers = cg.getCallers(ifaceMethod!.id);
    const ifaceCallerIds = new Set(ifaceCallers.map((c) => c.node.id));
    expect(ifaceCallerIds.has(controllerCaller!.id)).toBe(true);
  });

  it('callees of an interface method include the impls own downstream calls', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-dispatch-callees-'));
    const dir = path.join(tmpDir, 'src/main/java/com/example');
    fs.mkdirSync(dir, { recursive: true });

    writeJava(
      dir,
      'Repo.java',
      'package com.example;\n' +
        'public interface Repo {\n' +
        '  String load(Long id);\n' +
        '}\n'
    );
    writeJava(
      dir,
      'RepoImpl.java',
      'package com.example;\n' +
        'public class RepoImpl implements Repo {\n' +
        '  public String load(Long id) { return transform(id); }\n' +
        '  private String transform(Long id) { return String.valueOf(id); }\n' +
        '}\n'
    );

    cg = CodeGraph.initSync(tmpDir);
    await cg.indexAll();

    const ifaceMethod = findMethod('load', 'Repo.java');
    const implMethod = findMethod('load', 'RepoImpl.java');
    const transform = findMethod('transform', 'RepoImpl.java');
    expect(ifaceMethod).toBeDefined();
    expect(implMethod).toBeDefined();
    expect(transform).toBeDefined();

    const callees = cg.getCallees(ifaceMethod!.id);
    const calleeIds = new Set(callees.map((c) => c.node.id));
    expect(calleeIds.has(transform!.id)).toBe(true);
  });

  it('super.method() inside an override links back to the inherited implementation', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-super-call-extends-'));
    const dir = path.join(tmpDir, 'src/main/java/com/example');
    fs.mkdirSync(dir, { recursive: true });

    writeJava(
      dir,
      'BaseRequest.java',
      'package com.example;\n' +
        'public abstract class BaseRequest {\n' +
        '  private String identifier;\n' +
        '  public void setMethod(String identifier) { this.identifier = identifier; }\n' +
        '}\n'
    );
    writeJava(
      dir,
      'ServiceRequest.java',
      'package com.example;\n' +
        'public class ServiceRequest extends BaseRequest {\n' +
        '  public void setMethod(String method) { super.setMethod(method); }\n' +
        '}\n'
    );
    writeJava(
      dir,
      'Client.java',
      'package com.example;\n' +
        'public class Client {\n' +
        '  private final ServiceRequest req = new ServiceRequest();\n' +
        '  public void run() { req.setMethod("x"); }\n' +
        '}\n'
    );

    cg = CodeGraph.initSync(tmpDir);
    await cg.indexAll();

    const baseMethod = findMethod('setMethod', 'BaseRequest.java');
    const subclassMethod = findMethod('setMethod', 'ServiceRequest.java');
    expect(baseMethod).toBeDefined();
    expect(subclassMethod).toBeDefined();

    // The override body calls super.setMethod(...), so subclass callees must
    // include the inherited implementation.
    const subclassCallees = cg.getCallees(subclassMethod!.id);
    const subclassCalleeIds = new Set(subclassCallees.map((c) => c.node.id));
    expect(subclassCalleeIds.has(baseMethod!.id)).toBe(true);

    // Conversely, callers of the base method should aggregate callers of the
    // override through the dispatch group, and the override itself (which
    // contains the super.setMethod(...) call) should appear as a caller of the
    // base method.
    const baseCallers = cg.getCallers(baseMethod!.id);
    const baseCallerIds = new Set(baseCallers.map((c) => c.node.id));
    const subclassCallers = cg.getCallers(subclassMethod!.id);
    const subclassCallerIds = new Set(subclassCallers.map((c) => c.node.id));
    const clientRun = findMethod('run', 'Client.java');
    expect(clientRun).toBeDefined();
    expect(baseCallerIds.has(clientRun!.id)).toBe(true);
    expect(baseCallerIds.has(subclassMethod!.id)).toBe(true);
    expect(subclassCallerIds.has(clientRun!.id)).toBe(true);
    expect(subclassCallerIds.has(subclassMethod!.id)).toBe(false);
  });
});
