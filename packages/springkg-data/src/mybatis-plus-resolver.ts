import type { SpringKgNode, SpringKgEdge, SpringKgEnhanceOutput } from '@jinglonglong/springkg-shared';

function toSnakeCase(name: string): string {
  return name
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '')
    .replace(/_+/g, '_');
}

function stripSuffix(name: string): string {
  return name.replace(/(?:DO|VO|DTO|Entity)$/, '');
}

export class MyBatisPlusResolver {
  resolve(
    classes: SpringKgNode[],
  ): { symbols: SpringKgNode[]; edges: SpringKgEdge[]; output: SpringKgEnhanceOutput } {
    const symbols: SpringKgNode[] = [];
    const edges: SpringKgEdge[] = [];
    const tableMap = new Map<string, SpringKgNode>();

    for (const cls of classes) {
      if ((cls.kind as string) !== 'class') continue;

      const decorators = cls.metadata?.decorators as string[] ?? [];
      const hasTableName = decorators.some((d: string) => d.includes('@TableName'));

      let tableName: string;
      if (hasTableName) {
        const match = decorators.find((d: string) => d.includes('@TableName'))?.match(/@TableName\s*\(\s*"(.*?)"\s*\)/);
        tableName = match?.[1] ?? toSnakeCase(stripSuffix(cls.name ?? cls.qualifiedName?.split('.').pop() ?? cls.id));
      } else {
        tableName = toSnakeCase(stripSuffix(cls.name ?? cls.qualifiedName?.split('.').pop() ?? cls.id));
      }

      const tableId = `entity_table:${cls.id}`;
      const tableNode: SpringKgNode = {
        id: tableId,
        kind: 'table',
        springgraphNodeId: cls.id,
        name: tableName,
        qualifiedName: cls.qualifiedName ? `${cls.qualifiedName}->${tableName}` : tableName,
        filePath: cls.filePath,
        startLine: cls.startLine,
        endLine: cls.endLine,
        metadata: { entityKind: 'mybatis_plus', className: cls.name, classFqn: cls.qualifiedName },
        confidence: 1.0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      symbols.push(tableNode);
      tableMap.set(cls.id, tableNode);

      // MAPS_TO_TABLE edge: entity -> table
      edges.push({
        id: `edge:maps:${cls.id}->${tableId}`,
        sourceId: cls.id,
        targetId: tableId,
        kind: 'MAPS_TO_TABLE',
        metadata: { tableName, annotation: hasTableName ? '@TableName' : 'convention' },
        confidence: hasTableName ? 1.0 : 0.85,
        createdAt: Date.now(),
      });
    }

    const output: SpringKgEnhanceOutput = {
      symbolsAdded: symbols.length,
      edgesAdded: edges.length,
      byKind: { table: symbols.length, entity: classes.length },
    };

    return { symbols, edges, output };
  }
}
