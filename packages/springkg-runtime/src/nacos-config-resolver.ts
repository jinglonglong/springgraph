// packages/springkg-runtime/src/nacos-config-resolver.ts
// Team D: Runtime Asset Layer - Nacos Configuration Resolver

import type { SpringKgNode, SpringKgEdge } from '@colbymchenry/springkg-shared';

export interface NacosConfigInput {
  dataId: string;
  group: string;
  namespace?: string;
  content: string;
  sourceFile?: string;
}

export class NacosConfigResolver {
  private symbols: SpringKgNode[] = [];
  private edges: SpringKgEdge[] = [];
  private configProperties: Array<{
    id: string;
    key: string;
    valueHash: string;
    isSensitive: boolean;
    sourceFilePath: string;
    sourceLine: number;
  }> = [];

  async upsertSymbol(node: SpringKgNode): Promise<void> {
    const existing = this.symbols.findIndex((s) => s.id === node.id);
    if (existing >= 0) {
      this.symbols[existing] = node;
    } else {
      this.symbols.push(node);
    }
  }

  async upsertEdge(edge: SpringKgEdge): Promise<void> {
    const existing = this.edges.findIndex((e) => e.id === edge.id);
    if (existing >= 0) {
      this.edges[existing] = edge;
    } else {
      this.edges.push(edge);
    }
  }

  async getConfigProperties() {
    return this.configProperties;
  }

  addConfig(config: NacosConfigInput): void {
    const lines = config.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lineNum = i + 1;
      const kvMatch = line.match(/^([a-zA-Z0-9.\-]+)\s*[=:]\s*(.+)/);
      if (!kvMatch) continue;

      const key = kvMatch[1].trim();
      const rawValue = kvMatch[2].trim();
      const sensitivePatterns = [
        /password/i, /passwd/i, /secret/i, /token/i,
        /access[-_]?key/i, /api[-_]?key/i, /private[-_]?key/i,
        /credential/i, /auth/i,
      ];
      const isSensitive = sensitivePatterns.some((p) => p.test(key));

      this.configProperties.push({
        id: `nacos-config:${config.dataId}:${key}:${lineNum}`,
        key,
        valueHash: hashString(rawValue),
        isSensitive,
        sourceFilePath: config.sourceFile || `nacos://${config.group}/${config.dataId}`,
        sourceLine: lineNum,
      });
    }

    const nodeId = `nacos_config:${config.group}:${config.dataId}`;
    const node: SpringKgNode = {
      id: nodeId,
      kind: 'nacos_config',
      codegraphNodeId: '',
      name: config.dataId,
      qualifiedName: `${config.namespace || 'default'}/${config.group}/${config.dataId}`,
      filePath: config.sourceFile,
      metadata: {
        group: config.group,
        namespace: config.namespace,
        propertyCount: this.configProperties.filter(
          (p) => p.sourceFilePath === (config.sourceFile || `nacos://${config.group}/${config.dataId}`)
        ).length,
      },
      confidence: 1.0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.upsertSymbol(node);
  }

  resolve(): { symbols: SpringKgNode[]; edges: SpringKgEdge[] } {
    return { symbols: this.symbols, edges: this.edges };
  }
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}
