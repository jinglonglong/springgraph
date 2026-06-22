#!/usr/bin/env node
/**
 * SpringKg CLI — main entry point.
 *
 * Registers all 9 top-level commands:
 *   install / uninstall  — agent wiring (Team I)
 *   init                  — initialize springkg.db
 *   index                 — run the indexer
 *   status                — show statistics
 *   inspect               — query symbols (endpoint/feign/mapper/config)
 *   watch                 — file watcher with auto-sync
 *   rebuild-community     — regenerate feature community summaries
 *   uninit                — remove springkg.db (NOT springgraph.db)
 */

import { Command } from 'commander';
import { runInstall, runUninstall } from './commands/install.js';
import { runInit } from './commands/init.js';
import { runIndex } from './commands/index-cmd.js';
import { runStatus } from './commands/status.js';
import { runWatch } from './commands/watch.js';
import { runInspectEndpoint, runInspectFeign, runInspectMapper, runInspectConfig } from './commands/inspect.js';
import { runRebuildCommunity, runUninit } from './commands/rebuild-community.js';

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('springkg')
    .description('SpringKg CLI — code intelligence for Spring Boot projects')
    .option('--project-path <path>', 'Project path', process.cwd());

  // ---------------------------------------------------------------------------
  // install / uninstall (agent wiring)
  // ---------------------------------------------------------------------------

  program
    .command('install')
    .description('Install SpringKg MCP server into agent config')
    .option('--target <ids>', 'Comma-separated target ids (claude,cursor,opencode,all,none)', 'all')
    .option('--location <loc>', 'global or local', 'global')
    .option('--yes', 'Skip prompts, non-interactive', false)
    .option('--print-config <id>', 'Dump MCP config snippet for a target (no file writes)')
    .action((opts) => {
      const exitCode = runInstall({
        target: opts.target,
        location: opts.location as 'global' | 'local',
        yes: opts.yes,
        printConfig: opts.printConfig,
      });
      process.exit(exitCode);
    });

  program
    .command('uninstall')
    .description('Remove SpringKg MCP server from agent config')
    .option('--target <ids>', 'Comma-separated target ids', 'all')
    .option('--location <loc>', 'global or local', 'global')
    .option('--yes', 'Skip prompts, non-interactive', false)
    .action((opts) => {
      const exitCode = runUninstall({
        target: opts.target,
        location: opts.location as 'global' | 'local',
        yes: opts.yes,
      });
      process.exit(exitCode);
    });

  // ---------------------------------------------------------------------------
  // init / index / status (DB lifecycle)
  // ---------------------------------------------------------------------------

  program
    .command('init')
    .description('Initialize SpringKg database for a project')
    .action(async () => {
      const projectPath = program.opts().projectPath || process.cwd();
      try {
        await runInit(projectPath);
        process.exit(0);
      } catch (err) {
        console.error('Failed to initialize SpringKg:', err);
        process.exit(1);
      }
    });

  program
    .command('index')
    .description('Run the indexer to build the knowledge graph')
    .action(async () => {
      const projectPath = program.opts().projectPath || process.cwd();
      try {
        await runIndex(projectPath);
        process.exit(0);
      } catch (err) {
        console.error('Failed to index:', err);
        process.exit(1);
      }
    });

  program
    .command('status')
    .description('Show statistics about the indexed project')
    .action(async () => {
      const projectPath = program.opts().projectPath || process.cwd();
      try {
        await runStatus(projectPath);
        process.exit(0);
      } catch (err) {
        console.error('Failed to get status:', err);
        process.exit(1);
      }
    });

  // ---------------------------------------------------------------------------
  // inspect (query subcommands)
  // ---------------------------------------------------------------------------

  const inspectCmd = program
    .command('inspect')
    .description('Inspect a symbol (endpoint/feign/mapper/config)');

  inspectCmd
    .command('endpoint <url>')
    .description('Look up an HTTP endpoint by URL')
    .action(async (url: string) => {
      const projectPath = program.opts().projectPath || process.cwd();
      try {
        await runInspectEndpoint(projectPath, url);
        process.exit(0);
      } catch (err) {
        console.error('Failed to inspect endpoint:', err);
        process.exit(1);
      }
    });

  inspectCmd
    .command('feign <name>')
    .description('Look up a Feign client by name')
    .action(async (name: string) => {
      const projectPath = program.opts().projectPath || process.cwd();
      try {
        await runInspectFeign(projectPath, name);
        process.exit(0);
      } catch (err) {
        console.error('Failed to inspect feign:', err);
        process.exit(1);
      }
    });

  inspectCmd
    .command('mapper <namespace>')
    .description('Look up a MyBatis mapper by namespace')
    .action(async (namespace: string) => {
      const projectPath = program.opts().projectPath || process.cwd();
      try {
        await runInspectMapper(projectPath, namespace);
        process.exit(0);
      } catch (err) {
        console.error('Failed to inspect mapper:', err);
        process.exit(1);
      }
    });

  inspectCmd
    .command('config <key>')
    .description('Look up a runtime config property by key (sensitive values never returned)')
    .action(async (key: string) => {
      const projectPath = program.opts().projectPath || process.cwd();
      try {
        await runInspectConfig(projectPath, key);
        process.exit(0);
      } catch (err) {
        console.error('Failed to inspect config:', err);
        process.exit(1);
      }
    });

  // ---------------------------------------------------------------------------
  // watch (file system watcher)
  // ---------------------------------------------------------------------------

  program
    .command('watch')
    .description('Watch for file changes and auto-sync the graph')
    .action(async () => {
      const projectPath = program.opts().projectPath || process.cwd();
      try {
        await runWatch(projectPath);
        process.exit(0);
      } catch (err) {
        console.error('Failed to watch:', err);
        process.exit(1);
      }
    });

  // ---------------------------------------------------------------------------
  // rebuild-community / uninit
  // ---------------------------------------------------------------------------

  program
    .command('rebuild-community')
    .description('Regenerate feature community summaries')
    .action(async () => {
      const projectPath = program.opts().projectPath || process.cwd();
      try {
        await runRebuildCommunity(projectPath);
        process.exit(0);
      } catch (err) {
        console.error('Failed to rebuild community:', err);
        process.exit(1);
      }
    });

  program
    .command('uninit')
    .description('Remove SpringKg from a project (deletes springkg.db only, NOT springgraph.db)')
    .option('--force', 'Skip confirmation prompt', false)
    .action(async (opts) => {
      const projectPath = program.opts().projectPath || process.cwd();
      try {
        if (!opts.force) {
          console.log(`This will delete .springgraph/springkg.db under: ${projectPath}`);
          console.log('(springgraph.db will NOT be touched. Use --force to skip this prompt.)');
        }
        await runUninit(projectPath);
        process.exit(0);
      } catch (err) {
        console.error('Failed to uninit:', err);
        process.exit(1);
      }
    });

  return program;
}

export function main(): void {
  const program = buildProgram();
  program.parse();
}

// Library exports for programmatic use
export { runInstall, runUninstall } from './commands/install.js';
export { runInit } from './commands/init.js';
export { runIndex } from './commands/index-cmd.js';
export { runStatus } from './commands/status.js';
export { runWatch } from './commands/watch.js';
export { runInspectEndpoint, runInspectFeign, runInspectMapper, runInspectConfig } from './commands/inspect.js';
export { runRebuildCommunity, runUninit } from './commands/rebuild-community.js';
export type { InstallCommandOptions, UninstallCommandOptions } from './commands/install.js';

// Auto-run when invoked as a bin (commander parses argv[1..]).
// When imported as a library, callers should call buildProgram() or main() explicitly.
main();
