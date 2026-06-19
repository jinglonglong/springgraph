import { createHash } from 'node:crypto';

import type {
  CodegraphEdgeLike,
  CodegraphNodeLike,
  Resolver,
  SpringKgEdge,
  SpringKgEnhanceInput,
  SpringKgEnhanceOutput,
  SpringKgNode,
} from './shared-types';

export type SpringParam = {
  name: string;
  kind: 'RequestParam' | 'PathVariable' | 'RequestBody' | 'RequestHeader';
  typeName?: string;
  required?: boolean;
};

export type SpringEndpoint = {
  codegraphNodeId: string;
  controllerCodegraphNodeId: string;
  httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD';
  path: string;
  classPath?: string;
  methodPath: string;
  params: SpringParam[];
  requestDtoCodegraphNodeId?: string;
  responseDtoCodegraphNodeId?: string;
};

type HttpMethod = SpringEndpoint['httpMethod'];

type ClassifiedParameter = SpringParam & {
  codegraphNodeId: string;
  typeNodeId?: string;
};

type EndpointCandidate = SpringEndpoint & {
  sourceMethod: CodegraphNodeLike;
};

const VERB_DECORATORS: Readonly<Record<string, HttpMethod>> = {
  '@GetMapping': 'GET',
  '@PostMapping': 'POST',
  '@PutMapping': 'PUT',
  '@DeleteMapping': 'DELETE',
  '@PatchMapping': 'PATCH',
};

const CONTROLLER_DECORATORS = ['@RestController', '@Controller'] as const;
const PARAM_DECORATORS = ['@RequestParam', '@PathVariable', '@RequestBody', '@RequestHeader'] as const;

function hashId(prefix: string, parts: readonly string[]): string {
  const digest = createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
  return `${prefix}:${digest}`;
}

function findDecorator(decorators: readonly string[] | undefined, annotation: string): string | undefined {
  const normalizedAnnotation = annotation.toLowerCase();
  return decorators?.find((decorator) => decorator.toLowerCase().includes(normalizedAnnotation));
}

function hasAnyDecorator(decorators: readonly string[] | undefined, annotations: readonly string[]): boolean {
  return annotations.some((annotation) => findDecorator(decorators, annotation));
}

function extractQuotedStrings(value: string): string[] {
  const matches = value.matchAll(/['"]([^'"]*)['"]/g);
  return Array.from(matches, (match) => match[1] ?? '').filter((entry) => entry.length > 0);
}

function readDelimitedValue(source: string, startIndex: number): string {
  const opener = source[startIndex];
  const closer = opener === '[' ? ']' : opener === '{' ? '}' : opener;
  let depth = 0;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (!char) {
      break;
    }

    if (opener === '"' || opener === "'") {
      if (index > startIndex && char === closer && source[index - 1] !== '\\') {
        return source.slice(startIndex, index + 1);
      }
      continue;
    }

    if (char === opener) {
      depth += 1;
    } else if (char === closer) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  return source.slice(startIndex).trim();
}

function extractAttributeValue(decorator: string, attribute: 'value' | 'path' | 'name'): string | undefined {
  const attributePattern = new RegExp(`${attribute}\\s*[:=]`, 'i');
  const match = attributePattern.exec(decorator);
  if (!match) {
    return undefined;
  }

  let index = match.index + match[0].length;
  while (index < decorator.length && /\s/.test(decorator[index] ?? '')) {
    index += 1;
  }

  const startChar = decorator[index];
  if (!startChar) {
    return undefined;
  }

  if (['[', '{', '"', "'"].includes(startChar)) {
    return readDelimitedValue(decorator, index);
  }

  let endIndex = index;
  while (endIndex < decorator.length && ![',', ')'].includes(decorator[endIndex] ?? '')) {
    endIndex += 1;
  }

  return decorator.slice(index, endIndex).trim();
}

function parsePathList(decorator: string): string[] {
  const configuredValue = extractAttributeValue(decorator, 'value') ?? extractAttributeValue(decorator, 'path');
  if (configuredValue) {
    const quoted = extractQuotedStrings(configuredValue);
    if (quoted.length > 0) {
      return quoted;
    }
  }

  const innerMatch = decorator.match(/@\w+\s*\((.*)\)$/i);
  const inner = innerMatch?.[1]?.trim();
  if (!inner) {
    return [''];
  }

  const quoted = extractQuotedStrings(inner);
  if (quoted.length > 0) {
    return quoted;
  }

  return [''];
}

function parseBareAnnotationName(decorator: string): string | undefined {
  const innerMatch = decorator.match(/@\w+\s*\((.*)\)$/i);
  const inner = innerMatch?.[1]?.trim();
  if (!inner || /=|:/.test(inner)) {
    return undefined;
  }

  return extractQuotedStrings(inner)[0];
}

function parseHttpMethod(decorator: string): HttpMethod | null {
  for (const [annotation, method] of Object.entries(VERB_DECORATORS)) {
    if (decorator.toLowerCase().includes(annotation.toLowerCase())) {
      return method;
    }
  }

  if (!decorator.toLowerCase().includes('@requestmapping')) {
    return null;
  }

  const requestMethodMatch = decorator.match(/method\s*[:=]\s*(?:\{\s*)?(?:RequestMethod\.)?(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)/i);
  return (requestMethodMatch?.[1]?.toUpperCase() as HttpMethod | undefined) ?? 'GET';
}

function normalizePathSegment(path: string): string {
  const trimmed = path.trim();
  if (trimmed === '') {
    return '';
  }

  return trimmed.replace(/^['"]|['"]$/g, '');
}

function joinPaths(classPath: string, methodPath: string): string {
  const parts = [classPath, methodPath]
    .map(normalizePathSegment)
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    return '/';
  }

  const merged = `/${parts.join('/')}`.replace(/\/+/g, '/');
  return merged !== '/' ? merged.replace(/\/+$/g, '') : merged;
}

function extractRequiredFlag(decorator: string): boolean {
  const requiredMatch = decorator.match(/required\s*[:=]\s*(true|false)/i);
  if (!requiredMatch) {
    return true;
  }

  return requiredMatch[1]?.toLowerCase() !== 'false';
}

function readTypeName(node: CodegraphNodeLike): string | undefined {
  const metadataTypeName = typeof node.metadata?.typeName === 'string' ? node.metadata.typeName : undefined;
  if (metadataTypeName) {
    return metadataTypeName;
  }

  if (typeof node.returnType === 'string' && node.returnType.length > 0) {
    return node.returnType;
  }

  if (typeof node.signature === 'string' && node.signature.length > 0) {
    return node.signature;
  }

  return undefined;
}

function parseParameter(node: CodegraphNodeLike): ClassifiedParameter | null {
  const decorators = node.decorators ?? [];
  const matchedDecorator = PARAM_DECORATORS
    .map((annotation) => {
      const decorator = findDecorator(decorators, annotation);
      return decorator ? { annotation, decorator } : null;
    })
    .find((value): value is { annotation: (typeof PARAM_DECORATORS)[number]; decorator: string } => value !== null);

  if (!matchedDecorator) {
    return null;
  }

  const explicitName = extractAttributeValue(matchedDecorator.decorator, 'name')
    ?? extractAttributeValue(matchedDecorator.decorator, 'value')
    ?? parseBareAnnotationName(matchedDecorator.decorator);
  const parsedNames = explicitName
    ? (extractQuotedStrings(explicitName)[0] ? extractQuotedStrings(explicitName) : [explicitName])
    : [];
  const typeNodeId = typeof node.metadata?.typeNodeId === 'string' ? node.metadata.typeNodeId : undefined;

  return {
    codegraphNodeId: node.id,
    name: parsedNames[0] ?? node.name,
    kind: matchedDecorator.annotation.slice(1) as SpringParam['kind'],
    typeName: readTypeName(node),
    required: extractRequiredFlag(matchedDecorator.decorator),
    typeNodeId,
  };
}

function buildEndpointNode(endpoint: EndpointCandidate, timestamp: number): SpringKgNode {
  return {
    id: hashId('endpoint', [
      endpoint.controllerCodegraphNodeId,
      endpoint.codegraphNodeId,
      endpoint.httpMethod,
      endpoint.path,
    ]),
    kind: 'endpoint',
    codegraphNodeId: endpoint.codegraphNodeId,
    name: `${endpoint.httpMethod} ${endpoint.path}`,
    qualifiedName: `${endpoint.sourceMethod.qualifiedName}#${endpoint.httpMethod}:${endpoint.path}`,
    filePath: endpoint.sourceMethod.filePath,
    startLine: endpoint.sourceMethod.startLine,
    endLine: endpoint.sourceMethod.endLine,
    metadata: {
      httpMethod: endpoint.httpMethod,
      classPath: endpoint.classPath,
      methodPath: endpoint.methodPath,
      params: endpoint.params,
      requestDtoCodegraphNodeId: endpoint.requestDtoCodegraphNodeId,
      responseDtoCodegraphNodeId: endpoint.responseDtoCodegraphNodeId,
      controllerCodegraphNodeId: endpoint.controllerCodegraphNodeId,
    },
    confidence: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function buildHandledByEdge(endpointNodeId: string, methodId: string, timestamp: number): SpringKgEdge {
  return {
    id: hashId('HANDLED_BY', [endpointNodeId, methodId, 'HANDLED_BY']),
    sourceId: endpointNodeId,
    targetId: methodId,
    kind: 'HANDLED_BY',
    confidence: 1,
    createdAt: timestamp,
  };
}

function buildCallsEdges(methodId: string, codegraphEdges: readonly CodegraphEdgeLike[], timestamp: number): SpringKgEdge[] {
  return codegraphEdges
    .filter((edge) => edge.kind === 'calls' && edge.source === methodId)
    .map((edge) => ({
      id: hashId('CALLS', [edge.source, edge.target, 'CALLS']),
      sourceId: edge.source,
      targetId: edge.target,
      kind: 'CALLS' as const,
      confidence: 1,
      createdAt: timestamp,
    }));
}

function findParentController(
  method: CodegraphNodeLike,
  nodesById: ReadonlyMap<string, CodegraphNodeLike>,
  codegraphEdges: readonly CodegraphEdgeLike[],
): CodegraphNodeLike | null {
  const parentEdge = codegraphEdges.find((edge) => edge.kind === 'contains' && edge.target === method.id);
  if (!parentEdge) {
    return null;
  }

  const parent = nodesById.get(parentEdge.source);
  if (!parent || parent.kind !== 'class') {
    return null;
  }

  return hasAnyDecorator(parent.decorators, CONTROLLER_DECORATORS) ? parent : null;
}

function collectMethodParameters(
  method: CodegraphNodeLike,
  nodesById: ReadonlyMap<string, CodegraphNodeLike>,
  codegraphEdges: readonly CodegraphEdgeLike[],
): ClassifiedParameter[] {
  return codegraphEdges
    .filter((edge) => edge.kind === 'contains' && edge.source === method.id)
    .map((edge) => nodesById.get(edge.target))
    .filter((node): node is CodegraphNodeLike => node !== undefined && node.kind === 'parameter')
    .map((node) => parseParameter(node))
    .filter((value): value is ClassifiedParameter => value !== null);
}

function resolveMethodDecorator(method: CodegraphNodeLike): { httpMethod: HttpMethod; methodPaths: string[] } | null {
  const decorators = method.decorators ?? [];

  for (const decorator of decorators) {
    const httpMethod = parseHttpMethod(decorator);
    if (!httpMethod) {
      continue;
    }

    return {
      httpMethod,
      methodPaths: parsePathList(decorator),
    };
  }

  return null;
}

function buildEndpointsForMethod(
  method: CodegraphNodeLike,
  controller: CodegraphNodeLike,
  classPath: string,
  parameters: readonly ClassifiedParameter[],
): EndpointCandidate[] {
  const mapping = resolveMethodDecorator(method);
  if (!mapping) {
    return [];
  }

  const requestDtoCodegraphNodeId = parameters.find((parameter) => parameter.kind === 'RequestBody')?.typeNodeId;
  const responseDtoCodegraphNodeId = typeof method.metadata?.returnTypeNodeId === 'string'
    ? method.metadata.returnTypeNodeId
    : undefined;

  return mapping.methodPaths.map((methodPath) => ({
    codegraphNodeId: method.id,
    controllerCodegraphNodeId: controller.id,
    httpMethod: mapping.httpMethod,
    path: joinPaths(classPath, methodPath),
    classPath: classPath || undefined,
    methodPath: normalizePathSegment(methodPath) || '/',
    params: parameters.map(({ codegraphNodeId: _codegraphNodeId, typeNodeId: _typeNodeId, ...parameter }) => parameter),
    requestDtoCodegraphNodeId,
    responseDtoCodegraphNodeId,
    sourceMethod: method,
  }));
}

function readClassPath(controller: CodegraphNodeLike): string {
  const requestMapping = findDecorator(controller.decorators, '@RequestMapping');
  if (!requestMapping) {
    return '';
  }

  return parsePathList(requestMapping)[0] ?? '';
}

export class EndpointResolver implements Resolver {
  readonly name = 'endpoint-resolver';

  async enhance(input: SpringKgEnhanceInput): Promise<SpringKgEnhanceOutput> {
    const timestamp = Date.now();
    const nodesById = new Map(input.codegraphNodes.map((node) => [node.id, node]));

    const candidates = input.codegraphNodes
      .filter((node) => node.kind === 'method' && hasAnyDecorator(node.decorators, ['@RequestMapping', ...Object.keys(VERB_DECORATORS)]))
      .flatMap((method) => {
        const controller = findParentController(method, nodesById, input.codegraphEdges);
        if (!controller) {
          return [];
        }

        const parameters = collectMethodParameters(method, nodesById, input.codegraphEdges);
        const classPath = readClassPath(controller);
        return buildEndpointsForMethod(method, controller, classPath, parameters);
      });

    const nodes = candidates.map((candidate) => buildEndpointNode(candidate, timestamp));
    const handledByEdges = nodes.map((node) => buildHandledByEdge(node.id, node.codegraphNodeId, timestamp));
    const callsEdges = Array.from(new Set(candidates.map((candidate) => candidate.codegraphNodeId)))
      .flatMap((methodId) => buildCallsEdges(methodId, input.codegraphEdges, timestamp));
    const edges = [...handledByEdges, ...callsEdges];

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
