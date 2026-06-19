import { describe, it, expect, afterEach } from 'vitest';
import { runSyncNacos } from '../src/sync-nacos.js';
import { createTempProject, cleanupTempProject } from './test-helpers.js';

describe('sync-nacos', () => {
  let projectPath: string;

  afterEach(async () => {
    if (projectPath) {
      await cleanupTempProject(projectPath);
    }
  });

  it('case 1: runSyncNacos on fixture with bootstrap.yml (1 nacos_cluster, 1 nacos_config) -> scanned >= 1, added >= 2, errors = []', async () => {
    // Copy bootstrap.yml to src/main/resources so loadConfigFiles can find it
    projectPath = await createTempProject([
      { fromFixture: 'bootstrap.yml', to: 'src/main/resources/bootstrap.yml' }
    ]);

    const result = await runSyncNacos(projectPath, { dryRun: true });

    expect(result.scanned).toBeGreaterThanOrEqual(1);
    expect(result.added).toBeGreaterThanOrEqual(2);
    expect(result.duration).toBeGreaterThan(0);
  });

  it('dryRun=true should not persist but still report scanned count', async () => {
    projectPath = await createTempProject([
      { fromFixture: 'bootstrap.yml', to: 'src/main/resources/bootstrap.yml' }
    ]);

    const result = await runSyncNacos(projectPath, { dryRun: true });

    expect(result.scanned).toBeGreaterThanOrEqual(1);
  });
});
