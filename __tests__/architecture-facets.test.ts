import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FacetEngine, facetRegistry } from '../src/architecture/facet-engine';
import { DatabaseConnection } from '../src/db';
import { Node } from '../src/types';
import { ArchitectureProfile, ArchitectureFacet, ArchitectureSignal } from '../src/architecture/types';
import * as path from 'path';
import * as fs from 'fs';

describe('FacetEngine', () => {
  let db: DatabaseConnection;
  let dbPath: string;
  let tempDir: string;

  beforeEach(() => {
    facetRegistry.clear();

    tempDir = path.join(__dirname, '../temp-facet-engine-test');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const codegraphDir = path.join(tempDir, '.codegraph');
    if (!fs.existsSync(codegraphDir)) {
      fs.mkdirSync(codegraphDir, { recursive: true });
    }
    dbPath = path.join(codegraphDir, 'codegraph.db');
    if (fs.existsSync(dbPath)) {
      try {
        fs.unlinkSync(dbPath);
      } catch {}
    }
    db = DatabaseConnection.initialize(dbPath);
  });

  afterEach(() => {
    if (db && db.isOpen()) {
      db.close();
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    facetRegistry.clear();
  });

  const mockProfile: ArchitectureProfile = {
    id: 'test-profile',
    name: 'Test Profile',
    description: 'A profile for testing facets.',
    facetIds: ['facet-1', 'facet-2'],
    layers: [
      { id: 'entry', label: 'Entry Layer', tier: 1 },
      { id: 'business', label: 'Business Layer', tier: 2 }
    ],
    roles: [
      { id: 'controller', label: 'Controller', layerId: 'entry' },
      { id: 'service', label: 'Service', layerId: 'business' }
    ],
    detect(signals) {
      return {
        profileName: 'test-profile',
        confidence: 0.8,
        nodeCount: 2,
        layerBreakdown: {},
        roleBreakdown: {},
        signals
      };
    }
  };

  it('should run registered facets and compute per-node facets', () => {
    const facet1: ArchitectureFacet = {
      id: 'facet-1',
      name: 'Naming Facet',
      detect(context) {
        return [
          {
            nodeId: 'node-a',
            facetName: 'facet-1',
            profileName: 'test-profile',
            confidence: 0.7,
            evidence: ['Name ends with Controller'],
            metadata: {
              role: 'controller',
              layer: 'entry'
            }
          }
        ];
      }
    };

    const facet2: ArchitectureFacet = {
      id: 'facet-2',
      name: 'Annotation Facet',
      detect(context) {
        return [
          {
            nodeId: 'node-b',
            facetName: 'facet-2',
            profileName: 'test-profile',
            confidence: 0.9,
            evidence: ['Annotated with @Service'],
            metadata: {
              role: 'service',
              layer: 'business'
            }
          }
        ];
      }
    };

    facetRegistry.register(facet1);
    facetRegistry.register(facet2);

    const engine = new FacetEngine(mockProfile);
    const nodes: Node[] = [
      { id: 'node-a', name: 'MyController', kind: 'class', filePath: 'MyController.java', language: 'java', startLine: 1, endLine: 10, startColumn: 0, endColumn: 0, updatedAt: Date.now() },
      { id: 'node-b', name: 'MyService', kind: 'class', filePath: 'MyService.java', language: 'java', startLine: 1, endLine: 10, startColumn: 0, endColumn: 0, updatedAt: Date.now() }
    ];

    const results = engine.runFacets(nodes, db);
    expect(results).toHaveLength(2);

    const controllerFacet = results.find(f => f.nodeId === 'node-a');
    expect(controllerFacet).toBeDefined();
    expect(controllerFacet?.role).toBe('controller');
    expect(controllerFacet?.layer).toBe('entry');
    expect(controllerFacet?.confidence).toBe(0.7);
    expect(controllerFacet?.evidence).toContain('Name ends with Controller');

    const serviceFacet = results.find(f => f.nodeId === 'node-b');
    expect(serviceFacet).toBeDefined();
    expect(serviceFacet?.role).toBe('service');
    expect(serviceFacet?.layer).toBe('business');
    expect(serviceFacet?.confidence).toBe(0.9);
    expect(serviceFacet?.evidence).toContain('Annotated with @Service');
  });

  it('should apply confidence scoring and choose the highest-confidence role/layer on conflict', () => {
    // Both facets assign a role to the same node 'node-a'
    const facet1: ArchitectureFacet = {
      id: 'facet-1',
      name: 'Naming Facet',
      detect(context) {
        return [
          {
            nodeId: 'node-a',
            facetName: 'facet-1',
            profileName: 'test-profile',
            confidence: 0.6,
            evidence: ['Low confidence Controller naming'],
            metadata: {
              role: 'controller',
              layer: 'entry'
            }
          }
        ];
      }
    };

    const facet2: ArchitectureFacet = {
      id: 'facet-2',
      name: 'Annotation Facet',
      detect(context) {
        return [
          {
            nodeId: 'node-a',
            facetName: 'facet-2',
            profileName: 'test-profile',
            confidence: 0.95,
            evidence: ['High confidence Service annotation'],
            metadata: {
              role: 'service',
              layer: 'business'
            }
          }
        ];
      }
    };

    facetRegistry.register(facet1);
    facetRegistry.register(facet2);

    const engine = new FacetEngine(mockProfile);
    const nodes: Node[] = [
      { id: 'node-a', name: 'ConfusingClass', kind: 'class', filePath: 'ConfusingClass.java', language: 'java', startLine: 1, endLine: 10, startColumn: 0, endColumn: 0, updatedAt: Date.now() }
    ];

    const results = engine.runFacets(nodes, db);
    expect(results).toHaveLength(1);

    const result = results[0];
    // In computeNodeFacet, the role/layer with highest confidence is selected.
    // Annotation Facet (0.95 confidence) wins over Naming Facet (0.6 confidence).
    expect(result.role).toBe('service');
    expect(result.layer).toBe('business');
    // Note: The resolveRole function might tie-break or choose differently based on priorities,
    // but in any case computeNodeFacet chooses highest confidence, and resolveRole chooses by priority then confidence.
    // In spring-cloud, Controller priority (1.0) is higher than Service priority (2.0).
    // Let's check how our computeNodeFacet and resolveRole handle this.
    // In resolveRole, it first sorts by priority:
    // Naming Facet (role 'controller', naming suffix): priority 6.1
    // Annotation Facet (role 'service', annotation): priority 2.0
    // So Annotation service (priority 2.0) has higher priority than Naming controller (priority 6.1).
    // Therefore, role 'service' should be the resolved role.
    expect(result.role).toBe('service');
    expect(result.layer).toBe('business');
    expect(result.confidence).toBe(0.95);
    expect(result.evidence).toContain('Low confidence Controller naming');
    expect(result.evidence).toContain('High confidence Service annotation');
  });

  it('should aggregate and flatten signals correctly', () => {
    const facet1: ArchitectureFacet = {
      id: 'facet-1',
      name: 'Facet 1',
      detect(context) {
        return [
          {
            nodeId: 'node-a',
            facetName: 'facet-1',
            profileName: 'test-profile',
            confidence: 0.8,
            evidence: ['evidence-a'],
            metadata: { role: 'controller', layer: 'entry' }
          }
        ];
      }
    };

    facetRegistry.register(facet1);

    const engine = new FacetEngine(mockProfile);
    const nodes: Node[] = [
      { id: 'node-a', name: 'NodeA', kind: 'class', filePath: 'NodeA.java', language: 'java', startLine: 1, endLine: 10, startColumn: 0, endColumn: 0, updatedAt: Date.now() }
    ];

    const facets = engine.runFacets(nodes, db);
    const signals = engine.aggregateSignals(facets);

    expect(signals).toHaveLength(1);
    expect(signals[0].nodeId).toBe('node-a');
    expect(signals[0].confidence).toBe(0.8);
    expect(signals[0].evidence).toEqual(['evidence-a']);
  });
});
