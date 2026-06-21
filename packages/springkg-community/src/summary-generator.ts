import { createHash } from 'node:crypto';

import type { FeatureCommunity, SpringDatabase } from './types.js';

interface DbSymbolRow {
  id: string;
  kind: string;
  name: string | null;
  qualified_name: string | null;
  file_path: string | null;
  start_line: number | null;
  metadata: string | null;
  updated_at: number | null;
}

interface ConfigRow {
  key: string;
  is_sensitive: number;
  source_file_path: string | null;
  source_line: number | null;
}

const KEYWORD_STOPWORDS = new Set([
  'class',
  'method',
  'string',
  'int',
  'long',
  'void',
  'controller',
  'service',
  'mapper',
  'config',
  'java',
  'spring',
  'impl',
  'default',
]);

export class SummaryGenerator {
  generate(community: FeatureCommunity, db: SpringDatabase): string {
    const database = db.getDb();
    const communitiesTable = this.resolveTable(database, 'spring_feature_communities', 'feature_communities');
    const membersTable = this.resolveTable(database, 'spring_feature_community_members', 'feature_community_members');
    const memberIds = this.loadMemberIds(database, membersTable, community);
    const symbols = this.loadSymbols(database, memberIds);
    const keywords = this.extractKeywords(community, symbols);
    const sections = [
      ['Overview', this.buildOverview(community, symbols, keywords)],
      ['Key Endpoints', this.buildEndpoints(database, memberIds)],
      ['Services', this.buildServices(symbols)],
      ['Mappers', this.buildMappers(database, symbols, memberIds)],
      ['Configs', this.buildConfigs(database, memberIds)],
      ['Related Communities', this.buildRelated(database, communitiesTable, membersTable, community, memberIds)],
      ['Recent Changes', this.buildRecent(symbols)],
    ];

    return sections.map(([title, body]) => `## ${title}\n\n${body}`).join('\n\n');
  }

  persist(community: FeatureCommunity, db: SpringDatabase): string {
    const database = db.getDb();
    const communitiesTable = this.resolveTable(database, 'spring_feature_communities', 'feature_communities');
    const summary = this.generate(community, db);
    const keywords = this.extractKeywords(community, this.loadSymbols(database, this.loadMemberIds(database, this.resolveTable(database, 'spring_feature_community_members', 'feature_community_members'), community)));
    const hasKeywordsColumn = this.tableHasColumn(database, communitiesTable, 'keywords');
    const params: unknown[] = [summary, 0, Date.now(), community.id];
    let sql = `UPDATE ${communitiesTable} SET summary = ?, dirty = ?, last_summarized_at = ?`;

    if (hasKeywordsColumn) {
      sql += ', keywords = ?';
      params.splice(3, 0, JSON.stringify(keywords));
    }

    sql += ' WHERE id = ?';
    database.prepare(sql).run(...params);
    return summary;
  }

  private resolveTable(
    db: SpringDatabase['getDb'] extends () => infer T ? T : never,
    preferred: string,
    fallback: string,
  ): string {
    return this.tableExists(db, preferred) ? preferred : fallback;
  }

  private tableExists(db: SpringDatabase['getDb'] extends () => infer T ? T : never, tableName: string): boolean {
    try {
      const row = db.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ? LIMIT 1').get('table', tableName) as { name?: string } | undefined;
      return typeof row?.name === 'string' && row.name.length > 0;
    } catch {
      return false;
    }
  }

  private tableHasColumn(
    db: SpringDatabase['getDb'] extends () => infer T ? T : never,
    tableName: string,
    columnName: string,
  ): boolean {
    try {
      const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>;
      return rows.some((row) => row.name === columnName);
    } catch {
      return false;
    }
  }

  private loadMemberIds(
    db: SpringDatabase['getDb'] extends () => infer T ? T : never,
    membersTable: string,
    community: FeatureCommunity,
  ): string[] {
    if (!this.tableExists(db, membersTable)) {
      return community.memberSpringNodeIds;
    }
    try {
      const rows = db.prepare(`SELECT spring_node_id FROM ${membersTable} WHERE community_id = ? ORDER BY spring_node_id`).all(community.id) as Array<{ spring_node_id: string }>;
      const memberIds = rows.map((row) => row.spring_node_id).filter(Boolean);
      return memberIds.length > 0 ? memberIds : community.memberSpringNodeIds;
    } catch {
      return community.memberSpringNodeIds;
    }
  }

  private loadSymbols(
    db: SpringDatabase['getDb'] extends () => infer T ? T : never,
    memberIds: string[],
  ): DbSymbolRow[] {
    if (memberIds.length === 0 || !this.tableExists(db, 'spring_symbols')) {
      return [];
    }
    const placeholders = memberIds.map(() => '?').join(', ');
    return db.prepare(
      `SELECT id, kind, name, qualified_name, file_path, start_line, metadata, updated_at FROM spring_symbols WHERE id IN (${placeholders}) ORDER BY kind, qualified_name, name`
    ).all(...memberIds) as DbSymbolRow[];
  }

  private buildOverview(community: FeatureCommunity, symbols: DbSymbolRow[], keywords: string[]): string {
    const kinds = this.countBy(symbols, (symbol) => symbol.kind);
    const lines = [
      `- Community: **${community.label}**`,
      `- Members: ${symbols.length || community.memberCount}`,
      `- Dominant package: \`${community.dominantPackage}\``,
      `- Keywords: ${keywords.length > 0 ? keywords.map((keyword) => `\`${keyword}\``).join(', ') : '_none extracted_'}`,
      `- Symbol mix: ${kinds.length > 0 ? kinds.map(([kind, count]) => `${kind}=${count}`).join(', ') : '_no members indexed_'}`,
    ];
    return lines.join('\n');
  }

  private buildEndpoints(
    db: SpringDatabase['getDb'] extends () => infer T ? T : never,
    memberIds: string[],
  ): string {
    if (!this.tableExists(db, 'spring_endpoints')) {
      return '_Unavailable: spring_endpoints table missing._';
    }
    if (memberIds.length === 0) {
      return '_No endpoint members._';
    }
    const placeholders = memberIds.map(() => '?').join(', ');
    const rows = db.prepare(
      `SELECT method, path, source_file_path, source_line FROM spring_endpoints WHERE handler_class_id IN (${placeholders}) OR handler_method_id IN (${placeholders}) ORDER BY method, path LIMIT 10`
    ).all(...memberIds, ...memberIds) as Array<{ method: string; path: string; source_file_path: string | null; source_line: number | null }>;

    if (rows.length === 0) {
      return '_No endpoints found for this community._';
    }
    return rows.map((row) => `- \`${row.method} ${row.path}\` — ${this.location(row.source_file_path, row.source_line)}`).join('\n');
  }

  private buildServices(symbols: DbSymbolRow[]): string {
    const serviceKinds = new Set(['controller', 'service', 'feign_client', 'component']);
    const rows = symbols.filter((symbol) => serviceKinds.has(symbol.kind)).slice(0, 10);
    if (rows.length === 0) {
      return '_No services, controllers, or Feign clients found._';
    }
    return rows.map((row) => `- **${row.kind}** \`${row.qualified_name ?? row.name ?? row.id}\` — ${this.location(row.file_path, row.start_line)}`).join('\n');
  }

  private buildMappers(
    db: SpringDatabase['getDb'] extends () => infer T ? T : never,
    symbols: DbSymbolRow[],
    memberIds: string[],
  ): string {
    const mapperSymbols = symbols.filter((symbol) => symbol.kind === 'mapper' || symbol.kind === 'mapper_method');
    const lines = mapperSymbols.map((symbol) => `- **${symbol.kind}** \`${symbol.qualified_name ?? symbol.name ?? symbol.id}\` — ${this.location(symbol.file_path, symbol.start_line)}`);

    if (this.tableExists(db, 'spring_sql_statements') && memberIds.length > 0) {
      const placeholders = memberIds.map(() => '?').join(', ');
      const sqlRows = db.prepare(
        `SELECT mapper_id, sql_text, tables, source_file_path, source_line FROM spring_sql_statements WHERE mapper_id IN (${placeholders}) ORDER BY mapper_id LIMIT 10`
      ).all(...memberIds) as Array<{ mapper_id: string; sql_text: string; tables: string | null; source_file_path: string | null; source_line: number | null }>;
      for (const row of sqlRows) {
        const tables = this.parseJsonArray(row.tables);
        const preview = row.sql_text.replace(/\s+/g, ' ').trim().slice(0, 80);
        lines.push(`- SQL \`${preview}\`${tables.length > 0 ? ` — tables: ${tables.map((table) => `\`${table}\``).join(', ')}` : ''} — ${this.location(row.source_file_path, row.source_line)}`);
      }
    }

    return lines.length > 0 ? lines.join('\n') : '_No mapper or SQL artifacts found._';
  }

  private buildConfigs(
    db: SpringDatabase['getDb'] extends () => infer T ? T : never,
    memberIds: string[],
  ): string {
    if (!this.tableExists(db, 'runtime_config_properties')) {
      return '_Unavailable: runtime_config_properties table missing._';
    }
    if (!this.tableExists(db, 'spring_edges')) {
      return '_Unavailable: spring_edges table missing._';
    }
    if (memberIds.length === 0) {
      return '_No community members to match against config usage._';
    }
    const placeholders = memberIds.map(() => '?').join(', ');
    const rows = db.prepare(
      `SELECT DISTINCT p.key, p.is_sensitive, p.source_file_path, p.source_line
       FROM runtime_config_properties p
       JOIN spring_edges e ON e.source_id = p.id
       WHERE e.kind = 'USED_BY' AND e.target_id IN (${placeholders})
       ORDER BY p.key LIMIT 10`
    ).all(...memberIds) as ConfigRow[];
    if (rows.length === 0) {
      return '_No config properties linked to this community._';
    }
    return rows.map((row) => `- \`${row.key}\` — ${this.location(row.source_file_path, row.source_line)}${row.is_sensitive ? ' — value: `***`' : ''}`).join('\n');
  }

  private buildRelated(
    db: SpringDatabase['getDb'] extends () => infer T ? T : never,
    communitiesTable: string,
    membersTable: string,
    community: FeatureCommunity,
    memberIds: string[],
  ): string {
    if (!this.tableExists(db, communitiesTable) || !this.tableExists(db, membersTable) || !this.tableExists(db, 'spring_edges')) {
      return '_Unavailable: community linkage tables missing._';
    }
    if (memberIds.length === 0) {
      return '_No related communities._';
    }
    const placeholders = memberIds.map(() => '?').join(', ');
    const rows = db.prepare(
      `SELECT fc.id, fc.label, COUNT(*) AS edge_count
       FROM ${membersTable} other_members
       JOIN ${communitiesTable} fc ON fc.id = other_members.community_id
       JOIN spring_edges e ON (
         (e.source_id IN (${placeholders}) AND e.target_id = other_members.spring_node_id)
         OR
         (e.target_id IN (${placeholders}) AND e.source_id = other_members.spring_node_id)
       )
       WHERE other_members.community_id <> ?
       GROUP BY fc.id, fc.label
       ORDER BY edge_count DESC, fc.label ASC
       LIMIT 5`
    ).all(...memberIds, ...memberIds, community.id) as Array<{ id: string; label: string; edge_count: number }>;

    if (rows.length === 0) {
      return '_No related communities found._';
    }
    return rows.map((row) => `- \`${row.label}\` — ${row.edge_count} cross-community edge(s)`).join('\n');
  }

  private buildRecent(symbols: DbSymbolRow[]): string {
    const recent = symbols
      .filter((symbol) => typeof symbol.updated_at === 'number' && symbol.updated_at > 0)
      .sort((left, right) => (right.updated_at ?? 0) - (left.updated_at ?? 0))
      .slice(0, 5);

    if (recent.length === 0) {
      return '_No recent symbol timestamps recorded._';
    }
    return recent.map((row) => `- \`${row.qualified_name ?? row.name ?? row.id}\` — updated ${new Date(row.updated_at ?? 0).toISOString()}`).join('\n');
  }

  private extractKeywords(community: FeatureCommunity, symbols: DbSymbolRow[]): string[] {
    const frequency = new Map<string, number>();
    const texts = [community.label, community.dominantPackage, ...symbols.flatMap((symbol) => [symbol.name ?? '', symbol.qualified_name ?? '', this.metadataText(symbol.metadata)])];

    for (const text of texts) {
      for (const token of this.tokenize(text)) {
        frequency.set(token, (frequency.get(token) ?? 0) + 1);
      }
    }

    return [...frequency.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 5)
      .map(([token]) => token);
  }

  private tokenize(text: string): string[] {
    return text
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .split(/[^a-zA-Z0-9]+/g)
      .map((token) => token.toLowerCase())
      .filter((token) => token.length >= 3 && !KEYWORD_STOPWORDS.has(token));
  }

  private metadataText(metadata: string | null): string {
    if (!metadata) {
      return '';
    }
    try {
      const parsed = JSON.parse(metadata) as unknown;
      return typeof parsed === 'object' ? JSON.stringify(parsed) : String(parsed);
    } catch {
      return metadata;
    }
  }

  private parseJsonArray(raw: string | null): string[] {
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
    } catch {
      return [];
    }
  }

  private countBy<T>(items: T[], select: (item: T) => string): Array<[string, number]> {
    const counts = new Map<string, number>();
    for (const item of items) {
      const key = select(item);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  }

  private location(filePath: string | null, startLine: number | null): string {
    if (!filePath) {
      return 'unknown location';
    }
    return startLine ? `${filePath}:${startLine}` : filePath;
  }

  digestKeywordSignature(keywords: string[]): string {
    return createHash('sha256').update(JSON.stringify(keywords)).digest('hex');
  }
}
