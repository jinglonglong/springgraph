import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseConnection } from '../src/db';
import { QueryBuilder } from '../src/db/queries';
import { GraphTraverser } from '../src/graph/traversal';
import { ArchitectureTraceEngine } from '../src/architecture/trace';
import { ArchitectureImpactEngine } from '../src/architecture/impact';
import { Node, Edge } from '../src/types';
import * as path from 'path';
import * as fs from 'fs';

function makeNode(id: string, name: string, kind: Node['kind'], filePath: string, extra?: Partial<Node>): Node {
  return {
    id,
    name,
    kind,
    qualifiedName: `${filePath}::${name}`,
    filePath,
    language: 'java',
    startLine: 1,
    endLine: 10,
    startColumn: 0,
    endColumn: 0,
    updatedAt: Date.now(),
    ...extra,
  };
}

function makeEdge(source: string, target: string, kind: Edge['kind'], provenance?: Edge['provenance'], metadata?: Record<string, unknown>): Edge {
  return {
    source,
    target,
    kind,
    provenance,
    metadata,
  };
}

describe('ArchitectureTraceEngine', () => {
  let db: DatabaseConnection;
  let queries: QueryBuilder;
  let traverser: GraphTraverser;
  let engine: ArchitectureTraceEngine;
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = path.join(__dirname, '../temp-architecture-trace-test');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const springgraphDir = path.join(tempDir, '.springgraph');
    if (!fs.existsSync(springgraphDir)) {
      fs.mkdirSync(springgraphDir, { recursive: true });
    }
    dbPath = path.join(springgraphDir, 'springgraph.db');
    if (fs.existsSync(dbPath)) {
      try { fs.unlinkSync(dbPath); } catch {}
    }
    db = DatabaseConnection.initialize(dbPath);
    queries = new QueryBuilder(db.getDb());
    traverser = new GraphTraverser(queries);
    engine = new ArchitectureTraceEngine(traverser, queries);
  });

  afterEach(() => {
    if (db && db.isOpen()) db.close();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('returns a direct path with confidence and provenance for a controller-to-service trace', () => {
    const controller = makeNode('ctrl', 'UserController', 'class', 'UserController.java', {
      decorators: ['@RestController'],
    });
    const service = makeNode('svc', 'UserService', 'class', 'UserService.java', {
      decorators: ['@Service'],
    });
    const mapper = makeNode('mapper', 'UserMapper', 'interface', 'UserMapper.java', {
      decorators: ['@Mapper'],
    });

    queries.insertNodes([controller, service, mapper]);
    queries.insertEdges([
      makeEdge('ctrl', 'svc', 'calls', 'tree-sitter'),
      makeEdge('svc', 'mapper', 'calls', 'tree-sitter'),
    ]);

    const result = engine.trace({ from: 'ctrl', to: 'mapper' });

    expect(result.notFound).toBe(false);
    expect(result.paths).toHaveLength(1);
    const path = result.paths[0]!;
    expect(path.hops).toHaveLength(3);
    expect(path.hops[0]!.node.id).toBe('ctrl');
    expect(path.hops[1]!.node.id).toBe('svc');
    expect(path.hops[2]!.node.id).toBe('mapper');
    expect(path.hops[1]!.confidence).toBe(1.0);
    expect(path.hops[1]!.provenance).toBe('tree-sitter');
    expect(path.hops[1]!.architecture?.role).toBe('service');
    expect(path.hops[1]!.architecture?.layer).toBe('business');
    expect(path.confidence).toBe(1.0);
    expect(result.entrypoints.some((e) => e.nodeId === 'ctrl')).toBe(true);
  });

  it('surfaces ambiguous hops in warnings and truncates the default path', () => {
    const controller = makeNode('ctrl', 'OrderController', 'class', 'OrderController.java', {
      decorators: ['@RestController'],
    });
    const serviceA = makeNode('svcA', 'OrderServiceA', 'class', 'OrderServiceA.java', {
      decorators: ['@Service'],
    });
    const serviceB = makeNode('svcB', 'OrderServiceB', 'class', 'OrderServiceB.java', {
      decorators: ['@Service'],
    });
    const mapper = makeNode('mapper', 'OrderMapper', 'interface', 'OrderMapper.java', {
      decorators: ['@Mapper'],
    });

    queries.insertNodes([controller, serviceA, serviceB, mapper]);
    queries.insertEdges([
      // Controller calls both services -> ambiguous hop
      makeEdge('ctrl', 'svcA', 'calls', 'heuristic', { confidence: 0.6 }),
      makeEdge('ctrl', 'svcB', 'calls', 'heuristic', { confidence: 0.6 }),
      makeEdge('svcA', 'mapper', 'calls', 'tree-sitter'),
    ]);

    const result = engine.trace({ from: 'ctrl', to: 'mapper' });

    expect(result.notFound).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes('Ambiguous hop'))).toBe(true);

    // Default path should be truncated at the ambiguous hop, so it should not reach mapper.
    const defaultPath = result.paths[0]!;
    expect(defaultPath.hops[defaultPath.hops.length - 1]!.node.id).not.toBe('mapper');
  });

  it('returns a graceful structured not-found for an unknown query', () => {
    const result = engine.trace({ query: 'DefinitelyDoesNotExist' });

    expect(result.notFound).toBe(true);
    expect(result.paths).toHaveLength(0);
    expect(result.entrypoints).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes('DefinitelyDoesNotExist'))).toBe(true);
  });

  it('resolves a query to a node and traces to a target', () => {
    const service = makeNode('svc', 'AccountService', 'class', 'AccountService.java', {
      decorators: ['@Service'],
    });
    const mapper = makeNode('mapper', 'AccountMapper', 'interface', 'AccountMapper.java', {
      decorators: ['@Mapper'],
    });

    queries.insertNodes([service, mapper]);
    queries.insertEdge(makeEdge('svc', 'mapper', 'calls', 'tree-sitter'));

    const result = engine.trace({ query: 'AccountService', to: 'mapper' });

    expect(result.notFound).toBe(false);
    expect(result.paths).toHaveLength(1);
    expect(result.paths[0]!.hops[0]!.node.id).toBe('svc');
    expect(result.paths[0]!.hops[1]!.node.id).toBe('mapper');
  });
});

describe('ArchitectureImpactEngine', () => {
  let db: DatabaseConnection;
  let queries: QueryBuilder;
  let traverser: GraphTraverser;
  let engine: ArchitectureImpactEngine;
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = path.join(__dirname, '../temp-architecture-impact-test');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const springgraphDir = path.join(tempDir, '.springgraph');
    if (!fs.existsSync(springgraphDir)) {
      fs.mkdirSync(springgraphDir, { recursive: true });
    }
    dbPath = path.join(springgraphDir, 'springgraph.db');
    if (fs.existsSync(dbPath)) {
      try { fs.unlinkSync(dbPath); } catch {}
    }
    db = DatabaseConnection.initialize(dbPath);
    queries = new QueryBuilder(db.getDb());
    traverser = new GraphTraverser(queries);
    engine = new ArchitectureImpactEngine(traverser, queries);
  });

  afterEach(() => {
    if (db && db.isOpen()) db.close();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('bounds impact depth to the default of 3 and returns recommended tests for affected surfaces', () => {
    // Build a chain: ctrl -> svc -> mapper -> sql -> db (5 hops if unbounded)
    const controller = makeNode('ctrl', 'PaymentController', 'class', 'PaymentController.java', {
      decorators: ['@RestController'],
    });
    const service = makeNode('svc', 'PaymentService', 'class', 'PaymentService.java', {
      decorators: ['@Service'],
    });
    const mapper = makeNode('mapper', 'PaymentMapper', 'interface', 'PaymentMapper.java', {
      decorators: ['@Mapper'],
    });
    const sql = makeNode('sql', 'selectPayment', 'function', 'PaymentMapper.xml');
    const dbUtil = makeNode('dbUtil', 'JdbcTemplate', 'class', 'DbUtil.java');

    queries.insertNodes([controller, service, mapper, sql, dbUtil]);

    // getImpactRadius traverses incoming edges from the target (dependents).
    // Chain: ctrl -> svc -> mapper -> sql -> dbUtil
    // Impact from dbUtil reaches sql (depth 1), mapper (depth 2), svc (depth 3),
    // and would reach ctrl at depth 4 (excluded by default depth bound).
    queries.insertEdges([
      makeEdge('ctrl', 'svc', 'calls', 'tree-sitter'),
      makeEdge('svc', 'mapper', 'calls', 'tree-sitter'),
      makeEdge('mapper', 'sql', 'calls', 'tree-sitter'),
      makeEdge('sql', 'dbUtil', 'calls', 'tree-sitter'),
    ]);

    const result = engine.impact({ nodeId: 'dbUtil' });

    expect(result.notFound).toBe(false);
    expect(result.effectiveDepth).toBe(3);
    expect(result.subgraph.nodes.has('sql')).toBe(true);
    expect(result.subgraph.nodes.has('mapper')).toBe(true);
    expect(result.subgraph.nodes.has('svc')).toBe(true);
    // ctrl is 4 hops away from dbUtil, so default depth 3 should not reach it.
    expect(result.subgraph.nodes.has('ctrl')).toBe(false);

    expect(result.breakdown.services.length).toBeGreaterThan(0);
    expect(result.breakdown.mappers.length).toBeGreaterThan(0);
    expect(result.recommendedTests.length).toBeGreaterThan(0);

    const serviceRec = result.recommendedTests.find((t) => t.nodeId === 'svc');
    expect(serviceRec).toBeDefined();
    expect(serviceRec!.reason).toContain('Service affected');

    expect(result.riskLevel).toBe('high');
  });

  it('does not explode impact through reverse contains edges from the target', () => {
    const parentClass = makeNode('parent', 'UserModule', 'class', 'UserModule.java');
    const targetMethod = makeNode('target', 'updateUser', 'method', 'UserModule.java');
    const caller = makeNode('caller', 'AdminService', 'class', 'AdminService.java', {
      decorators: ['@Service'],
    });

    queries.insertNodes([parentClass, targetMethod, caller]);
    // Target is contained in parent class
    queries.insertEdge(makeEdge('parent', 'target', 'contains', 'tree-sitter'));
    // Caller calls target
    queries.insertEdge(makeEdge('caller', 'target', 'calls', 'tree-sitter'));

    const result = engine.impact({ nodeId: 'target' });

    expect(result.notFound).toBe(false);
    // The caller should be reached through the calls edge.
    expect(result.subgraph.nodes.has('caller')).toBe(true);
    // The parent container should NOT be pulled in via reverse contains.
    expect(result.subgraph.nodes.has('parent')).toBe(false);
    expect(result.warnings.some((w) => w.includes('Reverse containment'))).toBe(false);
  });

  it('returns a stable empty recommendations array for a target with no dependents', () => {
    const orphan = makeNode('orphan', 'UnusedService', 'class', 'UnusedService.java', {
      decorators: ['@Service'],
    });
    queries.insertNode(orphan);

    const result = engine.impact({ nodeId: 'orphan' });

    expect(result.notFound).toBe(false);
    expect(result.breakdown.entrypoints).toHaveLength(0);
    expect(result.breakdown.services).toHaveLength(0);
    expect(result.recommendedTests).toHaveLength(0);
    expect(result.riskLevel).toBe('low');
  });

  it('returns a graceful not-found for an unknown query', () => {
    const result = engine.impact({ query: 'NoSuchSymbol' });

    expect(result.notFound).toBe(true);
    expect(result.recommendedTests).toHaveLength(0);
    expect(result.breakdown.entrypoints).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes('NoSuchSymbol'))).toBe(true);
  });

  it('honors an explicit depth bound shorter than the default', () => {
    const controller = makeNode('ctrl', 'ReportController', 'class', 'ReportController.java', {
      decorators: ['@RestController'],
    });
    const service = makeNode('svc', 'ReportService', 'class', 'ReportService.java', {
      decorators: ['@Service'],
    });
    const mapper = makeNode('mapper', 'ReportMapper', 'interface', 'ReportMapper.java', {
      decorators: ['@Mapper'],
    });

    queries.insertNodes([controller, service, mapper]);
    queries.insertEdges([
      makeEdge('ctrl', 'svc', 'calls', 'tree-sitter'),
      makeEdge('svc', 'mapper', 'calls', 'tree-sitter'),
    ]);

    const result = engine.impact({ nodeId: 'mapper', depth: 1 });

    expect(result.effectiveDepth).toBe(1);
    expect(result.subgraph.nodes.has('svc')).toBe(true);
    // Controller is 2 hops away from mapper, so depth 1 should not reach it.
    expect(result.subgraph.nodes.has('ctrl')).toBe(false);
  });
});
