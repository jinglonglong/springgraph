import { createHash } from 'node:crypto';

import { CommunityBuilder } from './community-builder.js';
import { SummaryGenerator } from './summary-generator.js';
import type { BuildOptions, GraphLoader, SpringDatabase } from './types.js';

interface DirtyQueueOptions {
  db: SpringDatabase;
  graphLoader: GraphLoader;
  builder?: CommunityBuilder;
  summaryGenerator?: SummaryGenerator;
  buildOptions?: BuildOptions;
  throttleMs?: number;
  now?: () => number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

export class DirtyQueue {
  private readonly dirtyFiles = new Set<string>();
  private readonly builder: CommunityBuilder;
  private readonly summaryGenerator: SummaryGenerator;
  private readonly throttleMs: number;
  private readonly now: () => number;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastFlushAt = 0;
  private inFlight: Promise<number> | null = null;

  constructor(private readonly options: DirtyQueueOptions) {
    this.builder = options.builder ?? new CommunityBuilder();
    this.summaryGenerator = options.summaryGenerator ?? new SummaryGenerator();
    this.throttleMs = options.throttleMs ?? 60_000;
    this.now = options.now ?? Date.now;
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  }

  markDirty(filePath: string): void {
    if (filePath.trim().length === 0) {
      return;
    }
    this.dirtyFiles.add(filePath);
    this.scheduleFlush();
  }

  markByFiles(filePaths: string[]): void {
    for (const filePath of filePaths) {
      this.markDirty(filePath);
    }
  }

  scheduleFlush(): void {
    if (this.timer !== null || this.dirtyFiles.size === 0) {
      return;
    }
    const elapsed = this.now() - this.lastFlushAt;
    const delay = Math.max(0, this.throttleMs - elapsed);
    this.timer = this.setTimeoutFn(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }

  async flush(): Promise<number> {
    if (this.timer !== null) {
      this.clearTimeoutFn(this.timer);
      this.timer = null;
    }
    if (this.inFlight) {
      return this.inFlight;
    }
    if (this.dirtyFiles.size === 0) {
      return 0;
    }

    const pendingFiles = [...this.dirtyFiles];
    this.dirtyFiles.clear();
    this.lastFlushAt = this.now();
    this.inFlight = this.persistCommunities(pendingFiles).finally(() => {
      this.inFlight = null;
      if (this.dirtyFiles.size > 0) {
        this.scheduleFlush();
      }
    });

    return this.inFlight;
  }

  cancel(): void {
    if (this.timer !== null) {
      this.clearTimeoutFn(this.timer);
      this.timer = null;
    }
    this.dirtyFiles.clear();
  }

  private async persistCommunities(_pendingFiles: string[]): Promise<number> {
    const { nodes, edges } = await this.options.graphLoader();
    const communities = this.builder.build(nodes, edges, this.options.buildOptions);
    const db = this.options.db.getDb();
    const communitiesTable = this.resolveTable(db, 'spring_feature_communities', 'feature_communities');
    const membersTable = this.resolveTable(db, 'spring_feature_community_members', 'feature_community_members');
    const hasKeywordsColumn = this.tableHasColumn(db, communitiesTable, 'keywords');

    for (const community of communities) {
      const summary = this.summaryGenerator.generate(community, this.options.db);
      const keywords = this.extractKeywordsFromSummary(summary);
      if (hasKeywordsColumn) {
        db.prepare(
          `INSERT OR IGNORE INTO ${communitiesTable} (id, label, summary, member_count, dirty, last_summarized_at, keywords) VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(community.id, community.label, summary, community.memberCount, 0, this.now(), JSON.stringify(keywords));
      } else {
        db.prepare(
          `INSERT OR IGNORE INTO ${communitiesTable} (id, label, summary, member_count, dirty, last_summarized_at) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(community.id, community.label, summary, community.memberCount, 0, this.now());
      }

      db.prepare(
        `UPDATE ${communitiesTable} SET summary = ?, member_count = ?, dirty = ?, last_summarized_at = ? WHERE id = ?`
      ).run(summary, community.memberCount, 0, this.now(), community.id);

      for (const memberId of community.memberSpringNodeIds) {
        db.prepare(
          `INSERT OR IGNORE INTO ${membersTable} (id, community_id, spring_node_id, membership_score) VALUES (?, ?, ?, ?)`
        ).run(this.memberId(community.id, memberId), community.id, memberId, 1);
      }
    }

    return communities.length;
  }

  private extractKeywordsFromSummary(summary: string): string[] {
    const match = summary.match(/Keywords:\s+(.+)/i);
    if (!match) {
      return [];
    }
    const keywordText = match[1];
    if (!keywordText) {
      return [];
    }
    return keywordText
      .split(',')
      .map((value) => value.replace(/[`*_]/g, '').trim())
      .filter((value) => value.length > 0)
      .slice(0, 5);
  }

  private resolveTable(db: ReturnType<SpringDatabase['getDb']>, preferred: string, fallback: string): string {
    return this.tableExists(db, preferred) ? preferred : fallback;
  }

  private tableExists(db: ReturnType<SpringDatabase['getDb']>, tableName: string): boolean {
    try {
      const row = db.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ? LIMIT 1').get('table', tableName) as { name?: string } | undefined;
      return typeof row?.name === 'string' && row.name.length > 0;
    } catch {
      return false;
    }
  }

  private tableHasColumn(db: ReturnType<SpringDatabase['getDb']>, tableName: string, columnName: string): boolean {
    try {
      const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>;
      return rows.some((row) => row.name === columnName);
    } catch {
      return false;
    }
  }

  private memberId(communityId: string, memberId: string): string {
    return `feature_community_member:${createHash('sha256').update(`${communityId}|${memberId}`).digest('hex').slice(0, 16)}`;
  }
}
