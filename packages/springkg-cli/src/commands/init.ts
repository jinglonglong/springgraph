/**
 * `springkg init` — initialize the springkg.db for a project.
 *
 * Creates .springgraph/springkg.db and applies the schema. Does NOT run the
 * indexer — that is a separate `springkg index` step (matches upstream
 * springgraph CLI behavior).
 */

export async function runInit(projectPath: string): Promise<void> {
  const { SpringDatabase, SpringKg } = await import('@colbymchenry/springkg-core');
  console.log(`Initializing SpringKg at: ${projectPath}`);
  const dbPath = SpringDatabase.initializeDatabase(projectPath);
  console.log(`SpringKg database initialized at: ${dbPath}`);
  const sk = await SpringKg.init({ projectPath });
  await sk.close();
  console.log('SpringKg initialized successfully.');
}
