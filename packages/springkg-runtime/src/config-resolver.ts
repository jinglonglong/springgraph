// packages/springkg-runtime/src/config-resolver.ts
// Team D: Runtime Asset Layer - Configuration Resolver

import type { SpringKgNode, SpringKgEdge, RuntimeConfigProperty } from '@colbymchenry/springkg-shared';

export interface ConfigResolverOutput {
  symbols: SpringKgNode[];
  edges: SpringKgEdge[];
  configProperties: RuntimeConfigProperty[];
}

interface ConfigFile {
  path: string;
  profile?: string;
  priority: number;
  content: string;
}

/**
 * Resolves configuration properties from Spring application files.
 * Handles application.yml, application.properties, bootstrap.yml, etc.
 */
export class ConfigResolver {
  private configFiles: Map<string, ConfigFile> = new Map();

  addConfigFile(path: string, content: string, profile?: string, priority = 0): void {
    const existing = this.configFiles.get(path);
    if (existing && existing.priority > priority) {
      return;
    }
    this.configFiles.set(path, { path, profile, priority, content });
  }

  resolve(): ConfigResolverOutput {
    const symbols: SpringKgNode[] = [];
    const edges: SpringKgEdge[] = [];
    const configProperties: RuntimeConfigProperty[] = [];

    for (const [, file] of this.configFiles) {
      const properties = this.parseConfigFile(file);
      configProperties.push(...properties);
    }

    return { symbols, edges, configProperties };
  }

  private parseConfigFile(file: ConfigFile): RuntimeConfigProperty[] {
    const results: RuntimeConfigProperty[] = [];
    const lines = file.content.split('\n');
    const sensitivePatterns = [
      /password/i, /passwd/i, /secret/i, /token/i,
      /access[-_]?key/i, /api[-_]?key/i, /private[-_]?key/i,
      /credential/i, /auth/i,
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;
      const kvMatch = line.match(/^([a-zA-Z0-9.\-]+)\s*[=:]\s*(.+)/);
      if (!kvMatch) continue;

      const key = kvMatch[1].trim();
      const rawValue = kvMatch[2].trim();
      const isSensitive = sensitivePatterns.some((p) => p.test(key));

      const prop: RuntimeConfigProperty = {
        id: `config:${key}:${hashString(file.path + lineNum)}`,
        key,
        valueHash: hashString(rawValue),
        isSensitive,
        sourceFilePath: file.path,
        sourceLine: lineNum,
      };

      results.push(prop);
    }

    return results;
  }

  mergeConfigs(existing: RuntimeConfigProperty[], incoming: RuntimeConfigProperty[]): RuntimeConfigProperty[] {
    const merged = new Map<string, RuntimeConfigProperty>();

    for (const prop of existing) {
      merged.set(prop.key, prop);
    }

    for (const prop of incoming) {
      const existingProp = merged.get(prop.key);
      if (!existingProp) {
        merged.set(prop.key, prop);
      } else {
        const existingFile = this.configFiles.get(existingProp.sourceFilePath);
        const incomingFile = this.configFiles.get(prop.sourceFilePath);
        if (existingFile && incomingFile) {
          if (incomingFile.priority > existingFile.priority) {
            merged.set(prop.key, prop);
          }
        } else if (incomingFile) {
          merged.set(prop.key, prop);
        }
      }
    }

    return Array.from(merged.values());
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
