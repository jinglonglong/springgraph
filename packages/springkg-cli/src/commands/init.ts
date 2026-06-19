/**
 * `springkg init` — initialize the springkg.db for a project.
 *
 * Creates .codegraph/springkg.db and applies the schema. Does NOT run the
 * indexer — that is a separate `springkg index` step (matches upstream
 * codegraph CLI behavior).
 */

export async function runInit(projectPath: string): Promise<void> {
  const { SpringKg } = await import('@colbymchenry/springkg-core');
  console.log(`Initializing SpringKg at: ${projectPath}`);
  const sk = await SpringKg.init({ projectPath });
  await sk.close();
  console.log('SpringKg initialized successfully.');
}
