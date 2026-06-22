/**
 * `springkg rebuild-community` + `springkg uninit`
 *
 * rebuild-community: triggers SpringKg.summarizeNow() to regenerate feature
 *   community summaries. Idempotent — safe to run repeatedly.
 *
 * uninit: deletes .springgraph/springkg.db ONLY. Does NOT touch
 *   .springgraph/springgraph.db (Springgraph's index). The project can be
 *   re-initialized with `springkg init` at any time.
 */

import * as fs from 'fs';
import * as path from 'path';

export async function runRebuildCommunity(projectPath: string): Promise<void> {
  const { SpringKg } = await import('@colbymchenry/springkg-core');
  console.log(`Rebuilding feature community summaries for: ${projectPath}`);
  const sk = await SpringKg.open({ projectPath });
  try {
    const before = (sk.db.getDb().prepare('SELECT COUNT(*) AS c FROM feature_communities').get() as { c: number }).c;
    await sk.summarizeNow();
    const after = (sk.db.getDb().prepare('SELECT COUNT(*) AS c FROM feature_communities').get() as { c: number }).c;
    console.log(`Communities: ${before} → ${after}`);
    console.log('Community summaries regenerated.');
  } finally {
    await sk.close();
  }
}

export async function runUninit(projectPath: string): Promise<void> {
  const dbPath = path.join(projectPath, '.springgraph', 'springkg.db');
  const springgraphDbPath = path.join(projectPath, '.springgraph', 'springgraph.db');

  if (!fs.existsSync(dbPath)) {
    console.log(`No springkg.db found at: ${dbPath}`);
    console.log('Nothing to remove.');
    return;
  }

  fs.unlinkSync(dbPath);
  console.log(`Removed: ${dbPath}`);

  // Also clean up WAL/SHM sidecar files if present
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = dbPath + suffix;
    if (fs.existsSync(sidecar)) {
      fs.unlinkSync(sidecar);
      console.log(`Removed: ${sidecar}`);
    }
  }

  if (fs.existsSync(springgraphDbPath)) {
    console.log(`Preserved: ${springgraphDbPath} (Springgraph index untouched)`);
  } else {
    console.log('No springgraph.db present (Springgraph was never initialized here).');
  }
  console.log('SpringKg uninitialized from project.');
}
