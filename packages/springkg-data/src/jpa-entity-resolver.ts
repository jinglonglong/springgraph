import type { SpringKgNode, SpringKgEdge, SpringKgEnhanceOutput } from '@colbymchenry/springkg-shared';

function toSnakeCase(name: string): string {
  return name
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '')
    .replace(/_+/g, '_');
}

export class JPAEntityResolver {
  resolve(
    entities: SpringKgNode[],
  ): { symbols: SpringKgNode[]; edges: SpringKgEdge[]; output: SpringKgEnhanceOutput } {
    const symbols: SpringKgNode[] = [];
    const edges: SpringKgEdge[] = [];

    for (const entity of entities) {
      if (entity.kind !== 'class') continue;

      const decorators = entity.metadata?.decorators as string[] ?? [];
      const hasEntity = decorators.some((d: string) => d.includes('@Entity'));
      const hasTable = decorators.some((d: string) => d.includes('@Table'));

      let tableName: string;
      if (hasTable) {
        const match = decorators.find((d: string) => d.includes('@Table'))?.match(/@Table\s*\(\s*(?:name\s*=\s*)?("(?:.*?)")/);
        tableName = match?.[1]?.replace(/"/g, '') ?? toSnakeCase(entity.name ?? entity.qualifiedName?.split('.').pop() ?? entity.id);
      } else if (hasEntity) {
        tableName = toSnakeCase(entity.name ?? entity.qualifiedName?.split('.').pop() ?? entity.id);
      } else {
        continue;
      }

      const tableId = `entity_table:${entity.id}`;
      symbols.push({
        id: tableId,
        kind: 'table',
        codegraphNodeId: entity.id,
        name: tableName,
        qualifiedName: entity.qualifiedName ? `${entity.qualifiedName}->${tableName}` : tableName,
        filePath: entity.filePath,
        startLine: entity.startLine,
        endLine: entity.endLine,
        metadata: { entityKind: 'jpa', className: entity.name, classFqn: entity.qualifiedName },
        confidence: 1.0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      edges.push({
        id: `edge:maps:${entity.id}->${tableId}`,
        sourceId: entity.id,
        targetId: tableId,
        kind: 'MAPS_TO_TABLE',
        metadata: { tableName, annotation: hasTable ? '@Table' : '@Entity' },
        confidence: 1.0,
        createdAt: Date.now(),
      });
    }

    return {
      symbols,
      edges,
      output: {
        symbolsAdded: symbols.length,
        edgesAdded: edges.length,
        byKind: { table: symbols.length, entity: entities.length },
      },
    };
  }
}
