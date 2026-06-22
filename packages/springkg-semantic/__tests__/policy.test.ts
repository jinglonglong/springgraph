import { describe, expect, it } from 'vitest';

import type { SpringKgNodeKind } from '../src/shared-types';
import {
  ADD_DECORATORS,
  HANDOFF_DECORATORS,
  REUSE_DECORATORS,
  ReusePolicy,
  handoffTeam,
  shouldAdd,
  shouldReuse,
} from '../src/policy';

describe('policy', () => {
  it.each(REUSE_DECORATORS)('treats %s as REUSE when no ADD decorator is present', (decorator) => {
    expect(shouldReuse([decorator])).toBe(true);
    expect(shouldAdd([decorator])).toBe(false);
  });

  it.each(ADD_DECORATORS)('treats %s as ADD', (decorator) => {
    const decoratedValue = `${decorator}(name="demo")`;

    expect(shouldAdd([decoratedValue])).toBe(true);
    expect(shouldReuse([decoratedValue])).toBe(false);
  });

  it('lets ADD win over REUSE when decorators conflict', () => {
    const decorators = ['@Component', '@Mapper'];

    expect(shouldAdd(decorators)).toBe(true);
    expect(shouldReuse(decorators)).toBe(false);
  });

  it('routes Team D handoff decorators to the runtime team', () => {
    expect(HANDOFF_DECORATORS['@ConfigurationProperties']).toBe('team-d-runtime');
    expect(handoffTeam(['@ConfigurationProperties(prefix="app")'])).toBe('team-d-runtime');
  });

  it('returns no policy match for unknown decorators', () => {
    const decorators = ['@UnknownThing', '@AnotherCustomAnnotation(value="x")'];

    expect(shouldReuse(decorators)).toBe(false);
    expect(shouldAdd(decorators)).toBe(false);
    expect(handoffTeam(decorators)).toBeNull();
  });

  it('dedups reuse rows idempotently with a fake local db', () => {
    const policy = new ReusePolicy();
    const seen = new Set<string>();
    const fakeDb = {
      hasSymbol(kind: SpringKgNodeKind, springgraphNodeId: string): boolean {
        return seen.has(`${kind}:${springgraphNodeId}`);
      },
    };

    expect(policy.dedup('service', 'id-1', fakeDb)).toBe(true);

    seen.add('service:id-1');

    expect(policy.dedup('service', 'id-1', fakeDb)).toBe(false);
  });

  it('matches decorators case-insensitively and by substring content', () => {
    expect(shouldAdd(['@feignclient(name="user-svc")'])).toBe(true);
    expect(shouldReuse(['@requestmapping(path="/users")'])).toBe(true);
  });
});
