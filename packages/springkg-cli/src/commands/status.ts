/**
 * `springkg status` — show statistics about the indexed project.
 *
 * Reports:
 *   - Symbol count (spring_symbols)
 *   - Edge count (spring_edges)
 *   - Endpoint count (spring_endpoints)
 *   - Feign client count (spring_feign_clients)
 *   - Sensitive config count (runtime_config_properties WHERE is_sensitive=1)
 *   - Feature community count (feature_communities)
 */

export async function runStatus(projectPath: string): Promise<void> {
  const { SpringKg } = await import('@colbymchenry/springkg-core');
  const sk = await SpringKg.open({ projectPath });
  try {
    const db = sk.db.getDb();
    const safeCount = (sql: string): number => {
      try {
        const row = db.prepare(sql).get() as { count: number } | undefined;
        return row?.count ?? 0;
      } catch {
        return 0;
      }
    };

    const symbols = safeCount('SELECT COUNT(*) AS count FROM spring_symbols');
    const edges = safeCount('SELECT COUNT(*) AS count FROM spring_edges');
    const endpoints = safeCount('SELECT COUNT(*) AS count FROM spring_endpoints');
    const feignClients = safeCount('SELECT COUNT(*) AS count FROM spring_feign_clients');
    const sensitiveConfigs = safeCount('SELECT COUNT(*) AS count FROM runtime_config_properties WHERE is_sensitive = 1');
    const communities = safeCount('SELECT COUNT(*) AS count FROM feature_communities');

    console.log(`SpringKg status for: ${projectPath}`);
    console.log(`  Symbols: ${symbols}`);
    console.log(`  Edges: ${edges}`);
    console.log(`  Endpoints: ${endpoints}`);
    console.log(`  Feign clients: ${feignClients}`);
    console.log(`  Sensitive configs: ${sensitiveConfigs}`);
    console.log(`  Feature communities: ${communities}`);
  } finally {
    await sk.close();
  }
}
