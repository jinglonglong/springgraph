import type { SpringKgNodeKind } from './shared-types';

export const REUSE_DECORATORS = [
  '@RestController',
  '@Controller',
  '@Service',
  '@Repository',
  '@Component',
  '@GetMapping',
  '@PostMapping',
  '@PutMapping',
  '@DeleteMapping',
  '@PatchMapping',
  '@RequestMapping',
  '@PathVariable',
  '@RequestParam',
  '@RequestHeader',
] as const;

export const ADD_DECORATORS = [
  '@FeignClient',
  '@Mapper',
  '@Configuration',
  '@Bean',
] as const;

export const HANDOFF_DECORATORS = {
  '@ConfigurationProperties': 'team-d-runtime',
} as const;

export type HandoffTeam = (typeof HANDOFF_DECORATORS)[keyof typeof HANDOFF_DECORATORS] | 'team-c-data';

export type ReusePolicyDb = {
  hasSymbol(kind: SpringKgNodeKind, codegraphNodeId: string): boolean;
};

function normalizeDecorators(decorators: readonly string[]): string[] {
  return decorators.map((decorator) => decorator.toLowerCase());
}

function matchesDecorator(
  decorators: readonly string[],
  policyDecorators: readonly string[],
): boolean {
  const normalizedDecorators = normalizeDecorators(decorators);
  const normalizedPolicyDecorators = policyDecorators.map((decorator) => decorator.toLowerCase());

  return normalizedDecorators.some((decorator) =>
    normalizedPolicyDecorators.some((policyDecorator) => decorator.includes(policyDecorator)),
  );
}

export function shouldReuse(decorators: string[]): boolean {
  return matchesDecorator(decorators, REUSE_DECORATORS) && !shouldAdd(decorators);
}

export function shouldAdd(decorators: string[]): boolean {
  return matchesDecorator(decorators, ADD_DECORATORS);
}

export function handoffTeam(decorators: string[]): HandoffTeam | null {
  const normalizedDecorators = normalizeDecorators(decorators);

  for (const [decorator, team] of Object.entries(HANDOFF_DECORATORS) as Array<
    [keyof typeof HANDOFF_DECORATORS, (typeof HANDOFF_DECORATORS)[keyof typeof HANDOFF_DECORATORS]]
  >) {
    const normalizedPolicyDecorator = decorator.toLowerCase();
    if (normalizedDecorators.some((candidate) => candidate.includes(normalizedPolicyDecorator))) {
      return team;
    }
  }

  return null;
}

export class ReusePolicy {
  // Mirrors the future Team A DB contract safely for Team B's local tests:
  // the real implementation will query spring_symbols by (kind, codegraph_node_id)
  // before insert, but for now we depend on a tiny DB-like surface we can fake in tests.
  dedup(kind: SpringKgNodeKind, codegraphNodeId: string, db: ReusePolicyDb): boolean {
    return !db.hasSymbol(kind, codegraphNodeId);
  }
}
