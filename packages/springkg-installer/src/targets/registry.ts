import type { SpringkgAgentTarget, Location, SpringkgTargetId } from './types.js';
import { claudeTarget } from './claude.js';
import { cursorTarget } from './cursor.js';
import { opencodeTarget } from './opencode.js';

export const ALL_TARGETS: ReadonlyArray<SpringkgAgentTarget> = Object.freeze([
  claudeTarget, cursorTarget, opencodeTarget,
]);

export function getTarget(id: string): SpringkgAgentTarget | undefined {
  return ALL_TARGETS.find(t => t.id === id);
}

export function listTargetIds(): SpringkgTargetId[] {
  return ALL_TARGETS.map(t => t.id);
}

export function detectAll(loc: Location) {
  return ALL_TARGETS.map(t => ({ id: t.id, displayName: t.displayName, ...t.detect(loc) }));
}

export function resolveTargetFlag(value: string, loc: Location): SpringkgAgentTarget[] {
  const ids = value.split(',').map(s => s.trim().toLowerCase());
  const result: SpringkgAgentTarget[] = [];
  for (const id of ids) {
    if (id === 'all') {
      result.push(...ALL_TARGETS.filter(t => t.supportsLocation(loc)));
    } else if (id === 'none' || id === 'auto') {
      // skip
    } else {
      const target = getTarget(id);
      if (target && target.supportsLocation(loc)) result.push(target);
    }
  }
  return result;
}
