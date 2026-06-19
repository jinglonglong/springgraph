import { ALL_TARGETS, resolveTargetFlag } from '@colbymchenry/springkg-installer';
import type { Location, InstallOptions } from '@colbymchenry/springkg-installer';

export interface InstallCommandOptions {
  target: string;
  location: Location;
  yes: boolean;
  printConfig?: string;
}

export function runInstall(opts: InstallCommandOptions): number {
  // --print-config: dump snippet, no filesystem writes
  if (opts.printConfig) {
    const target = ALL_TARGETS.find(t => t.id === opts.printConfig);
    if (!target) {
      console.error(`Unknown target: ${opts.printConfig}`);
      return 1;
    }
    console.log(target.printConfig(opts.location));
    return 0;
  }

  const targets = resolveTargetFlag(opts.target, opts.location);
  if (targets.length === 0) {
    if (opts.target === 'none') return 0;
    console.error(`No valid targets found for: ${opts.target}`);
    return 1;
  }

  const installOpts: InstallOptions = { autoAllow: opts.yes };

  for (const target of targets) {
    const result = target.install(opts.location, installOpts);
    for (const file of result.files) {
      console.log(`${file.action}: ${file.path}`);
    }
    if (result.notes) {
      for (const note of result.notes) {
        console.log(`  note: ${note}`);
      }
    }
  }

  return 0;
}

export interface UninstallCommandOptions {
  target: string;
  location: Location;
  yes: boolean;
}

export function runUninstall(opts: UninstallCommandOptions): number {
  const targets = resolveTargetFlag(opts.target, opts.location);
  if (targets.length === 0) {
    if (opts.target === 'none') return 0;
    console.error(`No valid targets found for: ${opts.target}`);
    return 1;
  }

  for (const target of targets) {
    const result = target.uninstall(opts.location);
    for (const file of result.files) {
      console.log(`${file.action}: ${file.path}`);
    }
  }

  return 0;
}
