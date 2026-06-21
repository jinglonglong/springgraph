import * as path from 'path';
import * as fs from 'fs';
import { createHash } from 'crypto';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export interface CodeGraphNodeRow {
  id: string;
  kind: string;
  name: string;
  qualified_name: string;
  file_path: string;
  language: string;
  start_line: number;
  end_line: number;
  signature?: string | null;
  decorators?: string | null;
}

export interface CodeGraphEdgeRow {
  source: string;
  target: string;
  kind: string;
}

export interface CodeGraphContext {
  nodesByQualifiedName: Map<string, CodeGraphNodeRow>;
  nodesByFileAndName: Map<string, CodeGraphNodeRow>;
  edges: CodeGraphEdgeRow[];
  hasData: boolean;
}

export interface SeedSymbol {
  id: string;
  kind: string;
  codegraphNodeId: string;
  name: string;
  qualifiedName: string;
  filePath: string;
  startLine: number;
  endLine: number;
  metadata?: Record<string, unknown>;
}

export interface SeedEdge {
  sourceId: string;
  targetId: string;
  kind: string;
  metadata?: Record<string, unknown>;
}

export interface SeedEndpoint {
  id: string;
  method: string;
  path: string;
  handlerClassId: string;
  handlerMethodId: string;
  sourceFilePath: string;
  sourceLine: number;
}

export interface SeedFeignClient {
  id: string;
  clientName: string;
  targetService: string;
  targetUrl: string | null;
  methodCount: number;
}

export interface SeedSqlStatement {
  id: string;
  mapperId: string;
  sqlHash: string;
  sqlText: string;
  parameterCount: number;
  tables: string[];
  sourceFilePath: string;
  sourceLine: number;
}

export interface SeedConfigProperty {
  id: string;
  key: string;
  valueHash: string;
  isSensitive: number;
  sourceFilePath: string;
  sourceLine: number;
  beanId: string | null;
}

export interface SeedCommunity {
  id: string;
  label: string;
  summary: string;
  memberCount: number;
  dirty: number;
  lastSummarizedAt: number | null;
}

export interface SeedCommunityMember {
  id: string;
  communityId: string;
  springNodeId: string;
  membershipScore: number;
}

export interface ParsedMethod {
  name: string;
  qualifiedName: string;
  symbolKind: string;
  startLine: number;
  endLine: number;
  annotations: string[];
  annotationMap: Map<string, string>;
  body: string;
  metadata?: Record<string, unknown>;
}

export interface ParsedType {
  packageName: string;
  className: string;
  qualifiedName: string;
  filePath: string;
  classKind: string;
  startLine: number;
  endLine: number;
  classAnnotations: string[];
  classAnnotationMap: Map<string, string>;
  fieldTypes: Map<string, string>;
  methods: ParsedMethod[];
}

export interface SeedBundle {
  symbols: SeedSymbol[];
  edges: SeedEdge[];
  endpoints: SeedEndpoint[];
  feignClients: SeedFeignClient[];
  sqlStatements: SeedSqlStatement[];
  configProperties: SeedConfigProperty[];
  communities: SeedCommunity[];
  communityMembers: SeedCommunityMember[];
}

export interface SeedResult {
  symbols: number;
  edges: number;
  endpoints: number;
  feignClients: number;
  sqlStatements: number;
  configProperties: number;
}

export class SpringkgSeeder {
  private db: any = null;
  private projectPath: string = '';

  async seed(db: any, codegraph: any): Promise<SeedResult> {
    this.db = db;
    this.projectPath = typeof codegraph === 'string'
      ? codegraph
      : (codegraph.getProjectRoot ? codegraph.getProjectRoot() : (codegraph.projectPath || codegraph.projectRoot || ''));

    const counts = this.getSeedTableCounts();
    const needsSeed = Object.values(counts).some((count) => count === 0);
    if (!needsSeed) {
      return {
        symbols: counts['spring_symbols'] || 0,
        edges: counts['spring_edges'] || 0,
        endpoints: counts['spring_endpoints'] || 0,
        feignClients: counts['spring_feign_clients'] || 0,
        sqlStatements: counts['spring_sql_statements'] || 0,
        configProperties: counts['runtime_config_properties'] || 0,
      };
    }

    const codeGraphContext = this.loadCodeGraphContext(codegraph);
    const seedBundle = this.buildSeedBundle(codeGraphContext);
    if (seedBundle.symbols.length === 0 && seedBundle.endpoints.length === 0 && seedBundle.configProperties.length === 0) {
      return {
        symbols: 0,
        edges: 0,
        endpoints: 0,
        feignClients: 0,
        sqlStatements: 0,
        configProperties: 0,
      };
    }

    db.exec('BEGIN');
    try {
      this.clearSeedTables();
      const symbolsCount = this.seedSymbols(db, seedBundle);
      const edgesCount = this.seedEdges(db, seedBundle);
      const endpointsCount = this.seedEndpoints(db, seedBundle);
      const feignCount = this.seedFeignClients(db, seedBundle);
      const sqlCount = this.seedSqlStatements(db, seedBundle);
      const configCount = this.seedConfigProperties(db, seedBundle);
      this.seedCommunities(db, seedBundle);
      db.exec('COMMIT');

      return {
        symbols: symbolsCount,
        edges: edgesCount,
        endpoints: endpointsCount,
        feignClients: feignCount,
        sqlStatements: sqlCount,
        configProperties: configCount,
      };
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  loadCodeGraphContext(codegraph: any): CodeGraphContext {
    const projectRoot = typeof codegraph === 'string'
      ? codegraph
      : (codegraph.getProjectRoot ? codegraph.getProjectRoot() : (codegraph.projectPath || codegraph.projectRoot || ''));
    const emptyContext: CodeGraphContext = {
      nodesByQualifiedName: new Map(),
      nodesByFileAndName: new Map(),
      edges: [],
      hasData: false,
    };
    const codeGraphDbPath = path.join(projectRoot, '.codegraph', 'codegraph.db');
    if (!fs.existsSync(codeGraphDbPath)) {
      return emptyContext;
    }

    let codeGraphDb: any = null;
    try {
      const { DatabaseSync } = require('node:sqlite');
      codeGraphDb = new DatabaseSync(codeGraphDbPath);
      const nodes = codeGraphDb.prepare(`
        SELECT id, kind, name, qualified_name, file_path, language, start_line, end_line, signature, decorators
        FROM nodes
        WHERE language IN ('java', 'xml', 'yaml', 'yml')
      `).all() as CodeGraphNodeRow[];
      if (nodes.length === 0) {
        return emptyContext;
      }

      const nodeIds = nodes.map((node) => node.id);
      const placeholders = nodeIds.map(() => '?').join(', ');
      const edges = nodeIds.length > 0
        ? codeGraphDb.prepare(`
            SELECT source, target, kind
            FROM edges
            WHERE kind IN ('calls', 'contains') AND source IN (${placeholders}) AND target IN (${placeholders})
          `).all(...nodeIds, ...nodeIds) as CodeGraphEdgeRow[]
        : [];

      const nodesByQualifiedName = new Map<string, CodeGraphNodeRow>();
      const nodesByFileAndName = new Map<string, CodeGraphNodeRow>();
      for (const node of nodes) {
        nodesByQualifiedName.set(node.qualified_name, node);
        nodesByFileAndName.set(this.makeFileNameKey(node.file_path, node.name), node);
      }

      return {
        nodesByQualifiedName,
        nodesByFileAndName,
        edges,
        hasData: true,
      };
    } catch {
      return emptyContext;
    } finally {
      if (codeGraphDb) {
        codeGraphDb.close();
      }
    }
  }

  seedSymbols(db: any, ctx: SeedBundle): number {
    const now = Date.now();
    const insertSymbol = db.prepare(`
      INSERT INTO spring_symbols (
        id, kind, codegraph_node_id, name, qualified_name, file_path, start_line, end_line, metadata, confidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const symbol of ctx.symbols) {
      insertSymbol.run(
        symbol.id,
        symbol.kind,
        symbol.codegraphNodeId,
        symbol.name,
        symbol.qualifiedName,
        symbol.filePath,
        symbol.startLine,
        symbol.endLine,
        symbol.metadata ? JSON.stringify(symbol.metadata) : null,
        1,
        now,
        now,
      );
    }
    return ctx.symbols.length;
  }

  seedEdges(db: any, ctx: SeedBundle): number {
    const now = Date.now();
    const insertEdge = db.prepare(`
      INSERT INTO spring_edges (id, source_id, target_id, kind, metadata, confidence, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const edge of ctx.edges) {
      insertEdge.run(
        this.makeSeedId('edge', `${edge.kind}:${edge.sourceId}:${edge.targetId}`),
        edge.sourceId,
        edge.targetId,
        edge.kind,
        edge.metadata ? JSON.stringify(edge.metadata) : null,
        1,
        now,
      );
    }
    return ctx.edges.length;
  }

  seedEndpoints(db: any, ctx: SeedBundle): number {
    const insertEndpoint = db.prepare(`
      INSERT INTO spring_endpoints (id, method, path, handler_class_id, handler_method_id, source_file_path, source_line)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const endpoint of ctx.endpoints) {
      insertEndpoint.run(
        endpoint.id,
        endpoint.method,
        endpoint.path,
        endpoint.handlerClassId,
        endpoint.handlerMethodId,
        endpoint.sourceFilePath,
        endpoint.sourceLine,
      );
    }
    return ctx.endpoints.length;
  }

  seedFeignClients(db: any, ctx: SeedBundle): number {
    const insertFeign = db.prepare(`
      INSERT INTO spring_feign_clients (id, client_name, target_service, target_url, method_count)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const feign of ctx.feignClients) {
      insertFeign.run(feign.id, feign.clientName, feign.targetService, feign.targetUrl, feign.methodCount);
    }
    return ctx.feignClients.length;
  }

  seedSqlStatements(db: any, ctx: SeedBundle): number {
    const insertSql = db.prepare(`
      INSERT INTO spring_sql_statements (id, mapper_id, sql_hash, sql_text, parameter_count, tables, source_file_path, source_line)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const statement of ctx.sqlStatements) {
      insertSql.run(
        statement.id,
        statement.mapperId,
        statement.sqlHash,
        statement.sqlText,
        statement.parameterCount,
        JSON.stringify(statement.tables),
        statement.sourceFilePath,
        statement.sourceLine,
      );
    }
    return ctx.sqlStatements.length;
  }

  seedConfigProperties(db: any, ctx: SeedBundle): number {
    const insertConfig = db.prepare(`
      INSERT INTO runtime_config_properties (id, key, value_hash, is_sensitive, source_file_path, source_line, bean_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const property of ctx.configProperties) {
      insertConfig.run(
        property.id,
        property.key,
        property.valueHash,
        property.isSensitive,
        property.sourceFilePath,
        property.sourceLine,
        property.beanId,
      );
    }
    return ctx.configProperties.length;
  }

  seedCommunities(db: any, ctx: SeedBundle): number {
    let count = 0;
    if (this.tableExists('feature_communities')) {
      const insertCommunity = db.prepare(`
        INSERT INTO feature_communities (id, label, summary, member_count, dirty, last_summarized_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const community of ctx.communities) {
        insertCommunity.run(
          community.id,
          community.label,
          community.summary,
          community.memberCount,
          community.dirty,
          community.lastSummarizedAt,
        );
      }
      count += ctx.communities.length;
    }

    if (this.tableExists('feature_community_members')) {
      const insertMember = db.prepare(`
        INSERT INTO feature_community_members (id, community_id, spring_node_id, membership_score)
        VALUES (?, ?, ?, ?)
      `);
      for (const member of ctx.communityMembers) {
        insertMember.run(member.id, member.communityId, member.springNodeId, member.membershipScore);
      }
      count += ctx.communityMembers.length;
    }
    return count;
  }

  private getSeedTableCounts(): Record<string, number> {
    const tableNames = [
      'spring_symbols',
      'spring_edges',
      'spring_endpoints',
      'spring_feign_clients',
      'spring_sql_statements',
      'runtime_config_properties',
    ];

    const counts: Record<string, number> = {};
    for (const tableName of tableNames) {
      if (!this.tableExists(tableName)) {
        counts[tableName] = 0;
        continue;
      }

      const row = this.db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get() as { count?: number } | undefined;
      counts[tableName] = Number(row?.count ?? 0);
    }

    return counts;
  }

  private clearSeedTables(): void {
    const tableNames = [
      'feature_community_members',
      'feature_communities',
      'runtime_config_properties',
      'spring_sql_statements',
      'spring_feign_clients',
      'spring_endpoints',
      'spring_edges',
      'spring_symbols',
    ];

    for (const tableName of tableNames) {
      if (this.tableExists(tableName)) {
        this.db.exec(`DELETE FROM ${tableName}`);
      }
    }
  }

  private tableExists(tableName: string): boolean {
    if (!this.db) {
      return false;
    }

    try {
      const row = this.db.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
      ).get(tableName) as Record<string, unknown> | undefined;
      return Boolean(row?.name);
    } catch {
      return false;
    }
  }

  private buildSeedBundle(codeGraphContext: CodeGraphContext): SeedBundle {
    const javaFiles = this.findFiles(this.projectPath, (filePath) => filePath.endsWith('.java'));
    const xmlFiles = this.findFiles(this.projectPath, (filePath) => filePath.endsWith('.xml'));
    const configFiles = this.findFiles(this.projectPath, (filePath) => /\.(ya?ml|properties)$/i.test(filePath));
    const parsedTypes = javaFiles.map((filePath) => this.parseJavaFile(filePath)).filter((item): item is ParsedType => item !== null);

    const symbols: SeedSymbol[] = [];
    const edges: SeedEdge[] = [];
    const endpoints: SeedEndpoint[] = [];
    const feignClients: SeedFeignClient[] = [];
    const sqlStatements: SeedSqlStatement[] = [];
    const configProperties: SeedConfigProperty[] = [];
    const communities: SeedCommunity[] = [];
    const communityMembers: SeedCommunityMember[] = [];

    const symbolByQualifiedName = new Map<string, SeedSymbol>();
    const symbolByTypeName = new Map<string, SeedSymbol>();
    const typeByQualifiedName = new Map<string, ParsedType>();

    for (const parsedType of parsedTypes) {
      typeByQualifiedName.set(parsedType.qualifiedName, parsedType);

      if (parsedType.classKind !== 'plain') {
        const classSymbol = this.createSeedSymbol(
          parsedType.classKind,
          parsedType.className,
          parsedType.qualifiedName,
          parsedType.filePath,
          parsedType.startLine,
          parsedType.endLine,
          codeGraphContext,
          {
            annotations: parsedType.classAnnotations,
          },
        );
        symbols.push(classSymbol);
        symbolByQualifiedName.set(classSymbol.qualifiedName, classSymbol);
        symbolByTypeName.set(parsedType.className, classSymbol);
      }

      for (const method of parsedType.methods) {
        const methodSymbol = this.createSeedSymbol(
          method.symbolKind,
          method.name,
          method.qualifiedName,
          parsedType.filePath,
          method.startLine,
          method.endLine,
          codeGraphContext,
          method.metadata,
        );
        symbols.push(methodSymbol);
        symbolByQualifiedName.set(methodSymbol.qualifiedName, methodSymbol);

        const classSymbol = symbolByQualifiedName.get(parsedType.qualifiedName);
        if (classSymbol) {
          edges.push({ sourceId: classSymbol.id, targetId: methodSymbol.id, kind: 'contains' });
        }
      }
    }

    this.copyCodeGraphEdges(codeGraphContext, symbols, edges);

    for (const parsedType of parsedTypes) {
      const classSymbol = symbolByQualifiedName.get(parsedType.qualifiedName);
      for (const method of parsedType.methods) {
        const methodSymbol = symbolByQualifiedName.get(method.qualifiedName);
        if (!methodSymbol) {
          continue;
        }

        if ((parsedType.classKind === 'controller' || parsedType.classKind === 'feign_client') && classSymbol) {
          const methodMetadata = method.metadata ?? {};
          methodMetadata.annotations = method.annotations;
          methodSymbol.metadata = methodMetadata;
        }

        if (parsedType.classKind === 'controller' && classSymbol) {
          const httpMethod = this.getHttpMethodFromAnnotations(method.annotations);
          const routePath = this.combinePaths(
            this.getMappingPath(parsedType.classAnnotationMap.get('RequestMapping') ?? ''),
            this.getMethodRoutePath(method.annotationMap),
          );

          if (httpMethod && routePath) {
            endpoints.push({
              id: `endpoint:${httpMethod}:${routePath}`,
              method: httpMethod,
              path: routePath,
              handlerClassId: classSymbol.id,
              handlerMethodId: methodSymbol.id,
              sourceFilePath: parsedType.filePath,
              sourceLine: method.startLine,
            });
          }
        }

        if (parsedType.classKind === 'feign_client' && classSymbol) {
          const targetService = this.extractNamedAttribute(parsedType.classAnnotationMap.get('FeignClient') ?? '', 'name')
            || this.extractNamedAttribute(parsedType.classAnnotationMap.get('FeignClient') ?? '', 'value')
            || parsedType.className;
          const targetUrl = this.extractNamedAttribute(parsedType.classAnnotationMap.get('FeignClient') ?? '', 'url');
          if (!feignClients.some((client) => client.clientName === parsedType.className)) {
            feignClients.push({
              id: this.makeSeedId('feign-client-row', parsedType.qualifiedName),
              clientName: parsedType.className,
              targetService,
              targetUrl: targetUrl || null,
              methodCount: parsedType.methods.length,
            });
          }
        }

        this.addInvocationEdges(method, parsedType.fieldTypes, symbolByQualifiedName, symbolByTypeName, edges);

        const selectAnnotation = method.annotationMap.get('Select');
        if (selectAnnotation) {
          const sqlText = this.extractFirstQuotedValue(selectAnnotation);
          if (sqlText) {
            const sqlSymbol = this.createSeedSymbol(
              'sql_statement',
              `${parsedType.className}.${method.name}.sql`,
              `${method.qualifiedName}.sql`,
              parsedType.filePath,
              method.startLine,
              method.endLine,
              codeGraphContext,
              {
                sqlText,
                source: 'annotation',
              },
            );
            symbols.push(sqlSymbol);
            symbolByQualifiedName.set(sqlSymbol.qualifiedName, sqlSymbol);
            edges.push({ sourceId: methodSymbol.id, targetId: sqlSymbol.id, kind: 'calls', metadata: { source: 'annotation-sql' } });
            sqlStatements.push(this.createSqlStatement(methodSymbol.id, sqlText, parsedType.filePath, method.startLine));
          }
        }
      }
    }

    for (const xmlFile of xmlFiles) {
      const xmlStatements = this.parseMapperXml(xmlFile);
      for (const xmlStatement of xmlStatements) {
        const mapperMethodSymbol = symbolByQualifiedName.get(`${xmlStatement.namespace}.${xmlStatement.methodName}`);
        if (!mapperMethodSymbol) {
          continue;
        }

        const sqlQualifiedName = `${xmlStatement.namespace}.${xmlStatement.methodName}.xml-sql`;
        const sqlSymbol = this.createSeedSymbol(
          'sql_statement',
          `${xmlStatement.methodName}.sql`,
          sqlQualifiedName,
          xmlFile,
          xmlStatement.line,
          xmlStatement.line,
          codeGraphContext,
          {
            sqlText: xmlStatement.sql,
            source: 'xml',
            statementType: xmlStatement.statementType,
          },
        );
        symbols.push(sqlSymbol);
        symbolByQualifiedName.set(sqlQualifiedName, sqlSymbol);
        edges.push({ sourceId: mapperMethodSymbol.id, targetId: sqlSymbol.id, kind: 'calls', metadata: { source: 'xml-sql' } });
        sqlStatements.push(this.createSqlStatement(mapperMethodSymbol.id, xmlStatement.sql, xmlFile, xmlStatement.line));
      }
    }

    for (const configFile of configFiles) {
      const fileProperties = this.parseConfigFile(configFile);
      for (const property of fileProperties) {
        configProperties.push(property);
      }
    }

    const groupedByPackage = new Map<string, SeedSymbol[]>();
    for (const symbol of symbols) {
      if (!['controller', 'service', 'mapper', 'feign_client'].includes(symbol.kind)) {
        continue;
      }
      const match = symbol.qualifiedName.match(/^(.*)\.[^.]+$/);
      const packageName = match?.[1] ?? 'default';
      if (!groupedByPackage.has(packageName)) {
        groupedByPackage.set(packageName, []);
      }
      groupedByPackage.get(packageName)!.push(symbol);
    }

    for (const [packageName, members] of groupedByPackage) {
      const labelBase = packageName.split('.').pop() || 'feature';
      const label = labelBase.includes('order') ? 'order-management' : `${labelBase}-management`;
      const communityId = this.makeSeedId('community', label);
      communities.push({
        id: communityId,
        label,
        summary: `Spring assets discovered under ${packageName}`,
        memberCount: members.length,
        dirty: 0,
        lastSummarizedAt: Date.now(),
      });
      for (const member of members) {
        communityMembers.push({
          id: this.makeSeedId('community-member', `${communityId}:${member.id}`),
          communityId,
          springNodeId: member.id,
          membershipScore: 1,
        });
      }
    }

    return {
      symbols: this.dedupeById(symbols),
      edges: this.dedupeEdges(edges),
      endpoints: this.dedupeById(endpoints),
      feignClients: this.dedupeById(feignClients),
      sqlStatements: this.dedupeById(sqlStatements),
      configProperties: this.dedupeById(configProperties),
      communities: this.dedupeById(communities),
      communityMembers: this.dedupeById(communityMembers),
    };
  }

  private copyCodeGraphEdges(codeGraphContext: CodeGraphContext, symbols: SeedSymbol[], edges: SeedEdge[]): void {
    if (!codeGraphContext.hasData) {
      return;
    }

    const springByCodeGraphNodeId = new Map<string, SeedSymbol>();
    for (const symbol of symbols) {
      springByCodeGraphNodeId.set(symbol.codegraphNodeId, symbol);
    }

    for (const edge of codeGraphContext.edges) {
      const source = springByCodeGraphNodeId.get(edge.source);
      const target = springByCodeGraphNodeId.get(edge.target);
      if (!source || !target) {
        continue;
      }

      if (edge.kind === 'contains' || edge.kind === 'calls') {
        edges.push({
          sourceId: source.id,
          targetId: target.id,
          kind: edge.kind,
          metadata: { source: 'codegraph-db' },
        });
      }
    }
  }

  private createSeedSymbol(
    kind: string,
    name: string,
    qualifiedName: string,
    filePath: string,
    startLine: number,
    endLine: number,
    codeGraphContext: CodeGraphContext,
    metadata?: Record<string, unknown>,
  ): SeedSymbol {
    const codeGraphNode = codeGraphContext.nodesByQualifiedName.get(qualifiedName)
      ?? codeGraphContext.nodesByFileAndName.get(this.makeFileNameKey(filePath, name));
    const codegraphNodeId = codeGraphNode?.id ?? `seed:${qualifiedName}`;
    const normalizedStart = codeGraphNode?.start_line ?? startLine;
    const normalizedEnd = codeGraphNode?.end_line ?? endLine;
    return {
      id: this.makeSeedId(kind, qualifiedName),
      kind,
      codegraphNodeId,
      name,
      qualifiedName,
      filePath,
      startLine: normalizedStart,
      endLine: normalizedEnd,
      metadata,
    };
  }

  private createSqlStatement(mapperId: string, sqlText: string, filePath: string, line: number): SeedSqlStatement {
    const normalizedSql = sqlText.trim().replace(/\s+/g, ' ');
    return {
      id: this.makeSeedId('sql-row', `${mapperId}:${normalizedSql}`),
      mapperId,
      sqlHash: this.hashText(normalizedSql),
      sqlText: normalizedSql,
      parameterCount: (normalizedSql.match(/#\{/g) || []).length,
      tables: this.extractSqlTables(normalizedSql),
      sourceFilePath: filePath,
      sourceLine: line,
    };
  }

  private addInvocationEdges(
    method: ParsedMethod,
    fieldTypes: Map<string, string>,
    symbolByQualifiedName: Map<string, SeedSymbol>,
    symbolByTypeName: Map<string, SeedSymbol>,
    edges: SeedEdge[],
  ): void {
    const sourceSymbol = symbolByQualifiedName.get(method.qualifiedName);
    if (!sourceSymbol) {
      return;
    }

    const callRegex = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = callRegex.exec(method.body)) !== null) {
      const variableName = match[1] ?? '';
      const calledMethod = match[2] ?? '';
      const targetType = fieldTypes.get(variableName);
      if (!targetType) {
        continue;
      }

      const targetClassSymbol = symbolByTypeName.get(targetType);
      const targetQualifiedName = targetClassSymbol
        ? `${targetClassSymbol.qualifiedName}.${calledMethod}`
        : null;
      if (!targetQualifiedName) {
        continue;
      }

      const targetSymbol = symbolByQualifiedName.get(targetQualifiedName);
      if (!targetSymbol) {
        continue;
      }

      edges.push({
        sourceId: sourceSymbol.id,
        targetId: targetSymbol.id,
        kind: 'calls',
        metadata: { source: 'regex-call' },
      });
    }
  }

  private parseJavaFile(filePath: string): ParsedType | null {
    const source = fs.readFileSync(filePath, 'utf8');
    const packageName = this.captureGroup(source, /package\s+([\w.]+)\s*;/);
    const declarationMatch = source.match(/((?:\s*@[^\n]+\n)*)\s*public\s+(class|interface)\s+(\w+)/);
    if (!declarationMatch) {
      return null;
    }

    const classAnnotationBlock = declarationMatch[1] ?? '';
    const className = declarationMatch[3] ?? '';
    const qualifiedName = packageName ? `${packageName}.${className}` : className;
    const classAnnotations = this.collectAnnotationNames(classAnnotationBlock);
    const classAnnotationMap = this.collectAnnotationMap(classAnnotationBlock);
    const classKind = classAnnotations.includes('RestController')
      ? 'controller'
      : classAnnotations.includes('FeignClient')
        ? 'feign_client'
        : classAnnotations.includes('Mapper')
          ? 'mapper'
          : classAnnotations.includes('Service')
            ? 'service_class'
            : 'plain';

    const fieldTypes = new Map<string, string>();
    const fieldRegex = /private\s+final\s+([A-Z][A-Za-z0-9_<>?, ]*)\s+([a-zA-Z_][A-Za-z0-9_]*)\s*;/g;
    let fieldMatch: RegExpExecArray | null;
    while ((fieldMatch = fieldRegex.exec(source)) !== null) {
      const fieldType = fieldMatch[1] ?? '';
      const fieldName = fieldMatch[2] ?? '';
      if (!fieldType || !fieldName) {
        continue;
      }
      fieldTypes.set(fieldName, fieldType.replace(/<.*>/, '').trim());
    }

    const methods = this.parseJavaMethods(source, qualifiedName, classKind);
    return {
      packageName,
      className,
      qualifiedName,
      filePath,
      classKind,
      startLine: this.getLineNumber(source, declarationMatch.index ?? 0),
      endLine: source.split(/\r?\n/).length,
      classAnnotations,
      classAnnotationMap,
      fieldTypes,
      methods,
    };
  }

  private parseJavaMethods(source: string, qualifiedClassName: string, classKind: string): ParsedMethod[] {
    const methods: ParsedMethod[] = [];
    const methodRegex = /((?:\s*@[^\n]+\n)*)\s*(?:public|protected|private)\s+[A-Za-z0-9_<>,.?\[\]\s]+\s+(\w+)\s*\([^)]*\)\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = methodRegex.exec(source)) !== null) {
      const annotationBlock = match[1] ?? '';
      const name = match[2] ?? '';
      const annotations = this.collectAnnotationNames(annotationBlock);
      if (name === qualifiedClassName.split('.').pop()) {
        continue;
      }

      const bodyStartIndex = match.index + match[0].length - 1;
      const bodyEndIndex = this.findMatchingBrace(source, bodyStartIndex);
      const body = bodyEndIndex > bodyStartIndex ? source.slice(bodyStartIndex + 1, bodyEndIndex) : '';
      const annotationMap = this.collectAnnotationMap(annotationBlock);
      const symbolKind = classKind === 'controller'
        ? 'controller_method'
        : classKind === 'feign_client'
          ? 'feign_method'
          : classKind === 'mapper'
            ? 'mapper_method'
            : this.looksLikeServiceMethod(annotations, body)
              ? 'service'
              : 'method';

      const metadata: Record<string, unknown> = {};
      const routePath = this.getMethodRoutePath(annotationMap);
      const httpMethod = this.getHttpMethodFromAnnotations(annotations);
      if (routePath) {
        metadata.path = routePath;
      }
      if (httpMethod) {
        metadata.httpMethod = httpMethod;
      }
      if (annotations.length > 0) {
        metadata.annotations = annotations;
      }

      methods.push({
        name,
        qualifiedName: `${qualifiedClassName}.${name}`,
        symbolKind,
        startLine: this.getLineNumber(source, match.index ?? 0),
        endLine: this.getLineNumber(source, bodyEndIndex),
        annotations,
        annotationMap,
        body,
        metadata,
      });
    }

    return methods;
  }

  private parseMapperXml(filePath: string): Array<{ namespace: string; methodName: string; statementType: string; sql: string; line: number }> {
    const source = fs.readFileSync(filePath, 'utf8');
    const namespace = this.captureGroup(source, /<mapper\s+namespace="([^"]+)"/);
    if (!namespace) {
      return [];
    }

    const statements: Array<{ namespace: string; methodName: string; statementType: string; sql: string; line: number }> = [];
    const statementRegex = /<(select|insert|update|delete)\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g;
    let match: RegExpExecArray | null;
    while ((match = statementRegex.exec(source)) !== null) {
      statements.push({
        namespace,
        statementType: (match[1] ?? '').toUpperCase(),
        methodName: match[2] ?? '',
        sql: this.decodeXml((match[3] ?? '').trim().replace(/\s+/g, ' ')),
        line: this.getLineNumber(source, match.index ?? 0),
      });
    }

    return statements;
  }

  private parseConfigFile(filePath: string): SeedConfigProperty[] {
    if (filePath.endsWith('.properties')) {
      return this.parsePropertiesFile(filePath);
    }
    return this.parseYamlFile(filePath);
  }

  private parsePropertiesFile(filePath: string): SeedConfigProperty[] {
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    const properties: SeedConfigProperty[] = [];
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
        return;
      }
      const separatorIndex = trimmed.indexOf('=');
      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      properties.push(this.createConfigProperty(key, value, filePath, index + 1));
    });
    return properties;
  }

  private parseYamlFile(filePath: string): SeedConfigProperty[] {
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    const properties: SeedConfigProperty[] = [];
    const pathStack: string[] = [];

    lines.forEach((line, index) => {
      if (!line.trim() || line.trim().startsWith('#')) {
        return;
      }

      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      const level = Math.floor(indent / 2);
      const trimmed = line.trim();
      const separatorIndex = trimmed.indexOf(':');
      if (separatorIndex === -1) {
        return;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      pathStack.length = level;
      pathStack[level] = key;

      if (!value) {
        return;
      }

      if (value.startsWith('{') && value.endsWith('}')) {
        const inlineEntries = this.parseInlineYamlObject(value.slice(1, -1));
        for (const [childKey, childValue] of inlineEntries) {
          const fullKey = [...pathStack.slice(0, level + 1), childKey].join('.');
          properties.push(this.createConfigProperty(fullKey, childValue, filePath, index + 1));
        }
        return;
      }

      const fullKey = pathStack.slice(0, level + 1).join('.');
      properties.push(this.createConfigProperty(fullKey, value, filePath, index + 1));
    });

    return properties;
  }

  private createConfigProperty(key: string, value: string, filePath: string, line: number): SeedConfigProperty {
    const normalizedValue = value.replace(/^['"]|['"]$/g, '');
    return {
      id: this.makeSeedId('config', `${filePath}:${key}`),
      key,
      valueHash: normalizedValue,
      isSensitive: this.isSensitiveConfigKey(key) ? 1 : 0,
      sourceFilePath: filePath,
      sourceLine: line,
      beanId: null,
    };
  }

  private parseInlineYamlObject(rawValue: string): Array<[string, string]> {
    const entries: Array<[string, string]> = [];
    for (const rawEntry of rawValue.split(',')) {
      const entry = rawEntry.trim();
      if (!entry) {
        continue;
      }

      const separatorIndex = entry.indexOf(':');
      if (separatorIndex === -1) {
        entries.push([entry, '']);
      } else {
        entries.push([
          entry.slice(0, separatorIndex).trim(),
          entry.slice(separatorIndex + 1).trim(),
        ]);
      }
    }
    return entries;
  }

  private collectAnnotationNames(annotationBlock: string): string[] {
    return Array.from(annotationBlock.matchAll(/@(\w+)/g))
      .map((match) => match[1])
      .filter((name): name is string => Boolean(name));
  }

  private collectAnnotationMap(annotationBlock: string): Map<string, string> {
    const annotationMap = new Map<string, string>();
    for (const match of annotationBlock.matchAll(/@(\w+)(\(([^)]*)\))?/g)) {
      const annotationName = match[1];
      if (!annotationName) {
        continue;
      }
      annotationMap.set(annotationName, match[3] ?? '');
    }
    return annotationMap;
  }

  private getHttpMethodFromAnnotations(annotations: string[]): string | null {
    if (annotations.includes('GetMapping')) return 'GET';
    if (annotations.includes('PostMapping')) return 'POST';
    if (annotations.includes('PutMapping')) return 'PUT';
    if (annotations.includes('DeleteMapping')) return 'DELETE';
    if (annotations.includes('PatchMapping')) return 'PATCH';
    if (annotations.includes('RequestMapping')) return 'GET';
    return null;
  }

  private getMethodRoutePath(annotationMap: Map<string, string>): string {
    for (const name of ['GetMapping', 'PostMapping', 'PutMapping', 'DeleteMapping', 'PatchMapping', 'RequestMapping']) {
      const rawValue = annotationMap.get(name);
      if (rawValue) {
        const explicitPath = this.extractNamedAttribute(rawValue, 'path') || this.extractNamedAttribute(rawValue, 'value') || this.extractFirstQuotedValue(rawValue);
        return explicitPath || '';
      }
    }
    return '';
  }

  private getMappingPath(rawValue: string): string {
    return this.extractNamedAttribute(rawValue, 'path') || this.extractNamedAttribute(rawValue, 'value') || this.extractFirstQuotedValue(rawValue) || '';
  }

  private extractNamedAttribute(rawValue: string, attributeName: string): string {
    const match = rawValue.match(new RegExp(`${attributeName}\\s*=\\s*"([^"]+)"`));
    return match?.[1] ?? '';
  }

  private extractFirstQuotedValue(rawValue: string): string {
    const match = rawValue.match(/"([^"]+)"/);
    return match?.[1] ?? '';
  }

  private combinePaths(basePath: string, childPath: string): string {
    const normalizedBase = basePath.trim();
    const normalizedChild = childPath.trim();
    if (!normalizedBase && !normalizedChild) {
      return '';
    }
    if (!normalizedBase) {
      return normalizedChild.startsWith('/') ? normalizedChild : `/${normalizedChild}`;
    }
    if (!normalizedChild) {
      return normalizedBase.startsWith('/') ? normalizedBase : `/${normalizedBase}`;
    }
    return `${normalizedBase.replace(/\/$/, '')}/${normalizedChild.replace(/^\//, '')}`;
  }

  private looksLikeServiceMethod(annotations: string[], body: string): boolean {
    return annotations.includes('Transactional') || /Mapper\./.test(body) || /Client\./.test(body) || /return\s+.*\./.test(body);
  }

  private extractSqlTables(sqlText: string): string[] {
    const tables = new Set<string>();
    const patterns = [/(?:from|join|into|update)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi];
    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(sqlText)) !== null) {
        const tableName = match[1];
        if (tableName) {
          tables.add(tableName);
        }
      }
    }
    return Array.from(tables);
  }

  private decodeXml(text: string): string {
    return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }

  private captureGroup(text: string, pattern: RegExp): string {
    return text.match(pattern)?.[1] ?? '';
  }

  private findMatchingBrace(source: string, openBraceIndex: number): number {
    let depth = 0;
    for (let index = openBraceIndex; index < source.length; index += 1) {
      if (source[index] === '{') {
        depth += 1;
      } else if (source[index] === '}') {
        depth -= 1;
        if (depth === 0) {
          return index;
        }
      }
    }
    return source.length;
  }

  private getLineNumber(source: string, index: number): number {
    return source.slice(0, Math.max(index, 0)).split(/\r?\n/).length;
  }

  private makeSeedId(kind: string, value: string): string {
    return `${kind}:${this.hashText(value).slice(0, 24)}`;
  }

  private hashText(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private makeFileNameKey(filePath: string, name: string): string {
    return `${path.normalize(filePath)}::${name}`;
  }

  private findFiles(rootPath: string, predicate: (filePath: string) => boolean): string[] {
    const results: string[] = [];
    const visit = (currentPath: string): void => {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.codegraph' || entry.name === 'target' || entry.name === 'dist') {
          continue;
        }

        const entryPath = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
          visit(entryPath);
          continue;
        }

        if (predicate(entryPath)) {
          results.push(entryPath);
        }
      }
    };

    if (fs.existsSync(rootPath)) {
      visit(rootPath);
    }
    return results;
  }

  private dedupeById<T extends { id: string }>(items: T[]): T[] {
    const byId = new Map<string, T>();
    for (const item of items) {
      byId.set(item.id, item);
    }
    return Array.from(byId.values());
  }

  private dedupeEdges(edges: SeedEdge[]): SeedEdge[] {
    const byKey = new Map<string, SeedEdge>();
    for (const edge of edges) {
      const key = `${edge.kind}:${edge.sourceId}:${edge.targetId}`;
      if (!byKey.has(key)) {
        byKey.set(key, edge);
      }
    }
    return Array.from(byKey.values());
  }

  private isSensitiveConfigKey(key: string): boolean {
    return /password|secret|token|key/i.test(key);
  }
}
