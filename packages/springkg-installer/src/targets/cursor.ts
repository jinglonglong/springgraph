import type { SpringkgAgentTarget, DetectionResult, WriteResult } from './types.js';

export const cursorTarget: SpringkgAgentTarget = {
  id: 'cursor',
  displayName: 'Cursor',
  supportsLocation: () => false,
  detect: (): DetectionResult => ({ installed: false, alreadyConfigured: false }),
  install: (): WriteResult => ({ files: [{ path: '(stub)', action: 'not-found' }] }),
  uninstall: (): WriteResult => ({ files: [] }),
  printConfig: (): string => '// Team E will implement',
  describePaths: (): string[] => [],
};
