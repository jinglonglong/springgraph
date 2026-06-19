import { SPRINGKG_CONFIG } from '@colbymchenry/springkg-shared';

import { SpringDatabase } from '../db/spring-db.js';

interface CommunityRow {
  id: string;
  label: string;
}

interface StatementLike<TRow = unknown> {
  all(...params: unknown[]): TRow[];
  run(...params: unknown[]): unknown;
}

interface SqliteLike {
  prepare<TRow = unknown>(sql: string): StatementLike<TRow>;
}

export class SummaryGenerator {
  private intervalHandle?: ReturnType<typeof setInterval>;

  constructor(private db: SpringDatabase) {}

  start(): void {
    if (this.intervalHandle) {
      return;
    }

    this.intervalHandle = setInterval(() => {
      void this.regenerateIfDirty();
    }, SPRINGKG_CONFIG.summaryRegeneration.intervalMs);
  }

  stop(): void {
    if (!this.intervalHandle) {
      return;
    }

    clearInterval(this.intervalHandle);
    this.intervalHandle = undefined;
  }

  async regenerateIfDirty(): Promise<void> {
    await this.regenerate({ dirtyOnly: true });
  }

  async regenerateNow(): Promise<void> {
    await this.regenerate({ dirtyOnly: false });
  }

  private async regenerate(options: { dirtyOnly: boolean }): Promise<void> {
    try {
      const communities = this.getCommunities(options.dirtyOnly);

      for (const community of communities) {
        try {
          const summary = this.summarize(community);
          const now = Date.now();

          this.getSqliteDb()
            .prepare(
              'UPDATE feature_communities SET summary = ?, dirty = 0, last_summarized_at = ? WHERE id = ?',
            )
            .run(summary, now, community.id);
        } catch (error) {
          console.error(
            `[springkg] Failed to summarize feature community ${community.id}`,
            error,
          );
        }
      }
    } catch (error) {
      console.error('[springkg] Failed to regenerate community summaries', error);
    }
  }

  private getCommunities(dirtyOnly: boolean): CommunityRow[] {
    const sql = dirtyOnly
      ? 'SELECT id, label FROM feature_communities WHERE dirty = 1'
      : 'SELECT id, label FROM feature_communities';

    return this.getSqliteDb().prepare<CommunityRow>(sql).all();
  }

  private getSqliteDb(): SqliteLike {
    return this.db.getDb() as SqliteLike;
  }

  private summarize(_community: { id: string; label: string }): string {
    return '(summary pending)';
  }
}
