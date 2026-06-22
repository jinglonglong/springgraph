import type { SpringKgNode, SpringKgEdge, SpringKgEnhanceOutput } from '@jinglonglong/springkg-shared';

export class MapperBindingResolver {
  resolve(
    mappers: Array<{ interfaceNode: SpringKgNode; methods: SpringKgNode[] }>,
    xmlStatements: Array<{ namespace: string; statementId: string; id: string }>,
    annotationStatements: Array<{ filePath: string; statementId: string; id: string }>,
  ): { symbols: SpringKgNode[]; edges: SpringKgEdge[]; output: SpringKgEnhanceOutput } {
    const symbols: SpringKgNode[] = [];
    const edges: SpringKgEdge[] = [];
    const seenBindTo = new Set<string>();

    for (const { interfaceNode, methods } of mappers) {
      // Emit mapper interface node
      symbols.push({
        id: `mapper:${interfaceNode.id}`,
        kind: 'mapper',
        springgraphNodeId: interfaceNode.id,
        name: interfaceNode.name ?? interfaceNode.qualifiedName?.split('.').pop() ?? interfaceNode.id,
        qualifiedName: interfaceNode.qualifiedName,
        filePath: interfaceNode.filePath,
        startLine: interfaceNode.startLine,
        endLine: interfaceNode.endLine,
        metadata: interfaceNode.metadata,
        confidence: 1.0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      for (const method of methods) {
        const methodName = method.name ?? method.qualifiedName?.split('::').pop() ?? method.id;
        const ns = interfaceNode.qualifiedName ?? '';

        // Find matching XML statement
        const xmlStmt = xmlStatements.find(
          (s) => s.namespace === ns && s.statementId === methodName,
        );

        // Find matching annotation statement
        const annStmt = annotationStatements.find(
          (s) => s.filePath === interfaceNode.filePath && s.statementId === methodName,
        );

        if (!xmlStmt && !annStmt) continue;

        const stmt = xmlStmt ?? annStmt!;
        const source = xmlStmt ? 'xml' : 'annotation';
        const mapperMethodId = `mapper_method:${interfaceNode.id}:${methodName}`;

        // Emit mapper_method node
        symbols.push({
          id: mapperMethodId,
          kind: 'mapper_method',
          springgraphNodeId: method.id,
          name: methodName,
          qualifiedName: `${ns}::${methodName}`,
          filePath: interfaceNode.filePath,
          startLine: method.startLine,
          endLine: method.endLine,
          metadata: { source, statementId: stmt.statementId, namespace: ns },
          confidence: 1.0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        // BIND_TO edge: mapper_method -> sql_statement
        const bindKey = `${mapperMethodId}->${stmt.id}`;
        if (!seenBindTo.has(bindKey)) {
          seenBindTo.add(bindKey);
          edges.push({
            id: `edge:bind:${bindKey}`,
            sourceId: mapperMethodId,
            targetId: stmt.id,
            kind: 'BIND_TO',
            metadata: { source, statementId: stmt.statementId, namespace: ns },
            confidence: 1.0,
            createdAt: Date.now(),
          });
        }

        // CALLS edge: mapper_method -> interface method
        edges.push({
          id: `edge:calls:${mapperMethodId}->${method.id}`,
          sourceId: mapperMethodId,
          targetId: method.id,
          kind: 'CALLS',
          metadata: { source },
          confidence: 1.0,
          createdAt: Date.now(),
        });
      }
    }

    const output: SpringKgEnhanceOutput = {
      symbolsAdded: symbols.length,
      edgesAdded: edges.length,
      byKind: {
        mapper: symbols.filter((s) => s.kind === 'mapper').length,
        mapper_method: symbols.filter((s) => s.kind === 'mapper_method').length,
      },
    };

    return { symbols, edges, output };
  }
}
