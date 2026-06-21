import { ArchitectureProfile } from './types';

/**
 * Built-in generic profile used as a fallback when no specific architecture
 * signals (such as Spring Cloud signals) are detected in the repository.
 * Consistent with requirements, it has a confidence of 0.1 so that any
 * specific matched profile will naturally take precedence.
 */
export const genericProfile: ArchitectureProfile = {
  id: 'generic',
  name: 'Generic',
  description: 'Generic fallback profile when no specific architecture pattern is matched.',
  facetIds: [],
  layers: [
    {
      id: 'unknown',
      label: 'Unknown Layer',
      tier: 99
    }
  ],
  roles: [],
  detect() {
    return {
      profileName: 'generic',
      confidence: 0.1,
      nodeCount: 0,
      layerBreakdown: {},
      roleBreakdown: {},
      signals: []
    };
  }
};

/**
 * ProfileRegistry handles the registration, lookup, and fallback resolution
 * of ArchitectureProfiles.
 */
export class ProfileRegistry {
  private profiles: ArchitectureProfile[] = [];

  /**
   * Register an ArchitectureProfile.
   * Profiles are added in the order they are registered without deduplication.
   */
  register(profile: ArchitectureProfile): void {
    this.profiles.push(profile);
  }

  /**
   * Get all registered profiles in their registration order.
   */
  getProfiles(): ArchitectureProfile[] {
    return [...this.profiles];
  }

  /**
   * Find a registered profile by its name or ID.
   */
  findByName(name: string): ArchitectureProfile | undefined {
    return this.profiles.find(p => p.name === name || p.id === name);
  }

  /**
   * Clear all registered profiles (useful for testing).
   */
  clear(): void {
    this.profiles = [];
  }

  /**
   * Get the built-in generic fallback profile.
   */
  getGenericFallback(): ArchitectureProfile {
    return genericProfile;
  }
}

// Export the singleton instance of the profile registry
export const profileRegistry = new ProfileRegistry();
