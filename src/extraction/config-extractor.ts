/**
 * Spring configuration extractor.
 *
 * Parses `application.yml`, `application.yaml`, `application.properties`, and
 * `bootstrap` variants into `constant` nodes keyed by their dotted property
 * path. These nodes are the resolution targets for `@Value("${key}")` and
 * `@ConfigurationProperties(prefix=...)` bindings in Java/Kotlin source.
 *
 * Only leaf keys are emitted; intermediate keys do not bind to `@Value`.
 * Values are deliberately NOT stored in the graph to avoid leaking secrets
 * (#383).
 */

import { Node, ExtractionResult, ExtractionError, UnresolvedReference, Edge } from '../types';
import { generateNodeId } from './tree-sitter-helpers';

const CONFIG_FILE_RE = /^(application|bootstrap)(-[\w.-]+)?\.(yml|yaml|properties)$/i;

export function isSpringConfigFile(filePath: string): boolean {
  const base = filePath.split('/').pop() ?? '';
  return CONFIG_FILE_RE.test(base);
}

export class ConfigExtractor {
  private filePath: string;
  private source: string;
  private nodes: Node[] = [];
  private edges: Edge[] = [];
  private errors: ExtractionError[] = [];
  private fileNodeId = '';

  constructor(filePath: string, source: string) {
    this.filePath = filePath;
    this.source = source;
  }

  extract(): ExtractionResult {
    const startTime = Date.now();

    this.createFileNode();
    try {
      if (/\.(properties)$/i.test(this.filePath)) {
        this.extractProperties();
      } else {
        this.extractYaml();
      }
    } catch (error) {
      this.errors.push({
        message: `Config extraction error: ${error instanceof Error ? error.message : String(error)}`,
        severity: 'error',
        code: 'parse_error',
      });
    }

    return {
      nodes: this.nodes,
      edges: this.edges,
      unresolvedReferences: [] as UnresolvedReference[],
      errors: this.errors,
      durationMs: Date.now() - startTime,
    };
  }

  private createFileNode(): Node {
    const lines = this.source.split('\n');
    const id = generateNodeId(this.filePath, 'file', this.filePath, 1);
    const node: Node = {
      id,
      kind: 'file',
      name: this.filePath.split('/').pop() || this.filePath,
      qualifiedName: this.filePath,
      filePath: this.filePath,
      language: this.filePath.endsWith('.properties') ? 'properties' : 'yaml',
      startLine: 1,
      endLine: lines.length || 1,
      startColumn: 0,
      endColumn: lines[lines.length - 1]?.length ?? 0,
      updatedAt: Date.now(),
    };
    this.nodes.push(node);
    this.fileNodeId = id;
    return node;
  }

  private emitLeaf(dottedKey: string, line: number): void {
    if (!dottedKey) return;
    const id = generateNodeId(this.filePath, 'constant', dottedKey, line);
    const node: Node = {
      id,
      kind: 'constant',
      name: dottedKey.split('.').pop() ?? dottedKey,
      qualifiedName: dottedKey,
      filePath: this.filePath,
      startLine: line,
      endLine: line,
      startColumn: 0,
      endColumn: 0,
      language: this.filePath.endsWith('.properties') ? 'properties' : 'yaml',
      signature: dottedKey,
      updatedAt: Date.now(),
    };
    this.nodes.push(node);
    if (this.fileNodeId) {
      this.edges.push({ source: this.fileNodeId, target: id, kind: 'contains' });
    }
  }

  private extractProperties(): void {
    const lines = this.source.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i] ?? '';
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) continue;
      const sep = (() => {
        for (let j = 0; j < raw.length; j++) {
          const ch = raw[j];
          if (ch === '=' || ch === ':') return j;
          if (ch === '\\' && raw[j + 1]) { j++; continue; }
        }
        return -1;
      })();
      if (sep < 0) continue;
      const key = raw.slice(0, sep).trim();
      if (!key) continue;
      this.emitLeaf(key, i + 1);
    }
  }

  private extractYaml(): void {
    const stack: Array<{ indent: number; key: string }> = [];
    const lines = this.source.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i] ?? '';
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed === '---' || trimmed.startsWith('- ')) continue;
      const indent = raw.length - raw.replace(/^[\t ]+/, '').length;
      const colonIdx = (() => {
        let inStr: string | null = null;
        for (let j = 0; j < raw.length; j++) {
          const ch = raw[j];
          if (inStr) { if (ch === inStr && raw[j - 1] !== '\\') inStr = null; continue; }
          if (ch === '"' || ch === "'") { inStr = ch; continue; }
          if (ch === ':') return j;
        }
        return -1;
      })();
      if (colonIdx < 0) continue;
      const key = raw.slice(indent, colonIdx).trim();
      if (!key) continue;
      const after = raw.slice(colonIdx + 1).trim();
      while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) stack.pop();
      const dotted = [...stack.map(s => s.key), key].join('.');
      if (after === '' || after.startsWith('#')) {
        stack.push({ indent, key });
      } else {
        this.emitLeaf(dotted, i + 1);
      }
    }
  }
}
