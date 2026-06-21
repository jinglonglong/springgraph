import { describe, it, expect } from 'vitest';
import { ProfileRegistry, genericProfile, profileRegistry } from '../src/architecture/profile-registry';
import { ArchitectureProfile } from '../src/architecture/types';

describe('ProfileRegistry', () => {
  const mockProfile: ArchitectureProfile = {
    id: 'mock-profile',
    name: 'Mock Profile',
    description: 'A mock profile for testing.',
    facetIds: ['facet-1'],
    layers: [
      { id: 'business', label: 'Business Tier', tier: 2 }
    ],
    roles: [
      { id: 'service', label: 'Service Class', layerId: 'business' }
    ],
    detect() {
      return {
        profileName: 'mock-profile',
        confidence: 0.8,
        nodeCount: 10,
        layerBreakdown: { business: 10 },
        roleBreakdown: { service: 10 },
        signals: []
      };
    }
  };

  const anotherMockProfile: ArchitectureProfile = {
    id: 'another-profile',
    name: 'Another Profile',
    description: 'Another mock profile.',
    facetIds: [],
    layers: [],
    roles: [],
    detect() {
      return {
        profileName: 'another-profile',
        confidence: 0.5,
        nodeCount: 0,
        layerBreakdown: {},
        roleBreakdown: {},
        signals: []
      };
    }
  };

  it('should register profiles in order and return all of them', () => {
    const registry = new ProfileRegistry();
    expect(registry.getProfiles()).toEqual([]);

    registry.register(mockProfile);
    expect(registry.getProfiles()).toEqual([mockProfile]);

    registry.register(anotherMockProfile);
    expect(registry.getProfiles()).toEqual([mockProfile, anotherMockProfile]);
  });

  it('should find registered profiles by name or id', () => {
    const registry = new ProfileRegistry();
    registry.register(mockProfile);
    registry.register(anotherMockProfile);

    // Find by ID
    expect(registry.findByName('mock-profile')).toBe(mockProfile);
    expect(registry.findByName('another-profile')).toBe(anotherMockProfile);

    // Find by Name
    expect(registry.findByName('Mock Profile')).toBe(mockProfile);
    expect(registry.findByName('Another Profile')).toBe(anotherMockProfile);

    // Return undefined for unknown
    expect(registry.findByName('unknown-profile')).toBeUndefined();
  });

  it('should return the generic fallback profile', () => {
    const registry = new ProfileRegistry();
    const fallback = registry.getGenericFallback();
    expect(fallback).toBe(genericProfile);
    expect(fallback.id).toBe('generic');
    expect(fallback.name).toBe('Generic');
  });

  it('should have correct default confidence and properties on genericProfile', () => {
    expect(genericProfile.id).toBe('generic');
    expect(genericProfile.name).toBe('Generic');
    expect(genericProfile.facetIds).toEqual([]);
    expect(genericProfile.layers).toEqual([
      { id: 'unknown', label: 'Unknown Layer', tier: 99 }
    ]);
    expect(genericProfile.roles).toEqual([]);

    const matchResult = genericProfile.detect([]);
    expect(matchResult.profileName).toBe('generic');
    expect(matchResult.confidence).toBe(0.1);
    expect(matchResult.nodeCount).toBe(0);
  });

  it('should export a singleton profileRegistry instance', () => {
    expect(profileRegistry).toBeInstanceOf(ProfileRegistry);
  });
});
