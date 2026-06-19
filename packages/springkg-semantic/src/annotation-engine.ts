import { createHash } from 'node:crypto';

import { handoffTeam, shouldAdd, shouldReuse } from './policy';
import type {
  CodegraphEdgeLike,
  CodegraphNodeLike,
  Resolver,
  SpringKgEnhanceInput,
  SpringKgEnhanceOutput,
  SpringKgEdge,
  SpringKgNode,
  SpringKgNodeKind,
} from './shared-types';

export type SpringEntity = {
  kind: SpringKgNodeKind;
  codegraphNodeId: string;
  name: string;
  filePath: string;
  reuse: boolean;
  metadata?: Record<string, unknown>;
};

type ClassifiedEntity = SpringEntity & {
  sourceNode: CodegraphNodeLike;
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

function classifyNode(node: CodegraphNodeLike): SpringEntity | null {
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
        codegraphNodeId: node.id,
        name: node.name,
        filePath: node.filePath,
        reuse: false,
        metadata: feignName ? { feignName } : undefined,
      };
    }

    if (findDecorator(decorators, '@Mapper')) {
      return {
        kind: 'mapper',
        codegraphNodeId: node.id,
        name: node.name,
        filePath: node.filePath,
        reuse: false,
      };
    }

    if (findDecorator(decorators, '@Configuration')) {
      return {
        kind: 'configuration',
        codegraphNodeId: node.id,
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
      codegraphNodeId: node.id,
      name: node.name,
      filePath: node.filePath,
      reuse: true,
    };
  }

  if (findDecorator(decorators, '@Service')) {
    return {
      kind: 'service',
      codegraphNodeId: node.id,
      name: node.name,
      filePath: node.filePath,
      reuse: true,
    };
  }

  if (findDecorator(decorators, '@Repository')) {
    return {
      kind: 'repository',
      codegraphNodeId: node.id,
      name: node.name,
      filePath: node.filePath,
      reuse: true,
    };
  }

  if (findDecorator(decorators, '@Component')) {
    return {
      kind: 'component',
      codegraphNodeId: node.id,
      name: node.name,
      filePath: node.filePath,
      reuse: true,
    };
  }

  return null;
}

function buildSpringNode(entity: ClassifiedEntity, timestamp: number): SpringKgNode {
  return {
    id: hashId(entity.kind, [entity.kind, entity.codegraphNodeId, entity.sourceNode.filePath, entity.sourceNode.qualifiedName]),
    kind: entity.kind,
    codegraphNodeId: entity.codegraphNodeId,
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
  codegraphEdges: readonly CodegraphEdgeLike[],
  nodesById: ReadonlyMap<string, CodegraphNodeLike>,
  timestamp: number,
): SpringKgEdge[] {
  return codegraphEdges
    .filter((edge) => edge.kind === 'contains' && edge.source === entity.sourceNode.id)
    .map((edge) => {
      const child = nodesById.get(edge.target);
      return child ? { edge, child } : null;
    })
    .filter(
      (value): value is { edge: CodegraphEdgeLike; child: CodegraphNodeLike } =>
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
    const nodesById = new Map(input.codegraphNodes.map((node) => [node.id, node]));
    const classifiedEntities: ClassifiedEntity[] = input.codegraphNodes
      .filter((node) => ['class', 'interface'].includes(node.kind) && (node.decorators?.length ?? 0) > 0)
      .map((node) => {
        const entity = classifyNode(node);
        return entity ? { ...entity, sourceNode: node } : null;
      })
      .filter((entity): entity is ClassifiedEntity => entity !== null);

    const nodes = classifiedEntities.map((entity) => buildSpringNode(entity, timestamp));
    const springNodeByCodegraphId = new Map(nodes.map((node) => [node.codegraphNodeId, node]));
    const edges = classifiedEntities.flatMap((entity) => {
      const springNode = springNodeByCodegraphId.get(entity.codegraphNodeId);
      return springNode
        ? buildBelongsToEdges(entity, springNode, input.codegraphEdges, nodesById, timestamp)
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
