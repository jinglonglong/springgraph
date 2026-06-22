/**
 * `springkg watch` — watch the project for file changes and auto-sync.
 *
 * Wraps SpringKg.watch(), which delegates to Springgraph's native file watcher
 * (FSEvents / inotify / ReadDirectoryChangesW). On every sync, runs the
 * registered resolvers via enhanceOnSync().
 *
 * Graceful shutdown:
 *   - SIGINT  (Ctrl+C, POSIX + Windows console)
 *   - SIGBREAK (Ctrl+Break, Windows)
 * Closes the DB and exits with code 0.
 */

export async function runWatch(projectPath: string): Promise<void> {
  const { SpringKg } = await import('@jinglonglong/springkg-core');
  console.log(`Watching project at: ${projectPath}`);
  console.log('Press Ctrl+C to stop.');

  const sk = await SpringKg.open({ projectPath });

  const started = sk.watch({
    onSyncComplete: (result) => {
      console.log(`[springkg] sync: ${result.filesChanged} files in ${result.durationMs}ms`);
    },
  });

  if (!started) {
    console.error('Failed to start file watcher.');
    await sk.close();
    process.exit(1);
  }

  let stopped = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopped) return;
    stopped = true;
    console.log(`\n[springkg] received ${signal}, stopping watcher...`);
    try {
      sk.unwatch();
      await sk.close();
    } catch (err) {
      console.error('Error during shutdown:', err);
    }
    console.log('[springkg] watch stopped.');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  // SIGBREAK is Windows-only (Ctrl+Break). On POSIX it's undefined.
  const signals = process.listeners('SIGBREAK');
  if (signals.length === 0) {
    process.on('SIGBREAK', () => void shutdown('SIGBREAK'));
  }

  // Keep the event loop alive. The watcher handles real work; this just
  // prevents Node from exiting on an otherwise empty event loop.
  await new Promise<void>((resolve) => {
    // never resolves — exit is handled by signal handlers
    void resolve;
  });
}
