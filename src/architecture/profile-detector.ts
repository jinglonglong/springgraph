import { DatabaseConnection } from '../db';
import { Node } from '../types';
import {
  ProfileDetectionResult,
  ArchitectureProfileMatch,
  ArchitectureContext,
} from './types';
import { profileRegistry } from './profile-registry';
import { FacetEngine } from './facet-engine';
// Side-effect import: registers the built-in spring-cloud and generic profiles
// (and their facets) with the singleton registries when the detector module
// is first loaded. Without this, profileRegistry.getProfiles() returns []
// because nothing else pulls in ./profiles/spring-cloud, so the detection
// loop never iterates and the snapshot always falls back to 'generic' with
// no matches — which is the exact failure mode the architecture WebUI
// exhibits when the "检测依据" panel is empty.
import './profiles/spring-cloud';
import * as path from 'path';

/**
 * Detects the active architecture profile of the project.
 *
 * Runs all registered profiles, aggregates their facet signals, computes matching confidences
 * and node breakdowns, and returns the sorted matches and the selected active profile.
 *
 * @param nodes - All nodes in the codebase
 * @param db - The database connection
 * @returns The profile detection result
 */
export function detectArchitectureProfile(
  nodes: Node[],
  db: DatabaseConnection
): ProfileDetectionResult {
  const warnings: string[] = [];
  const allMatches: ArchitectureProfileMatch[] = [];

  // Determine project root from database path: db.getPath() is usually:
  // <projectRoot>/.springgraph/springgraph.db
  const dbPath = db.getPath();
  const projectRoot = path.dirname(path.dirname(dbPath));

  const context: ArchitectureContext = {
    db,
    projectRoot,
    getNodes: async () => nodes,
  };

  // Get all registered profiles from profileRegistry
  const profiles = profileRegistry.getProfiles();

  for (const profile of profiles) {
    try {
      const engine = new FacetEngine(profile);
      // Run facets synchronously since detectArchitectureProfile is synchronous
      const signals = engine.runFacetsSync(context);

      // Aggregate signals using the engine's aggregator
      const aggregator = engine.getAggregator();
      const nodeFacets = aggregator.aggregate();

      // Compute breakdowns per layer and role
      const layerBreakdown: Record<string, number> = {};
      const roleBreakdown: Record<string, number> = {};

      for (const facet of nodeFacets) {
        if (facet.layer) {
          layerBreakdown[facet.layer] = (layerBreakdown[facet.layer] || 0) + 1;
        }
        if (facet.role) {
          roleBreakdown[facet.role] = (roleBreakdown[facet.role] || 0) + 1;
        }
      }

      // Compute confidence score. Inherited Wisdom:
      // - Profile confidence = average of all node facet confidences (or 0.5 if no signals)
      let confidence = 0.5;
      if (nodeFacets.length > 0) {
        const sumConfidence = nodeFacets.reduce((sum, f) => sum + f.confidence, 0);
        confidence = sumConfidence / nodeFacets.length;
      }

      // Build ArchitectureProfileMatch
      let match: ArchitectureProfileMatch;

      // Allow the profile itself to refine the match or run its own aggregation logic if it provides a detect function
      if (typeof profile.detect === 'function') {
        const profileMatch = profile.detect(signals);
        match = {
          profileName: profileMatch.profileName || profile.id,
          confidence: profileMatch.confidence !== undefined ? profileMatch.confidence : confidence,
          nodeCount: profileMatch.nodeCount !== undefined ? profileMatch.nodeCount : nodeFacets.length,
          layerBreakdown: { ...layerBreakdown, ...profileMatch.layerBreakdown },
          roleBreakdown: { ...roleBreakdown, ...profileMatch.roleBreakdown },
          signals,
        };
      } else {
        match = {
          profileName: profile.id,
          confidence,
          nodeCount: nodeFacets.length,
          layerBreakdown,
          roleBreakdown,
          signals,
        };
      }

      allMatches.push(match);
    } catch (e: any) {
      warnings.push(`Failed to run profile ${profile.name}: ${e?.message || String(e)}`);
    }
  }

  // Sort matches by confidence descending
  allMatches.sort((a, b) => b.confidence - a.confidence);

  // Fallback to "generic" as specified
  const activeProfile = allMatches[0]?.profileName ?? 'generic';

  return {
    activeProfile,
    allMatches,
    warnings,
  };
}
