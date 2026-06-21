import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { detectArchitectureProfile } from '../src/architecture/profile-detector';
import { profileRegistry } from '../src/architecture/profile-registry';
import { facetRegistry } from '../src/architecture/facet-engine';
import { DatabaseConnection } from '../src/db';
import { Node } from '../src/types';
import { ArchitectureProfile, ArchitectureFacet } from '../src/architecture/types';
import * as path from 'path';
import * as fs from 'fs';

describe('profile-detector', () => {
  let db: DatabaseConnection;
  let dbPath: string;

  beforeEach(() => {
    profileRegistry.clear();
    facetRegistry.clear();

    const tempDir = path.join(__dirname, '../temp-detector-test');
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
    const tempDir = path.join(__dirname, '../temp-detector-test');
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    profileRegistry.clear();
    facetRegistry.clear();
  });

  it('should fallback to generic when no profiles are registered', () => {
    const result = detectArchitectureProfile([], db);
    expect(result.activeProfile).toBe('generic');
    expect(result.allMatches).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('should run registered profiles, execute facets, aggregate signals, and return matches sorted by confidence', () => {
    const mockFacet1: ArchitectureFacet = {
      id: 'facet-1',
      name: 'Facet One',
      detect(context) {
        return [
          {
            nodeId: 'node-1',
            facetName: 'facet-1',
            profileName: 'profile-a',
            confidence: 0.9,
            evidence: ['found node-1'],
            metadata: {
              role: 'controller',
              layer: 'entry',
            }
          }
        ];
      }
    };

    const mockFacet2: ArchitectureFacet = {
      id: 'facet-2',
      name: 'Facet Two',
      detect(context) {
        return [
          {
            nodeId: 'node-2',
            facetName: 'facet-2',
            profileName: 'profile-b',
            confidence: 0.6,
            evidence: ['found node-2'],
            metadata: {
              role: 'service',
              layer: 'business',
            }
          }
        ];
      }
    };

    facetRegistry.register(mockFacet1);
    facetRegistry.register(mockFacet2);

    const profileA: ArchitectureProfile = {
      id: 'profile-a',
      name: 'Profile A',
      description: 'Test Profile A',
      facetIds: ['facet-1'],
      layers: [{ id: 'entry', label: 'Entry', tier: 1 }],
      roles: [{ id: 'controller', label: 'Controller', layerId: 'entry' }],
      detect(signals) {
        return {
          profileName: 'Profile A',
          confidence: 0.9,
          nodeCount: 1,
          layerBreakdown: { entry: 1 },
          roleBreakdown: { controller: 1 },
          signals,
        };
      }
    };

    const profileB: ArchitectureProfile = {
      id: 'profile-b',
      name: 'Profile B',
      description: 'Test Profile B',
      facetIds: ['facet-2'],
      layers: [{ id: 'business', label: 'Business', tier: 2 }],
      roles: [{ id: 'service', label: 'Service', layerId: 'business' }],
      detect(signals) {
        return {
          profileName: 'Profile B',
          confidence: 0.6,
          nodeCount: 1,
          layerBreakdown: { business: 1 },
          roleBreakdown: { service: 1 },
          signals,
        };
      }
    };

    profileRegistry.register(profileA);
    profileRegistry.register(profileB);

    const nodes: Node[] = [
      { id: 'node-1', name: 'Node 1', kind: 'class', filePath: 'SomeFile.java' },
      { id: 'node-2', name: 'Node 2', kind: 'class', filePath: 'AnotherFile.java' }
    ];

    const result = detectArchitectureProfile(nodes, db);
    expect(result.activeProfile).toBe('Profile A');
    expect(result.allMatches.length).toBe(2);

    expect(result.allMatches[0].profileName).toBe('Profile A');
    expect(result.allMatches[0].confidence).toBe(0.9);
    expect(result.allMatches[0].nodeCount).toBe(1);
    expect(result.allMatches[0].layerBreakdown).toEqual({ entry: 1 });
    expect(result.allMatches[0].roleBreakdown).toEqual({ controller: 1 });

    expect(result.allMatches[1].profileName).toBe('Profile B');
    expect(result.allMatches[1].confidence).toBe(0.6);
  });
});
