// packages/springkg-runtime/src/middleware-inventory.ts
// Team D: Runtime Asset Layer - Middleware Inventory Extractor

import type { SpringKgNode, SpringKgEdge } from '@colbymchenry/springkg-shared';

export interface MiddlewareInventoryOutput {
  symbols: SpringKgNode[];
  edges: SpringKgEdge[];
}

interface ParsedDataSource {
  name: string;
  url: string;
  driverClassName?: string;
  username?: string;
  sourceFile: string;
  sourceLine: number;
}

/**
 * Detects spring.datasource.* and spring.datasource.order.* middleware configurations.
 * Detects both regular data sources (spring.datasource.url) and
 * Hibernate/Liquibase order data sources (spring.datasource.order.url).
 */
export function inferMiddleware(
  filePath: string,
  content: string
): MiddlewareInventoryOutput {
  const symbols: SpringKgNode[] = [];
  const edges: SpringKgEdge[] = [];
  const dataSources = parseDataSources(filePath, content);

  for (const ds of dataSources) {
    const nodeId = `middleware:datasource:${ds.name}:${hashString(ds.sourceFile + ds.sourceLine)}`;
    const node: SpringKgNode = {
      id: nodeId,
      kind: 'middleware',
      codegraphNodeId: '',
      name: ds.name,
      qualifiedName: ds.name,
      filePath: ds.sourceFile,
      startLine: ds.sourceLine,
      endLine: ds.sourceLine,
      metadata: {
        middlewareType: 'datasource',
        url: ds.url,
        driverClassName: ds.driverClassName,
        username: ds.username,
      },
      confidence: 1.0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    symbols.push(node);
  }

  return { symbols, edges };
}

function parseDataSources(filePath: string, content: string): ParsedDataSource[] {
  const results: ParsedDataSource[] = [];
  const lines = content.split('\n');

  // Track current context for YAML parsing
  let inDatasource = false;
  let inOrderDatasource = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    // Handle YAML indentation-based context tracking
    if (trimmed === 'datasource:') {
      inDatasource = true;
      inOrderDatasource = false;
      continue;
    }
    if (trimmed === 'order:') {
      inDatasource = false;
      inOrderDatasource = true;
      continue;
    }
    // Exit datasource context when we see a top-level key
    if (trimmed && !line.startsWith(' ') && !line.startsWith('\t') && trimmed.includes(':')) {
      inDatasource = false;
      inOrderDatasource = false;
    }

    // Detect spring.datasource.url (regular data source)
    const dsMatch = trimmed.match(/^spring\.datasource\.url\s*[=:]\s*(.+)/);
    if (dsMatch) {
      results.push({
        name: 'primary',
        url: dsMatch[1].trim(),
        sourceFile: filePath,
        sourceLine: lineNum,
      });
      inDatasource = true;
      inOrderDatasource = false;
      continue;
    }

    // Detect spring.datasource.order.url (Hibernate/Liquibase order data source)
    const orderMatch = trimmed.match(/^spring\.datasource\.order\.url\s*[=:]\s*(.+)/);
    if (orderMatch) {
      results.push({
        name: 'order',
        url: orderMatch[1].trim(),
        sourceFile: filePath,
        sourceLine: lineNum,
      });
      inDatasource = false;
      inOrderDatasource = true;
      continue;
    }

    // Handle YAML nested format: url: value (under datasource:)
    if ((inDatasource || inOrderDatasource) && trimmed.startsWith('url:')) {
      const urlMatch = trimmed.match(/^url:\s*(.+)/);
      if (urlMatch) {
        const name = inOrderDatasource ? 'order' : 'primary';
        const existing = results.find((r) => r.name === name && r.sourceFile === filePath);
        if (!existing) {
          results.push({
            name,
            url: urlMatch[1].trim(),
            sourceFile: filePath,
            sourceLine: lineNum,
          });
        } else {
          existing.url = urlMatch[1].trim();
        }
        continue;
      }
    }

    // Detect driver-class-name and username for the current datasource context
    const currentName = inOrderDatasource ? 'order' : 'primary';
    const currentDs = results.find((r) => r.name === currentName && r.sourceFile === filePath);
    if (currentDs) {
      if (trimmed.startsWith('driver-class-name:')) {
        const m = trimmed.match(/^driver-class-name:\s*(.+)/);
        if (m) currentDs.driverClassName = m[1].trim();
      }
      if (trimmed.startsWith('username:')) {
        const m = trimmed.match(/^username:\s*(.+)/);
        if (m) currentDs.username = m[1].trim();
      }
    }
  }

  return results;
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
