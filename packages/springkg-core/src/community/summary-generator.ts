import { SPRINGKG_CONFIG } from '@jinglonglong/springkg-shared';
import type { SpringDatabase } from '../db/spring-db.js';

type SummarizeHook = (community: { id: string; label: string; memberCount: number }) => string;
type CommunityRow = { id: string; label: string; member_count: number };

const defaultSummarize: SummarizeHook = (c) => `(summary pending — ${c.memberCount} members)`;

export class SummaryGenerator {
  private timer: ReturnType<typeof setInterval> | null = null;
  private summarizeFn: SummarizeHook;

  constructor(
    private db: SpringDatabase,
    summarize?: SummarizeHook,
  ) {
    this.summarizeFn = summarize ?? defaultSummarize;
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      this.regenerateIfDirty().catch((err) => {
        console.error('[springkg] SummaryGenerator timer error:', err);
      });
    }, SPRINGKG_CONFIG.summaryRegeneration.intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async regenerateIfDirty(): Promise<void> {
    const db = this.db.getDb();
    try {
      const dirty = db.prepare(
        'SELECT id, label, member_count FROM feature_communities WHERE dirty = 1'
      ).all() as CommunityRow[];

      for (const community of dirty) {
        try {
          const summary = this.summarizeFn({
            id: community.id,
            label: community.label,
            memberCount: community.member_count,
          });
          db.prepare(
            'UPDATE feature_communities SET summary = ?, dirty = 0, last_summarized_at = ? WHERE id = ?'
          ).run(summary, Date.now(), community.id);
        } catch (err) {
          console.error(`[springkg] Failed to summarize community ${community.id}:`, err);
        }
      }
    } catch (err) {
      console.error('[springkg] Failed to query dirty communities:', err);
    }
  }

  async regenerateNow(): Promise<void> {
    const db = this.db.getDb();
    try {
      const all = db.prepare(
        'SELECT id, label, member_count FROM feature_communities'
      ).all() as CommunityRow[];

      for (const community of all) {
        try {
          const summary = this.summarizeFn({
            id: community.id,
            label: community.label,
            memberCount: community.member_count,
          });
          db.prepare(
            'UPDATE feature_communities SET summary = ?, dirty = 0, last_summarized_at = ? WHERE id = ?'
          ).run(summary, Date.now(), community.id);
        } catch (err) {
          console.error(`[springkg] Failed to summarize community ${community.id}:`, err);
        }
      }
    } catch (err) {
      console.error('[springkg] Failed to query communities:', err);
    }
  }
}
