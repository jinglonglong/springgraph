import { describe, it, expect } from 'vitest';
import { resolveRole, getLayerForRole, getFacetPriority } from '../src/architecture/role-assignment';
import { NodeArchitectureFacet } from '../src/architecture/types';

describe('Role Assignment & Conflict Resolution', () => {
  it('should get correct layer for roles', () => {
    expect(getLayerForRole('controller')).toBe('entry');
    expect(getLayerForRole('RestController')).toBe('entry');
    expect(getLayerForRole('service')).toBe('business');
    expect(getLayerForRole('service-impl')).toBe('business');
    expect(getLayerForRole('mapper')).toBe('data');
    expect(getLayerForRole('repository')).toBe('data');
    expect(getLayerForRole('entity')).toBe('model');
    expect(getLayerForRole('component')).toBe('infra');
    expect(getLayerForRole('config')).toBe('infra');
    expect(getLayerForRole('unknown-role')).toBe('unknown');
  });

  it('should calculate priority ranks correctly', () => {
    // Annotation controller (priority 1)
    expect(getFacetPriority({
      nodeId: '1',
      facetName: 'spring-annotation',
      confidence: 1.0,
      evidence: [],
      role: 'RestController'
    })).toBe(1.0);

    // Annotation service (priority 2)
    expect(getFacetPriority({
      nodeId: '1',
      facetName: 'spring-annotation',
      confidence: 1.0,
      evidence: [],
      role: 'service-impl'
    })).toBe(2.0);

    // Suffix controller (priority 6.1)
    expect(getFacetPriority({
      nodeId: '1',
      facetName: 'spring-naming',
      confidence: 1.0,
      evidence: [],
      role: 'Controller'
    })).toBe(6.1);

    // Suffix service-impl (priority 6.2)
    expect(getFacetPriority({
      nodeId: '1',
      facetName: 'spring-naming',
      confidence: 1.0,
      evidence: [],
      role: 'ServiceImpl'
    })).toBe(6.2);
  });

  it('should not detect conflicts when roles agree or only one assigns role', () => {
    const facets: NodeArchitectureFacet[] = [
      {
        nodeId: 'node1',
        facetName: 'spring-annotation',
        confidence: 0.9,
        evidence: [],
        role: 'RestController'
      },
      {
        nodeId: 'node1',
        facetName: 'spring-naming',
        confidence: 0.5,
        evidence: [],
        role: 'RestController'
      },
      {
        nodeId: 'node2',
        facetName: 'spring-naming',
        confidence: 0.8,
        evidence: [],
        role: 'ServiceImpl'
      }
    ];

    const conflicts = resolveRole(facets);
    expect(conflicts.length).toBe(0);

    // Verify facets are updated with correct layer and entrypoint status
    expect(facets[0].layer).toBe('entry');
    expect(facets[0].isEntrypoint).toBe(true);
    expect(facets[1].layer).toBe('entry');
    expect(facets[1].isEntrypoint).toBe(true);

    expect(facets[2].layer).toBe('business');
    expect(facets[2].isEntrypoint).toBeFalsy();
  });

  it('should resolve conflicts where annotation wins over naming', () => {
    const facets: NodeArchitectureFacet[] = [
      {
        nodeId: 'node1',
        facetName: 'spring-naming',
        confidence: 0.9,
        evidence: [],
        role: 'ServiceImpl' // Tier 6
      },
      {
        nodeId: 'node1',
        facetName: 'spring-annotation',
        confidence: 0.7,
        evidence: [],
        role: 'RestController' // Tier 1
      }
    ];

    const conflicts = resolveRole(facets);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].nodeId).toBe('node1');
    expect(conflicts[0].resolvedRole).toBe('RestController');

    // Winner role is RestController, layer is entry
    expect(facets[0].role).toBe('RestController');
    expect(facets[0].layer).toBe('entry');
    expect(facets[0].isEntrypoint).toBe(true);
    expect(facets[0].evidence.some(e => e.includes('Resolved role conflict'))).toBe(true);

    expect(facets[1].role).toBe('RestController');
    expect(facets[1].layer).toBe('entry');
    expect(facets[1].isEntrypoint).toBe(true);
    expect(facets[1].evidence.some(e => e.includes('Resolved role conflict'))).toBe(true);
  });

  it('should resolve conflicts by sorting priority tiers', () => {
    const facets: NodeArchitectureFacet[] = [
      {
        nodeId: 'node1',
        facetName: 'spring-annotation',
        confidence: 0.8,
        evidence: [],
        role: 'service' // Tier 2
      },
      {
        nodeId: 'node1',
        facetName: 'spring-annotation',
        confidence: 0.9,
        evidence: [],
        role: 'repository' // Tier 3
      }
    ];

    const conflicts = resolveRole(facets);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].resolvedRole).toBe('service');

    expect(facets[0].role).toBe('service');
    expect(facets[0].layer).toBe('business');
  });

  it('should resolve conflicts by confidence when priority tiers are equal', () => {
    const facets: NodeArchitectureFacet[] = [
      {
        nodeId: 'node1',
        facetName: 'spring-annotation',
        confidence: 0.7,
        evidence: [],
        role: 'service' // Tier 2
      },
      {
        nodeId: 'node1',
        facetName: 'spring-annotation',
        confidence: 0.95,
        evidence: [],
        role: 'service-impl' // Tier 2
      }
    ];

    const conflicts = resolveRole(facets);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].resolvedRole).toBe('service-impl');

    expect(facets[0].role).toBe('service-impl');
    expect(facets[0].layer).toBe('business');
  });
});
