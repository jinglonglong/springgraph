export type SpringKgMetadata = Record<string, unknown>;

export interface SpringKgSymbolInput {
  id: string;
  kind: string;
  name: string;
  qualifiedName: string;
  filePath: string;
  startLine: number;
  endLine: number;
  metadata: SpringKgMetadata;
}

export interface SpringKgEdgeInput {
  id: string;
  sourceId: string;
  targetId: string;
  kind: string;
  provenance: string;
  metadata: SpringKgMetadata;
}

export interface RuntimeConfigPropertyRecord {
  id: string;
  serviceId: string;
  key: string;
  valueMasked: string;
  valueHash: string;
  valueType: string;
  sourceFile: string;
  profile: string;
  priority: number;
  isSensitive: 0 | 1;
  metadata: SpringKgMetadata;
}

export interface ConfigPropertyRow {
  id?: string;
  serviceId: string;
  key: string;
  valueMasked: string;
}

export interface DecoratedSpringgraphNode {
  id: string;
  name: string;
  kind: string;
  decorators: string;
  serviceId?: string;
}

export interface ConfigFileContent {
  [key: string]: ConfigScalar | ConfigFileContent | ConfigArray;
}

export type ConfigScalar = string | number | boolean | null;
export type ConfigArray = Array<ConfigScalar | ConfigFileContent | ConfigArray>;
export type FlattenedProperties = Record<string, ConfigScalar>;

export interface SpringKgLike {
  upsertSymbol(symbol: SpringKgSymbolInput): Promise<void>;
  upsertEdge(edge: SpringKgEdgeInput): Promise<void>;
  recordConfigProperty?(property: RuntimeConfigPropertyRecord): Promise<void>;
  getConfigProperties?(): Promise<ConfigPropertyRow[]>;
  findDecoratedNodes?(): Promise<DecoratedSpringgraphNode[]>;
  springgraph?: {
    findNodes?(query: { decoratorPattern: string }): Promise<DecoratedSpringgraphNode[]>;
  };
}

export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function logResolverWarning(scope: string, message: string, error?: unknown): void {
  const suffix = error === undefined ? '' : ` (${formatErrorMessage(error)})`;
  console.warn(`[springkg] ${scope}: ${message}${suffix}`);
}
