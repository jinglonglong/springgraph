import { NacosConfigResolver } from './nacos-config-resolver.js';
import type {
  RuntimeConfigPropertyRecord,
  SpringKgEdgeInput,
  SpringKgLike,
  SpringKgSymbolInput,
} from './types.js';

export interface SyncNacosOptions {
  dryRun?: boolean;
  profile?: string;
}

export interface SyncNacosResult {
  scanned: number;
  added: number;
  updated: number;
  removed: number;
  duration: number;
}

/**
 * T63: sync-nacos CLI command - thin wrapper around NacosConfigResolver
 */
export async function runSyncNacos(
  projectPath: string,
  options: SyncNacosOptions = {}
): Promise<SyncNacosResult> {
  const startTime = Date.now();
  const { dryRun = false } = options;

  // Create a mock kg for dry run mode that doesn't actually persist
  const kg = dryRun ? createDryRunKg() : createRealKg();
  const resolver = new NacosConfigResolver();

  let scanned = 0;
  let added = 0;
  let updated = 0;
  let removed = 0;

  try {
    const result = await resolver.enhance({ projectPath, kg });
    scanned = 1; // At least one config file was scanned
    added = result.clustersCount + result.configsCount + result.servicesCount;
    // updated and removed would require comparing with existing state
  } catch (error) {
    console.error(`[springkg] sync-nacos error: ${error}`);
    throw error;
  }

  const duration = Date.now() - startTime;
  console.log(`[springkg] sync-nacos scanned=${scanned} added=${added} updated=${updated} removed=${removed} duration=${duration}ms`);

  return { scanned, added, updated, removed, duration };
}

/**
 * Create a mock kg that doesn't persist for dry runs
 */
function createDryRunKg() {
  const noop = async (): Promise<void> => {};
  return {
    upsertSymbol: async (_symbol: SpringKgSymbolInput) => noop(),
    upsertEdge: async (_edge: SpringKgEdgeInput) => noop(),
    recordConfigProperty: async (_prop: RuntimeConfigPropertyRecord) => noop(),
  } satisfies SpringKgLike;
}

/**
 * Create a real kg (placeholder - Team A provides this)
 */
function createRealKg() {
  // This would be provided by Team A's SpringKg class
  const noop = async (): Promise<void> => {};
  return {
    upsertSymbol: async (_symbol: SpringKgSymbolInput) => noop(),
    upsertEdge: async (_edge: SpringKgEdgeInput) => noop(),
    recordConfigProperty: async (_prop: RuntimeConfigPropertyRecord) => noop(),
  } satisfies SpringKgLike;
}
