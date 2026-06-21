import { Node } from '../../types';
import { ArchitectureContext, NodeArchitectureFacet } from '../types';
import { AnnotationAdapter, AnnotationFact } from './types';

const SCHEDULED_ANNOTATION = 'Scheduled';
const EVENT_LISTENER_ANNOTATION = 'EventListener';
const APPLICATION_LISTENER_ANNOTATION = 'ApplicationListener';

/**
 * Matches a decorator/annotation name regardless of whether it was extracted
 * as a simple name (`@Scheduled`) or a fully-qualified name
 * (`@org.springframework.scheduling.annotation.Scheduled`).
 */
function hasDecoratorNamed(node: Node, suffix: string): boolean {
  return node.decorators?.some((d) => d === suffix || d.endsWith(`.${suffix}`)) ?? false;
}

function isScheduled(node: Node): boolean {
  return hasDecoratorNamed(node, SCHEDULED_ANNOTATION);
}

function isEventListener(node: Node): boolean {
  return (
    hasDecoratorNamed(node, EVENT_LISTENER_ANNOTATION) ||
    hasDecoratorNamed(node, APPLICATION_LISTENER_ANNOTATION)
  );
}

export const SpringScheduleEventAdapter: AnnotationAdapter = {
  id: 'spring-schedule-event',
  framework: 'spring',

  supports(node: Node, _ctx: ArchitectureContext): boolean {
    return isScheduled(node) || isEventListener(node);
  },

  collectFacts(node: Node, _ctx: ArchitectureContext): AnnotationFact[] {
    const facts: AnnotationFact[] = [];

    if (isScheduled(node)) {
      facts.push({
        adapterId: this.id,
        nodeId: node.id,
        kind: 'lifecycle',
        name: SCHEDULED_ANNOTATION,
        metadata: {
          annotation: SCHEDULED_ANNOTATION,
          trigger: 'cron/fixed-delay/fixed-rate',
        },
        confidence: 0.9,
        evidence: [
          {
            nodeId: node.id,
            facetName: this.id,
            profileName: 'spring',
            confidence: 0.9,
            evidence: [`Node ${node.qualifiedName} is annotated with @${SCHEDULED_ANNOTATION}`],
            scope: 'node',
            filePath: node.filePath,
          },
        ],
      });
    }

    if (hasDecoratorNamed(node, EVENT_LISTENER_ANNOTATION)) {
      facts.push({
        adapterId: this.id,
        nodeId: node.id,
        kind: 'lifecycle',
        name: EVENT_LISTENER_ANNOTATION,
        metadata: {
          annotation: EVENT_LISTENER_ANNOTATION,
          trigger: 'application-event',
        },
        confidence: 0.9,
        evidence: [
          {
            nodeId: node.id,
            facetName: this.id,
            profileName: 'spring',
            confidence: 0.9,
            evidence: [`Node ${node.qualifiedName} is annotated with @${EVENT_LISTENER_ANNOTATION}`],
            scope: 'node',
            filePath: node.filePath,
          },
        ],
      });
    }

    if (hasDecoratorNamed(node, APPLICATION_LISTENER_ANNOTATION)) {
      facts.push({
        adapterId: this.id,
        nodeId: node.id,
        kind: 'lifecycle',
        name: APPLICATION_LISTENER_ANNOTATION,
        metadata: {
          annotation: APPLICATION_LISTENER_ANNOTATION,
          trigger: 'application-event',
        },
        confidence: 0.9,
        evidence: [
          {
            nodeId: node.id,
            facetName: this.id,
            profileName: 'spring',
            confidence: 0.9,
            evidence: [
              `Node ${node.qualifiedName} is annotated with or implements ${APPLICATION_LISTENER_ANNOTATION}`,
            ],
            scope: 'node',
            filePath: node.filePath,
          },
        ],
      });
    }

    return facts;
  },

  assignFacet(fact: AnnotationFact): Partial<NodeArchitectureFacet>[] {
    const isScheduledFact = fact.name === SCHEDULED_ANNOTATION;
    const role = isScheduledFact ? 'ScheduledJob' : 'EventListener';
    const layer = 'entry';
    const isEntrypoint = isScheduledFact;

    return [
      {
        nodeId: fact.nodeId,
        facetName: fact.adapterId,
        role,
        layer,
        isEntrypoint,
        confidence: 0.9,
        evidence: fact.evidence.flatMap((signal) => signal.evidence),
      },
    ];
  },
};

export const springScheduleEventAdapter: AnnotationAdapter = SpringScheduleEventAdapter;
