import { NodeArchitectureFacet, RoleConflict, ArchitectureLayer } from './types';

/**
 * Role Priority Constants (lower value = higher priority)
 * 1. @Controller / @RestController (entry layer)
 * 2. @Service / @ServiceImpl (business layer)
 * 3. @Repository / @Mapper (data layer)
 * 4. @Entity / @Table (model layer)
 * 5. @Configuration / @Component (infra layer)
 * 6. Default naming suffix roles (Controller, ServiceImpl, Mapper, Entity...)
 */
export const PRIORITY_CONTROLLER = 1;
export const PRIORITY_SERVICE = 2;
export const PRIORITY_MAPPER = 3;
export const PRIORITY_ENTITY = 4;
export const PRIORITY_COMPONENT = 5;
export const PRIORITY_NAMING = 6;

export const ROLE_PRIORITIES = {
  CONTROLLER: PRIORITY_CONTROLLER,
  SERVICE: PRIORITY_SERVICE,
  MAPPER: PRIORITY_MAPPER,
  ENTITY: PRIORITY_ENTITY,
  COMPONENT: PRIORITY_COMPONENT,
  NAMING: PRIORITY_NAMING,
} as const;

/**
 * Helper to determine if a facet is annotation-based.
 */
export function isAnnotationSignal(facet: NodeArchitectureFacet): boolean {
  if (facet.facetName === 'spring-annotation' || facet.facetName?.includes('annotation')) {
    return true;
  }
  if (facet.role?.startsWith('@')) {
    return true;
  }
  if (facet.evidence?.some(e => e.includes('@') || e.toLowerCase().includes('annotation'))) {
    return true;
  }
  return false;
}

/**
 * Get logical layer associated with a role name.
 */
export function getLayerForRole(role: string): ArchitectureLayer {
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
  if (norm === 'feign-client' || norm === 'feignclient') {
    return 'remote';
  }
  if (norm === 'service' || norm === 'service-impl' || norm === 'serviceimpl') {
    return 'business';
  }
  if (norm === 'mapper' || norm === 'repository') {
    return 'data';
  }
  if (norm === 'entity' || norm === 'table') {
    return 'model';
  }
  if (norm === 'config' || norm === 'configuration' || norm === 'component' || norm === 'app' || norm === 'application') {
    return 'infra';
  }
  return 'unknown';
}

/**
 * Get numeric priority of a facet (smaller = higher priority).
 */
export function getFacetPriority(facet: NodeArchitectureFacet): number {
  const role = facet.role ? facet.role.toLowerCase() : '';
  const isAnnotated = isAnnotationSignal(facet);

  if (isAnnotated) {
    if (role === 'controller' || role === 'restcontroller' || role === 'controller-advice' || role.includes('controller') || role.includes('restcontroller')) {
      return 1.0;
    }
    if (role === 'service' || role === 'service-impl' || role.includes('service')) {
      return 2.0;
    }
    if (role === 'repository' || role === 'mapper' || role.includes('repository') || role.includes('mapper')) {
      return 3.0;
    }
    if (role === 'entity' || role === 'table' || role.includes('entity') || role.includes('table')) {
      return 4.0;
    }
    if (role === 'component' || role === 'config' || role === 'configuration' || role.includes('component') || role.includes('config')) {
      return 5.0;
    }
    return 5.5; // fallback for other annotations
  } else {
    // Suffix roles
    if (role === 'controller' || role.includes('controller')) {
      return 6.1;
    }
    if (role === 'service' || role === 'service-impl' || role.includes('service')) {
      return 6.2;
    }
    if (role === 'mapper' || role === 'repository' || role.includes('mapper') || role.includes('repository')) {
      return 6.3;
    }
    if (role === 'entity' || role.includes('entity')) {
      return 6.4;
    }
    if (role === 'component' || role === 'config' || role === 'configuration' || role.includes('component') || role.includes('config')) {
      return 6.5;
    }
    return 6.9; // fallback for other naming suffixes
  }
}

/**
 * resolveRole groups node facets by nodeId, resolves competing roles by priority,
 * updates node facets in place, and returns all detected conflicts.
 */
export function resolveRole(nodeFacets: NodeArchitectureFacet[]): RoleConflict[] {
  // 1. Group facets by nodeId
  const groups = new Map<string, NodeArchitectureFacet[]>();
  for (const facet of nodeFacets) {
    const list = groups.get(facet.nodeId) || [];
    list.push(facet);
    groups.set(facet.nodeId, list);
  }

  const conflicts: RoleConflict[] = [];

  // 2. Resolve roles for each nodeId group
  for (const [nodeId, groupFacets] of groups.entries()) {
    const facetsWithRole = groupFacets.filter(f => f.role !== undefined && f.role !== null);
    if (facetsWithRole.length === 0) {
      continue;
    }

    const normalizedUniqueRoles = Array.from(new Set(facetsWithRole.map(f => f.role!.toLowerCase())));

    if (normalizedUniqueRoles.length <= 1) {
      // No conflict, all facets agree (or only one assigns a role)
      // Set the resolved role on all facets in the group for consistency
      const resolvedRole = facetsWithRole[0]?.role ?? '';
      const resolvedLayer = getLayerForRole(resolvedRole);
      const isEntry = resolvedLayer === 'entry' || resolvedLayer === 'remote' || groupFacets.some(f => f.isEntrypoint);

      for (const facet of groupFacets) {
        facet.role = resolvedRole;
        facet.layer = resolvedLayer;
        if (isEntry) {
          facet.isEntrypoint = true;
        }
      }
      continue;
    }

    // Conflict detected! Sort by priority, then confidence
    const sortedFacets = [...facetsWithRole].sort((a, b) => {
      const pA = getFacetPriority(a);
      const pB = getFacetPriority(b);
      if (pA !== pB) {
        return pA - pB; // lower number = higher priority
      }
      if (b.confidence !== a.confidence) {
        return b.confidence - a.confidence; // higher confidence first
      }
      return 0;
    });

    const winnerFacet = sortedFacets[0]!;
    const winnerRole = winnerFacet.role!;
    const winnerLayer = getLayerForRole(winnerRole);
    const isEntry = winnerLayer === 'entry' || winnerLayer === 'remote' || groupFacets.some(f => f.isEntrypoint);

    // Save conflict details before mutating
    conflicts.push({
      nodeId,
      roles: facetsWithRole.map(f => ({
        role: f.role!,
        confidence: f.confidence,
        facetName: f.facetName
      })),
      resolvedRole: winnerRole
    });

    const otherRoles = Array.from(new Set(facetsWithRole.map(f => f.role!).filter(r => r.toLowerCase() !== winnerRole.toLowerCase())));
    const tieBreakMessage = `Resolved role conflict: selected '${winnerRole}' over ${otherRoles.map(r => `'${r}'`).join(', ')} based on priority rules (winner source: ${winnerFacet.facetName}, priority: ${getFacetPriority(winnerFacet)}).`;

    // Mutate all facets for this nodeId to use the winning classification
    for (const facet of groupFacets) {
      facet.role = winnerRole;
      facet.layer = winnerLayer;
      if (isEntry) {
        facet.isEntrypoint = true;
      }
      if (!facet.evidence) {
        facet.evidence = [];
      }
      facet.evidence.push(tieBreakMessage);
    }
  }

  return conflicts;
}
