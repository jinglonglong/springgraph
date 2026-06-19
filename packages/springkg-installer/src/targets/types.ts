export type Location = 'global' | 'local';
export type SpringkgTargetId = 'claude' | 'cursor' | 'opencode';

export interface DetectionResult {
  installed: boolean;
  alreadyConfigured: boolean;
  configPath?: string;
}

export interface WriteResult {
  files: Array<{ path: string; action: 'created' | 'updated' | 'unchanged' | 'removed' | 'not-found' | 'kept' }>;
  notes?: string[];
}

export interface InstallOptions {
  autoAllow: boolean;
}

export interface SpringkgAgentTarget {
  readonly id: SpringkgTargetId;
  readonly displayName: string;
  readonly docsUrl?: string;
  supportsLocation(loc: Location): boolean;
  detect(loc: Location): DetectionResult;
  install(loc: Location, opts: InstallOptions): WriteResult;
  uninstall(loc: Location): WriteResult;
  printConfig(loc: Location): string;
  describePaths(loc: Location): string[];
}
