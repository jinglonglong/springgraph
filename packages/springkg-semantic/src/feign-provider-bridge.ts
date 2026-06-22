import { createHash } from 'node:crypto';

import type {
  SpringgraphNodeLike,
  Resolver,
  SpringKgEdge,
  SpringKgEnhanceInput,
  SpringKgEnhanceOutput,
} from './shared-types';

type MatchRule = 'same-monorepo-exact' | 'cross-service-name';

type FeignMethodCandidate = {
  id: string;
  normalizedPath: string;
  httpMethod?: string;
  targetServiceName?: string;
};

type EndpointCandidate = {
  id: string;
  normalizedPath: string;
  httpMethod?: string;
  serviceHint?: string;
};

function hashId(prefix: string, parts: readonly string[]): string {
  const digest = createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
  return `${prefix}:${digest}`;
}

function readStringMetadata(node: SpringgraphNodeLike, key: string): string | undefined {
  const value = node.metadata?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed.length === 0) {
    return '/';
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const collapsed = withLeadingSlash.replace(/\/{2,}/g, '/');
  if (collapsed.length > 1 && collapsed.endsWith('/')) {
    return collapsed.slice(0, -1);
  }

  return collapsed;
}

function parseEndpointName(name: string): { httpMethod?: string; path?: string } {
  const match = name.match(/^([A-Z]+)\s+(\/.*)$/);
  if (!match) {
    return {};
  }

  return {
    httpMethod: match[1],
    path: match[2],
  };
}

function resolveFeignMethodCandidate(node: SpringgraphNodeLike): FeignMethodCandidate | null {
  if (node.kind !== 'feign_method') {
    return null;
  }

  const feignPath = readStringMetadata(node, 'feignPath');
  if (!feignPath) {
    return null;
  }

  return {
    id: node.id,
    normalizedPath: normalizePath(feignPath),
    httpMethod: readStringMetadata(node, 'httpMethod')?.toUpperCase(),
    targetServiceName: readStringMetadata(node, 'targetServiceName'),
  };
}

function resolveEndpointCandidate(node: SpringgraphNodeLike): EndpointCandidate | null {
  if (node.kind !== 'endpoint') {
    return null;
  }

  const parsedName = parseEndpointName(node.name);
  const metadataPath = readStringMetadata(node, 'path')
    ?? readStringMetadata(node, 'endpointPath')
    ?? readStringMetadata(node, 'fullPath')
    ?? readStringMetadata(node, 'feignPath')
    ?? parsedName.path;

  if (!metadataPath) {
    return null;
  }

  return {
    id: node.id,
    normalizedPath: normalizePath(metadataPath),
    httpMethod: (readStringMetadata(node, 'httpMethod') ?? parsedName.httpMethod)?.toUpperCase(),
    serviceHint: readStringMetadata(node, 'serviceHint'),
  };
}

function isSameMonorepoExactMatch(feignMethod: FeignMethodCandidate, endpoint: EndpointCandidate): boolean {
  if (feignMethod.normalizedPath !== endpoint.normalizedPath) {
    return false;
  }

  if (!feignMethod.httpMethod || !endpoint.httpMethod || feignMethod.httpMethod !== endpoint.httpMethod) {
    return false;
  }

  if (!endpoint.serviceHint || !feignMethod.targetServiceName) {
    return false;
  }

  return endpoint.serviceHint === feignMethod.targetServiceName || endpoint.serviceHint === 'same-monorepo';
}

function isCrossServiceNameMatch(feignMethod: FeignMethodCandidate, endpoint: EndpointCandidate): boolean {
  return feignMethod.normalizedPath === endpoint.normalizedPath;
}

function buildTargetsEndpointEdge(
  feignMethod: FeignMethodCandidate,
  endpoint: EndpointCandidate,
  matchRule: MatchRule,
  timestamp: number,
): SpringKgEdge {
  const metadata = matchRule === 'same-monorepo-exact'
    ? { matchRule }
    : { matchRule, targetServiceName: feignMethod.targetServiceName };

  return {
    id: hashId('TARGETS_ENDPOINT', [feignMethod.id, endpoint.id, matchRule]),
    sourceId: feignMethod.id,
    targetId: endpoint.id,
    kind: 'TARGETS_ENDPOINT',
    metadata,
    confidence: matchRule === 'same-monorepo-exact' ? 1 : 0.5,
    createdAt: timestamp,
  };
}

export class FeignProviderBridge implements Resolver {
  readonly name = 'feign-provider-bridge';

  async enhance(input: SpringKgEnhanceInput): Promise<SpringKgEnhanceOutput> {
    const timestamp = Date.now();
    const feignMethods = input.springgraphNodes
      .map((node) => resolveFeignMethodCandidate(node))
      .filter((candidate): candidate is FeignMethodCandidate => candidate !== null)
      .sort((left, right) => left.id.localeCompare(right.id));
    const endpoints = input.springgraphNodes
      .map((node) => resolveEndpointCandidate(node))
      .filter((candidate): candidate is EndpointCandidate => candidate !== null)
      .sort((left, right) => left.id.localeCompare(right.id));

    const edges: SpringKgEdge[] = [];

    for (const feignMethod of feignMethods) {
      const exactMatches = endpoints.filter((endpoint) => isSameMonorepoExactMatch(feignMethod, endpoint));
      const matches = exactMatches.length > 0
        ? exactMatches.map((endpoint) => ({ endpoint, matchRule: 'same-monorepo-exact' as const }))
        : endpoints
            .filter((endpoint) => isCrossServiceNameMatch(feignMethod, endpoint))
            .map((endpoint) => ({ endpoint, matchRule: 'cross-service-name' as const }));

      for (const match of matches) {
        edges.push(buildTargetsEndpointEdge(feignMethod, match.endpoint, match.matchRule, timestamp));
      }
    }

    return {
      symbolsAdded: 0,
      edgesAdded: edges.length,
      byKind: {},
      nodes: [],
      edges,
    };
  }
}
