import { createHash } from 'node:crypto';

import type { SpringKgEdge, SpringKgNode } from '@colbymchenry/springkg-shared';

import type { BuildOptions, FeatureCommunity, FeatureCommunityMember } from './types.js';

const DEFAULT_DENYLIST_KINDS = ['parameter', 'variable'] as const;
const DEFAULT_DENYLIST_NAMES = [
  'Result',
  'CommonResult',
  'StringUtils',
  'DateUtils',
  'Page',
  'PageInfo',
] as const;
const GENERIC_PACKAGE_SEGMENTS = new Set([
  'com',
  'org',
  'net',
  'io',
  'cn',
  'example',
  'demo',
  'src',
  'main',
  'java',
  'kotlin',
]);

interface CommunityBucket {
  affinityKey: string;
  nodeIds: string[];
}

export class CommunityBuilder {
  constructor(private readonly defaults: BuildOptions = {}) {}

  build(nodes: SpringKgNode[], edges: SpringKgEdge[], opts: BuildOptions = {}): FeatureCommunity[] {
    const options = this.mergeOptions(opts);
    const filteredNodes = nodes.filter((node) => this.isIncluded(node, options));
    const nodeMap = new Map(filteredNodes.map((node) => [node.id, node]));
    const adjacency = this.buildAdjacency(filteredNodes, edges);
    const communities: FeatureCommunity[] = [];

    for (const component of this.connectedComponents(filteredNodes, adjacency)) {
      for (const bucket of this.splitByPackageAffinity(component, nodeMap, adjacency, options.packageAffinityDepth)) {
        const bucketNodes = bucket.nodeIds
          .map((nodeId) => nodeMap.get(nodeId))
          .filter((node): node is SpringKgNode => node !== undefined);

        if (bucketNodes.length === 0) {
          continue;
        }

        const dominantPackage = this.findDominantPackage(bucketNodes, options.packageAffinityDepth);
        const label = this.autoName(dominantPackage);
        const members = bucketNodes.map<FeatureCommunityMember>((node) => ({
          communityId: '',
          springNodeId: node.id,
          membershipScore: this.membershipScore(node, dominantPackage),
        }));
        const communityId = this.communityId(dominantPackage, members.map((member) => member.springNodeId));

        for (const member of members) {
          member.communityId = communityId;
        }

        communities.push({
          id: communityId,
          label,
          summary: '',
          memberCount: members.length,
          dirty: true,
          lastSummarizedAt: undefined,
          dominantPackage,
          keywords: [],
          memberSpringNodeIds: members.map((member) => member.springNodeId),
        });
      }
    }

    return communities.sort((left, right) => {
      if (right.memberCount !== left.memberCount) {
        return right.memberCount - left.memberCount;
      }
      return left.label.localeCompare(right.label);
    });
  }

  autoName(dominantPackage: string): string {
    const segments = dominantPackage.split('.').filter(Boolean);
    if (segments.length === 0) {
      return 'community';
    }
    return segments.join('-');
  }

  private mergeOptions(opts: BuildOptions): Required<BuildOptions> {
    const packageAffinityDepth = opts.packageAffinityDepth ?? this.defaults.packageAffinityDepth ?? 2;
    return {
      denylistKinds: opts.denylistKinds ?? this.defaults.denylistKinds ?? DEFAULT_DENYLIST_KINDS,
      denylistNames: opts.denylistNames ?? this.defaults.denylistNames ?? DEFAULT_DENYLIST_NAMES,
      packageAffinityDepth,
      now: opts.now ?? this.defaults.now ?? Date.now,
    };
  }

  private isIncluded(node: SpringKgNode, options: Required<BuildOptions>): boolean {
    if (options.denylistKinds.includes(node.kind)) {
      return false;
    }
    const nodeNames = [node.name, node.qualifiedName]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .flatMap((value) => value.split(/[.$/#]/g));
    return !nodeNames.some((value) => options.denylistNames.includes(value));
  }

  private buildAdjacency(nodes: SpringKgNode[], edges: SpringKgEdge[]): Map<string, Set<string>> {
    const allowedIds = new Set(nodes.map((node) => node.id));
    const adjacency = new Map<string, Set<string>>();

    for (const node of nodes) {
      adjacency.set(node.id, new Set());
    }

    for (const edge of edges) {
      if (edge.kind === 'MEMBER_OF') {
        continue;
      }
      if (!allowedIds.has(edge.sourceId) || !allowedIds.has(edge.targetId)) {
        continue;
      }
      adjacency.get(edge.sourceId)?.add(edge.targetId);
      adjacency.get(edge.targetId)?.add(edge.sourceId);
    }

    return adjacency;
  }

  private connectedComponents(nodes: SpringKgNode[], adjacency: Map<string, Set<string>>): string[][] {
    const visited = new Set<string>();
    const components: string[][] = [];

    for (const node of nodes) {
      if (visited.has(node.id)) {
        continue;
      }
      const component: string[] = [];
      const queue = [node.id];
      visited.add(node.id);

      while (queue.length > 0) {
        const current = queue.shift();
        if (!current) {
          continue;
        }
        component.push(current);
        for (const neighbor of adjacency.get(current) ?? []) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }

      components.push(component);
    }

    return components;
  }

  private splitByPackageAffinity(
    component: string[],
    nodeMap: Map<string, SpringKgNode>,
    adjacency: Map<string, Set<string>>,
    depth: number,
  ): CommunityBucket[] {
    const buckets = new Map<string, CommunityBucket>();
    const unlabeled: string[] = [];

    for (const nodeId of component) {
      const node = nodeMap.get(nodeId);
      if (!node) {
        continue;
      }
      const affinityKey = this.affinityKey(node, depth);
      if (!affinityKey) {
        unlabeled.push(nodeId);
        continue;
      }
      const existing = buckets.get(affinityKey);
      if (existing) {
        existing.nodeIds.push(nodeId);
      } else {
        buckets.set(affinityKey, { affinityKey, nodeIds: [nodeId] });
      }
    }

    if (buckets.size <= 1) {
      return [{ affinityKey: buckets.keys().next().value ?? '', nodeIds: component.slice() }];
    }

    for (const nodeId of unlabeled) {
      const assigned = this.assignByNeighbors(nodeId, buckets, adjacency);
      if (assigned) {
        assigned.nodeIds.push(nodeId);
      } else {
        buckets.set(`singleton:${nodeId}`, { affinityKey: `singleton:${nodeId}`, nodeIds: [nodeId] });
      }
    }

    return [...buckets.values()]
      .map((bucket) => ({
        affinityKey: bucket.affinityKey,
        nodeIds: [...new Set(bucket.nodeIds)].sort(),
      }))
      .filter((bucket) => bucket.nodeIds.length > 0);
  }

  private assignByNeighbors(
    nodeId: string,
    buckets: Map<string, CommunityBucket>,
    adjacency: Map<string, Set<string>>,
  ): CommunityBucket | undefined {
    const scores = new Map<string, number>();
    for (const neighborId of adjacency.get(nodeId) ?? []) {
      for (const [key, bucket] of buckets.entries()) {
        if (bucket.nodeIds.includes(neighborId)) {
          scores.set(key, (scores.get(key) ?? 0) + 1);
        }
      }
    }
    const ranked = [...scores.entries()].sort((left, right) => right[1] - left[1]);
    const bestMatch = ranked[0];
    return bestMatch ? buckets.get(bestMatch[0]) : undefined;
  }

  private findDominantPackage(nodes: SpringKgNode[], depth: number): string {
    const counts = new Map<string, number>();
    for (const node of nodes) {
      const key = this.affinityKey(node, depth);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const dominant = [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
    return dominant && dominant.length > 0 ? dominant : 'community';
  }

  private affinityKey(node: SpringKgNode, depth: number): string {
    const segments = this.packageSegments(node);
    return segments.slice(0, depth).join('.');
  }

  private packageSegments(node: SpringKgNode): string[] {
    const fromQualifiedName = typeof node.qualifiedName === 'string' ? node.qualifiedName.split('.') : [];
    const normalized = fromQualifiedName.length > 1
      ? fromQualifiedName.slice(0, -1)
      : this.filePathSegments(node.filePath);

    return normalized.filter((segment) => {
      const lower = segment.toLowerCase();
      return segment.length > 0 && !GENERIC_PACKAGE_SEGMENTS.has(lower) && !/^[A-Z]/.test(segment);
    });
  }

  private filePathSegments(filePath: string | undefined): string[] {
    if (!filePath) {
      return [];
    }
    return filePath
      .replace(/\\/g, '/')
      .split('/')
      .filter((segment) => /^[a-z][a-z0-9_-]*$/i.test(segment));
  }

  private membershipScore(node: SpringKgNode, dominantPackage: string): number {
    const nodePackage = this.affinityKey(node, dominantPackage.split('.').length);
    return nodePackage === dominantPackage ? 1 : 0.5;
  }

  private communityId(dominantPackage: string, memberIds: string[]): string {
    const digest = createHash('sha256')
      .update(`${dominantPackage}|${memberIds.sort().join('|')}`)
      .digest('hex')
      .slice(0, 16);
    return `feature_community:${digest}`;
  }
}
