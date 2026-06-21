import { Node } from '../types';
import { ArchitectureLayer, ArchitectureRole } from './types';

/**
 * Lightweight role/layer inference for a single Node.
 *
 * This is intentionally simpler than the full FacetEngine + resolveRole pipeline:
 * it is used by the trace/impact wrappers when they need a quick architectural
 * classification of nodes already returned by graph traversal. It mirrors the
 * annotation + naming-suffix rules from role-assignment.ts but operates on the
 * public Node type so it can be applied to any node without running profile
 * detection first.
 */
export interface InferredArchitecture {
  role?: ArchitectureRole;
  layer?: ArchitectureLayer;
  isEntrypoint?: boolean;
}

/**
 * Infer the architectural role for a node from its decorators and name.
 */
export function inferRoleFromNode(node: Node): ArchitectureRole | undefined {
  const decorators = node.decorators ?? [];
  const name = node.name;
  const qname = node.qualifiedName.toLowerCase();
  const lowerName = name.toLowerCase();

  // Annotation-based roles (highest confidence)
  for (const d of decorators) {
    const dl = d.toLowerCase();
    if (dl.includes('restcontroller') || dl.includes('controller')) return 'controller';
    if (dl.includes('service')) return 'service';
    if (dl.includes('repository') || dl.includes('mapper')) {
      return dl.includes('repository') ? 'repository' : 'mapper';
    }
    if (dl.includes('entity') || dl.includes('table')) return 'entity';
    if (dl.includes('configuration') || dl.includes('component')) {
      return dl.includes('configuration') ? 'configuration' : 'component';
    }
    if (dl.includes('feignclient')) return 'feign-client';
    if (dl.includes('scheduler')) return 'scheduler';
    if (dl.includes('eventlistener') || dl.includes('event_listener')) return 'event-listener';
  }

  // Naming-suffix roles
  if (lowerName.endsWith('controller') || qname.endsWith('controller')) return 'controller';
  if (lowerName.endsWith('service') || lowerName.endsWith('serviceimpl') || qname.endsWith('service')) return 'service';
  if (lowerName.endsWith('mapper') || qname.endsWith('mapper')) return 'mapper';
  if (lowerName.endsWith('repository') || qname.endsWith('repository')) return 'repository';
  if (lowerName.endsWith('entity') || qname.endsWith('entity')) return 'entity';
  if (lowerName.endsWith('config') || lowerName.endsWith('configuration')) return 'configuration';
  if (lowerName.endsWith('component')) return 'component';

  return undefined;
}

/**
 * Map a normalized role name to its logical architecture layer.
 */
export function inferLayerForRole(role: ArchitectureRole): ArchitectureLayer {
  const norm = role.toLowerCase().replace(/^@/, '');
  if (
    norm === 'controller' ||
    norm === 'restcontroller' ||
    norm === 'rest-controller' ||
    norm === 'controller-advice' ||
    norm === 'controlleradvice' ||
    norm === 'scheduler' ||
    norm === 'event-listener' ||
    norm === 'eventlistener' ||
    norm === 'filter' ||
    norm === 'websocket'
  ) {
    return 'entry';
  }
  if (norm === 'feign-client' || norm === 'feignclient') return 'remote';
  if (norm === 'service' || norm === 'service-impl' || norm === 'serviceimpl') return 'business';
  if (norm === 'mapper' || norm === 'repository') return 'data';
  if (norm === 'entity' || norm === 'table') return 'model';
  if (norm === 'config' || norm === 'configuration' || norm === 'component' || norm === 'app' || norm === 'application') {
    return 'infra';
  }
  return 'unknown';
}

/**
 * Full lightweight inference for a node.
 */
export function inferArchitecture(node: Node): InferredArchitecture {
  const role = inferRoleFromNode(node);
  if (!role) {
    return {};
  }
  const layer = inferLayerForRole(role);
  const isEntrypoint = layer === 'entry' || layer === 'remote';
  return { role, layer, isEntrypoint };
}
