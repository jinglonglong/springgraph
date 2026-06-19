import { createHash } from 'node:crypto';

import type {
  CodegraphEdgeLike,
  CodegraphNodeLike,
  Resolver,
  SpringKgEnhanceInput,
  SpringKgEnhanceOutput,
  SpringKgEdge,
  SpringKgNode,
} from './shared-types';

export type FeignClientSpec = {
  codegraphNodeId: string;
  name?: string;
  value?: string;
  contextId?: string;
  path?: string;
  url?: string;
  targetServiceName: string;
  isDirectConnect: boolean;
};

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD';

type MappingSpec = {
  httpMethod: HttpMethod;
  path: string;
};

type MethodResolution = {
  methodNode: CodegraphNodeLike;
  mapping: MappingSpec;
  paramTypes: string[];
  returnType?: string;
};

function hashId(prefix: string, parts: readonly string[]): string {
  const digest = createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
  return `${prefix}:${digest}`;
}

function findDecorator(decorators: readonly string[], annotation: string): string | undefined {
  const normalizedAnnotation = annotation.toLowerCase();
  return decorators.find((decorator) => decorator.toLowerCase().includes(normalizedAnnotation));
}

function parseAttribute(decorator: string, attribute: string): string | undefined {
  const pattern = new RegExp(`${attribute}\\s*=\\s*"([^"]+)"`, 'i');
  return decorator.match(pattern)?.[1];
}

function parseStringArrayAttribute(decorator: string, attribute: string): string[] {
  const arrayPattern = new RegExp(`${attribute}\\s*=\\s*\\{([^}]*)\\}`, 'i');
  const arrayMatch = decorator.match(arrayPattern)?.[1];

  if (arrayMatch) {
    return Array.from(arrayMatch.matchAll(/"([^"]+)"/g), (match) => match[1]).filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
  }

  const single = parseAttribute(decorator, attribute);
  return single ? [single] : [];
}

function parseImplicitDecoratorPath(decorator: string): string | undefined {
  const implicitMatch = decorator.match(/^[^(]+\(\s*"([^"]+)"\s*\)/);
  return implicitMatch?.[1];
}

function normalizePath(path: string): string {
  if (path.trim().length === 0) {
    return '/';
  }

  const withLeadingSlash = path.startsWith('/') ? path : `/${path}`;
  const collapsed = withLeadingSlash.replace(/\/{2,}/g, '/');

  if (collapsed.length > 1 && collapsed.endsWith('/')) {
    return collapsed.slice(0, -1);
  }

  return collapsed;
}

function joinPaths(prefix?: string, suffix?: string): string {
  const prefixValue = prefix?.trim() ?? '';
  const suffixValue = suffix?.trim() ?? '';

  if (prefixValue.length === 0 && suffixValue.length === 0) {
    return '/';
  }

  if (prefixValue.length === 0) {
    return normalizePath(suffixValue);
  }

  if (suffixValue.length === 0) {
    return normalizePath(prefixValue);
  }

  return normalizePath(`${prefixValue}/${suffixValue}`);
}

function kebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}

function parseFeignClientSpec(node: CodegraphNodeLike): FeignClientSpec | null {
  const decorators = node.decorators ?? [];
  const feignDecorator = findDecorator(decorators, '@FeignClient');

  if (!feignDecorator) {
    return null;
  }

  const name = parseAttribute(feignDecorator, 'name');
  const value = parseAttribute(feignDecorator, 'value');
  const contextId = parseAttribute(feignDecorator, 'contextId');
  const path = parseAttribute(feignDecorator, 'path');
  const url = parseAttribute(feignDecorator, 'url');
  const targetServiceName = name ?? value ?? contextId ?? kebabCase(node.name);

  return {
    codegraphNodeId: node.id,
    name,
    value,
    contextId,
    path,
    url,
    targetServiceName,
    isDirectConnect: typeof url === 'string' && url.length > 0,
  };
}

function resolveFeignConfidence(spec: FeignClientSpec): number {
  return spec.name || spec.value ? 1 : 0.7;
}

function resolveRemoteServiceConfidence(spec: FeignClientSpec): number {
  return spec.url ? 1 : 0.8;
}

function parseRequestMappingHttpMethod(decorator: string): HttpMethod {
  const methodMatch = decorator.match(/method\s*=\s*RequestMethod\.([A-Z]+)/i)?.[1]?.toUpperCase();

  switch (methodMatch) {
    case 'POST':
    case 'PUT':
    case 'DELETE':
    case 'PATCH':
    case 'OPTIONS':
    case 'HEAD':
      return methodMatch;
    case 'GET':
    default:
      return 'GET';
  }
}

function firstPathValue(decorator: string): string {
  return (
    parseStringArrayAttribute(decorator, 'path')[0] ??
    parseStringArrayAttribute(decorator, 'value')[0] ??
    parseImplicitDecoratorPath(decorator) ??
    '/'
  );
}

function parseMappingDecorator(decorators: readonly string[]): MappingSpec | null {
  for (const decorator of decorators) {
    const normalized = decorator.toLowerCase();

    if (normalized.includes('@getmapping')) {
      return { httpMethod: 'GET', path: normalizePath(firstPathValue(decorator)) };
    }

    if (normalized.includes('@postmapping')) {
      return { httpMethod: 'POST', path: normalizePath(firstPathValue(decorator)) };
    }

    if (normalized.includes('@putmapping')) {
      return { httpMethod: 'PUT', path: normalizePath(firstPathValue(decorator)) };
    }

    if (normalized.includes('@deletemapping')) {
      return { httpMethod: 'DELETE', path: normalizePath(firstPathValue(decorator)) };
    }

    if (normalized.includes('@patchmapping')) {
      return { httpMethod: 'PATCH', path: normalizePath(firstPathValue(decorator)) };
    }

    if (normalized.includes('@requestmapping')) {
      return { httpMethod: parseRequestMappingHttpMethod(decorator), path: normalizePath(firstPathValue(decorator)) };
    }
  }

  return null;
}

function readStringMetadata(node: CodegraphNodeLike, key: string): string | undefined {
  const value = node.metadata?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readStringArrayMetadata(node: CodegraphNodeLike, key: string): string[] {
  const value = node.metadata?.[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function extractParamTypes(methodNode: CodegraphNodeLike, parameterNodes: readonly CodegraphNodeLike[]): string[] {
  if (parameterNodes.length > 0) {
    return parameterNodes.map((parameterNode) => {
      const metadataType = readStringMetadata(parameterNode, 'typeName') ?? readStringMetadata(parameterNode, 'paramType');
      return metadataType ?? parameterNode.signature ?? parameterNode.name;
    });
  }

  const methodParamTypes = readStringArrayMetadata(methodNode, 'paramTypes');
  if (methodParamTypes.length > 0) {
    return methodParamTypes;
  }

  return [];
}

function extractMethodResolutions(
  interfaceNode: CodegraphNodeLike,
  codegraphEdges: readonly CodegraphEdgeLike[],
  nodesById: ReadonlyMap<string, CodegraphNodeLike>,
): MethodResolution[] {
  const resolutions = codegraphEdges
    .filter((edge) => edge.kind === 'contains' && edge.source === interfaceNode.id)
    .map((edge) => nodesById.get(edge.target))
    .filter((node): node is CodegraphNodeLike => node !== undefined && node.kind === 'method')
    .map((methodNode) => {
      const mapping = parseMappingDecorator(methodNode.decorators ?? []);

      if (!mapping) {
        return null;
      }

      const parameterNodes = codegraphEdges
        .filter((edge) => edge.kind === 'contains' && edge.source === methodNode.id)
        .map((edge) => nodesById.get(edge.target))
        .filter((node): node is CodegraphNodeLike => node !== undefined && node.kind === 'parameter');

      return {
        methodNode,
        mapping,
        paramTypes: extractParamTypes(methodNode, parameterNodes),
        returnType: methodNode.returnType ?? readStringMetadata(methodNode, 'returnType'),
      } as MethodResolution;
    })
    .filter((resolution) => resolution !== null);

  return resolutions as MethodResolution[];
}

function buildFeignClientNode(sourceNode: CodegraphNodeLike, spec: FeignClientSpec, timestamp: number): SpringKgNode {
  return {
    id: hashId('feign_client', ['feign_client', sourceNode.id, sourceNode.filePath, sourceNode.qualifiedName ?? '']),
    kind: 'feign_client',
    codegraphNodeId: sourceNode.id,
    name: sourceNode.name,
    qualifiedName: sourceNode.qualifiedName,
    filePath: sourceNode.filePath,
    startLine: sourceNode.startLine,
    endLine: sourceNode.endLine,
    metadata: {
      name: spec.name,
      value: spec.value,
      contextId: spec.contextId,
      path: spec.path,
      url: spec.url,
      targetServiceName: spec.targetServiceName,
      isDirectConnect: spec.isDirectConnect,
    },
    confidence: resolveFeignConfidence(spec),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function buildRemoteServiceNode(spec: FeignClientSpec, timestamp: number): SpringKgNode {
  return {
    id: hashId('remote_service', ['remote_service', spec.targetServiceName]),
    kind: 'remote_service',
    codegraphNodeId: `remote-service:${spec.targetServiceName}`,
    name: spec.targetServiceName,
    qualifiedName: spec.targetServiceName,
    metadata: {
      targetServiceName: spec.targetServiceName,
      url: spec.url,
      isDirectConnect: spec.isDirectConnect,
    },
    confidence: resolveRemoteServiceConfidence(spec),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function buildFeignMethodNode(
  methodResolution: MethodResolution,
  interfaceNode: CodegraphNodeLike,
  clientNode: SpringKgNode,
  spec: FeignClientSpec,
  timestamp: number,
): SpringKgNode {
  return {
    id: hashId('feign_method', ['feign_method', methodResolution.methodNode.id, clientNode.id]),
    kind: 'feign_method',
    codegraphNodeId: methodResolution.methodNode.id,
    name: methodResolution.methodNode.name,
    qualifiedName: methodResolution.methodNode.qualifiedName,
    filePath: methodResolution.methodNode.filePath,
    startLine: methodResolution.methodNode.startLine,
    endLine: methodResolution.methodNode.endLine,
    metadata: {
      feignPath: joinPaths(spec.path, methodResolution.mapping.path),
      httpMethod: methodResolution.mapping.httpMethod,
      paramTypes: methodResolution.paramTypes,
      returnType: methodResolution.returnType,
      targetServiceName: spec.targetServiceName,
      feignClientCodegraphNodeId: interfaceNode.id,
    },
    confidence: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function buildBelongsToEdge(feignMethodNode: SpringKgNode, clientNode: SpringKgNode, timestamp: number): SpringKgEdge {
  return {
    id: hashId('BELONGS_TO', [feignMethodNode.id, clientNode.id, 'BELONGS_TO']),
    sourceId: feignMethodNode.id,
    targetId: clientNode.id,
    kind: 'BELONGS_TO',
    confidence: 1,
    createdAt: timestamp,
  };
}

export class FeignResolver implements Resolver {
  readonly name = 'feign-resolver';

  async enhance(input: SpringKgEnhanceInput): Promise<SpringKgEnhanceOutput> {
    const timestamp = Date.now();
    const nodesById = new Map(input.codegraphNodes.map((node) => [node.id, node]));
    const feignInterfaces = input.codegraphNodes.filter(
      (node) => node.kind === 'interface' && findDecorator(node.decorators ?? [], '@FeignClient'),
    );

    const nodes: SpringKgNode[] = [];
    const edges: SpringKgEdge[] = [];
    const remoteServices = new Map<string, SpringKgNode>();

    for (const interfaceNode of feignInterfaces) {
      const spec = parseFeignClientSpec(interfaceNode);
      if (!spec) {
        continue;
      }

      const clientNode = buildFeignClientNode(interfaceNode, spec, timestamp);
      nodes.push(clientNode);

      if (!remoteServices.has(spec.targetServiceName)) {
        const remoteNode = buildRemoteServiceNode(spec, timestamp);
        remoteServices.set(spec.targetServiceName, remoteNode);
        nodes.push(remoteNode);
      }

      const methodResolutions = extractMethodResolutions(interfaceNode, input.codegraphEdges, nodesById);
      for (const methodResolution of methodResolutions) {
        const feignMethodNode = buildFeignMethodNode(methodResolution, interfaceNode, clientNode, spec, timestamp);
        nodes.push(feignMethodNode);
        edges.push(buildBelongsToEdge(feignMethodNode, clientNode, timestamp));
      }
    }

    const byKind = nodes.reduce<Record<string, number>>((accumulator, node) => {
      accumulator[node.kind] = (accumulator[node.kind] ?? 0) + 1;
      return accumulator;
    }, {});

    return {
      symbolsAdded: nodes.length,
      edgesAdded: edges.length,
      byKind,
      nodes,
      edges,
    };
  }
}
