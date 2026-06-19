/**
 * `springkg index` — run the indexer to build the knowledge graph.
 *
 * Opens the existing springkg.db, runs CodeGraph.indexAll(), then runs all
 * registered resolvers via enhanceOnSync(). Reports indexed file count and
 * the number of resolver stages that produced output.
 */

export async function runIndex(projectPath: string): Promise<void> {
  const { SpringKg } = await import('@colbymchenry/springkg-core');
  console.log(`Indexing project at: ${projectPath}`);
  const sk = await SpringKg.open({ projectPath });
  try {
    const result = await sk.index();
    console.log(`Indexed ${result.indexed} files.`);
    console.log(`Enhanced with ${result.enhanced.length} resolver stages.`);
  } finally {
    await sk.close();
  }
}
