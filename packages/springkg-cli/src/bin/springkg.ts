#!/usr/bin/env node

import { runInstall, runUninstall } from '../commands/install.js';

const args = process.argv.slice(2);
const command = args[0];

function parseFlag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

if (!command || command === '--help' || command === '-h') {
  console.log(`Usage: springkg <command> [options]

Commands:
  install     Install springkg MCP server into agent config
  uninstall   Remove springkg MCP server from agent config

Options:
  --target <ids>    Comma-separated target ids (claude,cursor,opencode,all,none)
  --location <loc>  global or local (default: global)
  --yes             Skip prompts, non-interactive
  --print-config <id>  Dump MCP config snippet for a target (no file writes)
  --help            Show this help message
`);
  process.exit(0);
}

const location = (parseFlag('location') || 'global') as 'global' | 'local';
const target = parseFlag('target') || 'all';
const yes = hasFlag('yes');
const printConfig = parseFlag('print-config');

let exitCode: number;

if (command === 'install') {
  exitCode = runInstall({ target, location, yes, printConfig });
} else if (command === 'uninstall') {
  exitCode = runUninstall({ target, location, yes });
} else {
  console.error(`Unknown command: ${command}`);
  console.error('Run "springkg --help" for usage.');
  exitCode = 1;
}

process.exit(exitCode);
