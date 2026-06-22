import { createHash } from 'node:crypto';

import { handoffTeam, shouldAdd, shouldReuse } from './policy';
import type {
  SpringgraphEdgeLike,
  SpringgraphNodeLike,
  Resolver,
  SpringKgEnhanceInput,
  SpringKgEnhanceOutput,
  SpringKgEdge,
  SpringKgNode,
  SpringKgNodeKind,
} from './shared-types';

export type SpringEntity = {
  kind: SpringKgNodeKind;
  springgraphNodeId: string;
  name: string;
  filePath: string;
  reuse: boolean;
  metadata?: Record<string, unknown>;
};

type ClassifiedEntity = SpringEntity & {
  sourceNode: SpringgraphNodeLike;
};

function hashId(prefix: string, parts: readonly string[]): string {
  const digest = createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
  return `${prefix}:${digest}`;
}

function parseDecoratorValue(decorator: string, attribute: 'name' | 'value'): string | undefined {
  const pattern = new RegExp(`${attribute}\\s*=\\s*"([^"]+)"`, 'i');
  return decorator.match(pattern)?.[1];
}

function findDecorator(decorators: readonly string[], annotation: string): string | undefined {
  const normalizedAnnotation = annotation.toLowerCase();
  return decorators.find((decorator) => decorator.toLowerCase().includes(normalizedAnnotation));
}

function classifyNode(node: SpringgraphNodeLike): SpringEntity | null {
  const decorators = node.decorators ?? [];

  if (decorators.length === 0) {
    return null;
  }

  if (handoffTeam(decorators)) {
    return null;
  }

  if (shouldAdd(decorators)) {
    const feignDecorator = findDecorator(decorators, '@FeignClient');
    if (feignDecorator) {
      const feignName = parseDecoratorValue(feignDecorator, 'name') ?? parseDecoratorValue(feignDecorator, 'value');
      return {
        kind: 'feign_client',
        springgraphNodeId: node.id,
        name: node.name,
        filePath: node.filePath,
        reuse: false,
        metadata: feignName ? { feignName } : undefined,
      };
    }

    if (findDecorator(decorators, '@Mapper')) {
      return {
        kind: 'mapper',
        springgraphNodeId: node.id,
        name: node.name,
        filePath: node.filePath,
        reuse: false,
      };
    }

    if (findDecorator(decorators, '@Configuration')) {
      return {
        kind: 'configuration',
        springgraphNodeId: node.id,
        name: node.name,
        filePath: node.filePath,
        reuse: false,
      };
    }
  }

  if (!shouldReuse(decorators)) {
    return null;
  }

  if (findDecorator(decorators, '@RestController') || findDecorator(decorators, '@Controller')) {
    return {
      kind: 'controller',
      springgraphNodeId: node.id,
      name: node.name,
      filePath: node.filePath,
      reuse: true,
    };
  }

  if (findDecorator(decorators, '@Service')) {
    return {
      kind: 'service',
      springgraphNodeId: node.id,
      name: node.name,
      filePath: node.filePath,
      reuse: true,
    };
  }

  if (findDecorator(decorators, '@Repository')) {
    return {
      kind: 'repository',
      springgraphNodeId: node.id,
      name: node.name,
      filePath: node.filePath,
      reuse: true,
    };
  }

  if (findDecorator(decorators, '@Component')) {
    return {
      kind: 'component',
      springgraphNodeId: node.id,
      name: node.name,
      filePath: node.filePath,
      reuse: true,
    };
  }

  return null;
}

function buildSpringNode(entity: ClassifiedEntity, timestamp: number): SpringKgNode {
  return {
    id: hashId(entity.kind, [entity.kind, entity.springgraphNodeId, entity.sourceNode.filePath, entity.sourceNode.qualifiedName ?? '']),
    kind: entity.kind,
    springgraphNodeId: entity.springgraphNodeId,
    name: entity.sourceNode.name,
    qualifiedName: entity.sourceNode.qualifiedName,
    filePath: entity.sourceNode.filePath,
    startLine: entity.sourceNode.startLine,
    endLine: entity.sourceNode.endLine,
    metadata: entity.metadata,
    confidence: entity.reuse ? 1 : 0.9,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function buildBelongsToEdges(
  entity: ClassifiedEntity,
  springNode: SpringKgNode,
  springgraphEdges: readonly SpringgraphEdgeLike[],
  nodesById: ReadonlyMap<string, SpringgraphNodeLike>,
  timestamp: number,
): SpringKgEdge[] {
  return springgraphEdges
    .filter((edge) => edge.kind === 'contains' && edge.source === entity.sourceNode.id)
    .map((edge) => {
      const child = nodesById.get(edge.target);
      return child ? { edge, child } : null;
    })
    .filter(
      (value): value is { edge: SpringgraphEdgeLike; child: SpringgraphNodeLike } =>
        value !== null && ['method', 'property', 'field'].includes(value.child.kind),
    )
    .map(({ child }) => ({
      id: hashId('BELONGS_TO', [child.id, springNode.id, 'BELONGS_TO']),
      sourceId: child.id,
      targetId: springNode.id,
      kind: 'BELONGS_TO',
      confidence: 1,
      createdAt: timestamp,
    }));
}

export class AnnotationSemanticEngine implements Resolver {
  readonly name = 'annotation-engine';

  async enhance(input: SpringKgEnhanceInput): Promise<SpringKgEnhanceOutput> {
    const timestamp = Date.now();
    const nodesById = new Map(input.springgraphNodes.map((node) => [node.id, node]));
    const classifiedEntities: ClassifiedEntity[] = input.springgraphNodes
      .filter((node) => ['class', 'interface'].includes(node.kind) && (node.decorators?.length ?? 0) > 0)
      .map((node) => {
        const entity = classifyNode(node);
        return entity ? { ...entity, sourceNode: node } : null;
      })
      .filter((entity): entity is ClassifiedEntity => entity !== null);

    const nodes = classifiedEntities.map((entity) => buildSpringNode(entity, timestamp));
    const springNodeBySpringgraphId = new Map(nodes.map((node) => [node.springgraphNodeId, node]));
    const edges = classifiedEntities.flatMap((entity) => {
      const springNode = springNodeBySpringgraphId.get(entity.springgraphNodeId);
      return springNode
        ? buildBelongsToEdges(entity, springNode, input.springgraphEdges, nodesById, timestamp)
        : [];
    });

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
