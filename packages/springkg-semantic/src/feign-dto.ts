import { createHash } from 'node:crypto';

import type {
  SpringgraphEdgeLike,
  SpringgraphNodeLike,
  Resolver,
  SpringKgEdge,
  SpringKgEnhanceInput,
  SpringKgEnhanceOutput,
  SpringKgNode,
} from './shared-types';

export type FeignDtoBinding = {
  feignMethodId: string;
  requestDto?: { springgraphNodeId: string; typeName: string };
  responseDto?: { springgraphNodeId: string; typeName: string };
  paramTypes: Array<{ springgraphNodeId?: string; typeName: string; decorator?: string }>;
};

type DtoRole = 'request' | 'response';

type ResolvedParamType = {
  springgraphNodeId?: string;
  typeName: string;
  decorator?: string;
  decorators: string[];
};

type ResolvedDtoType = {
  springgraphNodeId: string;
  typeName: string;
};

function hashId(prefix: string, parts: readonly string[]): string {
  const digest = createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
  return `${prefix}:${digest}`;
}

function findDecorator(decorators: readonly string[], annotation: string): string | undefined {
  const normalizedAnnotation = annotation.toLowerCase();
  return decorators.find((decorator) => decorator.toLowerCase().includes(normalizedAnnotation));
}

function isFeignInterface(node: SpringgraphNodeLike): boolean {
  return node.kind === 'interface' && !!findDecorator(node.decorators ?? [], '@FeignClient');
}

function readStringMetadata(node: SpringgraphNodeLike, key: string): string | undefined {
  const value = node.metadata?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeTypeName(typeName: string): string {
  return typeName.replace(/^\?\s+extends\s+/i, '').replace(/^\?\s+super\s+/i, '').trim();
}

function deriveTypeName(node: SpringgraphNodeLike): string | undefined {
  const candidate =
    readStringMetadata(node, 'typeName') ??
    readStringMetadata(node, 'paramType') ??
    readStringMetadata(node, 'returnType') ??
    node.returnType ??
    node.signature;

  if (!candidate || candidate.trim().length === 0) {
    return undefined;
  }

  return normalizeTypeName(candidate);
}

function readTypeNodeId(node: SpringgraphNodeLike, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = readStringMetadata(node, key);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function stripGenerics(typeName: string): string {
  return typeName.replace(/<.*>/g, '').trim();
}

function splitTopLevelGenericArgs(typeName: string): string[] {
  const start = typeName.indexOf('<');
  const end = typeName.lastIndexOf('>');

  if (start === -1 || end === -1 || end <= start) {
    return [];
  }

  const content = typeName.slice(start + 1, end);
  const parts: string[] = [];
  let depth = 0;
  let current = '';

  for (const character of content) {
    if (character === '<') {
      depth += 1;
      current += character;
      continue;
    }

    if (character === '>') {
      depth -= 1;
      current += character;
      continue;
    }

    if (character === ',' && depth === 0) {
      const value = current.trim();
      if (value.length > 0) {
        parts.push(value);
      }
      current = '';
      continue;
    }

    current += character;
  }

  const value = current.trim();
  if (value.length > 0) {
    parts.push(value);
  }

  return parts;
}

function isPrimitiveLike(typeName: string): boolean {
  const normalized = normalizeTypeName(typeName).replace(/\[\]$/g, '').trim();
  const primitiveName = stripGenerics(normalized).replace(/^java\.lang\./i, '').replace(/^java\.util\./i, '');
  const lowerPrimitiveName = primitiveName.toLowerCase();
  const primitiveTypes = new Set([
    'void',
    'boolean',
    'byte',
    'short',
    'int',
    'long',
    'float',
    'double',
    'char',
    'string',
    'integer',
    'boolean',
    'long',
    'double',
    'float',
    'short',
    'byte',
    'character',
  ]);

  if (primitiveTypes.has(lowerPrimitiveName)) {
    return true;
  }

  const containerName = stripGenerics(normalized).replace(/^java\.util\./i, '');
  const genericArgs = splitTopLevelGenericArgs(normalized);

  if (genericArgs.length === 0) {
    return false;
  }

  if ((containerName === 'List' || containerName === 'Set' || containerName === 'Collection') && genericArgs.length === 1) {
    const [firstGenericArg] = genericArgs;
    return typeof firstGenericArg === 'string' && isPrimitiveLike(firstGenericArg);
  }

  if (containerName === 'Map' && genericArgs.length === 2) {
    return genericArgs.every((arg) => isPrimitiveLike(arg));
  }

  return false;
}

function buildDtoNode(
  feignMethodId: string,
  dto: ResolvedDtoType,
  role: DtoRole,
  timestamp: number,
): SpringKgNode {
  return {
    id: hashId('dto', ['dto', feignMethodId, role, dto.springgraphNodeId, dto.typeName]),
    kind: 'dto',
    springgraphNodeId: dto.springgraphNodeId,
    name: dto.typeName,
    qualifiedName: dto.typeName,
    metadata: {
      fromFeignMethodId: feignMethodId,
      role,
      typeName: dto.typeName,
    },
    confidence: 0.9,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function buildUsesDtoEdge(sourceId: string, targetId: string, role: DtoRole, timestamp: number): SpringKgEdge {
  return {
    id: hashId('USES_DTO', [sourceId, targetId, role, 'USES_DTO']),
    sourceId,
    targetId,
    kind: 'USES_DTO',
    metadata: { role },
    confidence: 0.9,
    createdAt: timestamp,
  };
}

function resolveParameterTypes(
  methodNode: SpringgraphNodeLike,
  springgraphEdges: readonly SpringgraphEdgeLike[],
  nodesById: ReadonlyMap<string, SpringgraphNodeLike>,
): ResolvedParamType[] {
  return springgraphEdges
    .filter((edge) => edge.kind === 'contains' && edge.source === methodNode.id)
    .map((edge) => nodesById.get(edge.target))
    .filter((node): node is SpringgraphNodeLike => node !== undefined && node.kind === 'parameter')
    .map((parameterNode) => {
      const decorators = parameterNode.decorators ?? [];
      const typeName = deriveTypeName(parameterNode) ?? parameterNode.name;
      return {
        springgraphNodeId: readTypeNodeId(parameterNode, 'typeNodeId'),
        typeName,
        decorator: decorators[0],
        decorators,
      };
    });
}

function resolveRequestDto(paramTypes: readonly ResolvedParamType[]): ResolvedDtoType | undefined {
  const requestBodyParams = paramTypes.filter((paramType) => !!findDecorator(paramType.decorators, '@RequestBody'));

  if (requestBodyParams.length !== 1) {
    return undefined;
  }

  const [requestParam] = requestBodyParams;
  if (!requestParam || !requestParam.springgraphNodeId || isPrimitiveLike(requestParam.typeName)) {
    return undefined;
  }

  return {
    springgraphNodeId: requestParam.springgraphNodeId,
    typeName: requestParam.typeName,
  };
}

function resolveResponseDto(methodNode: SpringgraphNodeLike): ResolvedDtoType | undefined {
  const typeName = deriveTypeName(methodNode);
  const springgraphNodeId = readTypeNodeId(methodNode, 'returnTypeNodeId', 'typeNodeId');

  if (!typeName || !springgraphNodeId || isPrimitiveLike(typeName)) {
    return undefined;
  }

  return {
    springgraphNodeId,
    typeName,
  };
}

function buildFeignBindings(
  input: SpringKgEnhanceInput,
  nodesById: ReadonlyMap<string, SpringgraphNodeLike>,
): FeignDtoBinding[] {
  const feignInterfaces = input.springgraphNodes.filter(isFeignInterface);
  const bindings: FeignDtoBinding[] = [];

  for (const interfaceNode of feignInterfaces) {
    const methodNodes = input.springgraphEdges
      .filter((edge) => edge.kind === 'contains' && edge.source === interfaceNode.id)
      .map((edge) => nodesById.get(edge.target))
      .filter((node): node is SpringgraphNodeLike => node !== undefined && node.kind === 'method');

    for (const methodNode of methodNodes) {
      const paramTypes = resolveParameterTypes(methodNode, input.springgraphEdges, nodesById);
      bindings.push({
        feignMethodId: methodNode.id,
        requestDto: resolveRequestDto(paramTypes),
        responseDto: resolveResponseDto(methodNode),
        paramTypes: paramTypes.map((paramType) => ({
          springgraphNodeId: paramType.springgraphNodeId,
          typeName: paramType.typeName,
          decorator: paramType.decorator,
        })),
      });
    }
  }

  return bindings;
}

export class FeignRequestResponseType implements Resolver {
  readonly name = 'feign-dto';

  async enhance(input: SpringKgEnhanceInput): Promise<SpringKgEnhanceOutput> {
    const timestamp = Date.now();
    const nodesById = new Map(input.springgraphNodes.map((node) => [node.id, node]));
    const bindings = buildFeignBindings(input, nodesById);
    const nodes: SpringKgNode[] = [];
    const edges: SpringKgEdge[] = [];

    for (const binding of bindings) {
      if (binding.requestDto) {
        const requestNode = buildDtoNode(binding.feignMethodId, binding.requestDto, 'request', timestamp);
        nodes.push(requestNode);
        edges.push(buildUsesDtoEdge(binding.feignMethodId, requestNode.id, 'request', timestamp));
      }

      if (binding.responseDto) {
        const responseNode = buildDtoNode(binding.feignMethodId, binding.responseDto, 'response', timestamp);
        nodes.push(responseNode);
        edges.push(buildUsesDtoEdge(binding.feignMethodId, responseNode.id, 'response', timestamp));
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
