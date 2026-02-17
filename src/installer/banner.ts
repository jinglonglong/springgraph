/**
 * Banner and branding for the CodeGraph installer
 */

import * as figlet from 'figlet';
import * as path from 'path';
import * as fs from 'fs';

// =============================================================================
// ANSI Color Helpers (same pattern as CLI to avoid chalk ESM issues)
// =============================================================================

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

export const chalk = {
  bold: (s: string) => `${colors.bold}${s}${colors.reset}`,
  dim: (s: string) => `${colors.dim}${s}${colors.reset}`,
  red: (s: string) => `${colors.red}${s}${colors.reset}`,
  green: (s: string) => `${colors.green}${s}${colors.reset}`,
  yellow: (s: string) => `${colors.yellow}${s}${colors.reset}`,
  blue: (s: string) => `${colors.blue}${s}${colors.reset}`,
  magenta: (s: string) => `${colors.magenta}${s}${colors.reset}`,
  cyan: (s: string) => `${colors.cyan}${s}${colors.reset}`,
  white: (s: string) => `${colors.white}${s}${colors.reset}`,
  gray: (s: string) => `${colors.gray}${s}${colors.reset}`,
};

/**
 * Get the package version
 */
function getVersion(): string {
  try {
    const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    return packageJson.version;
  } catch {
    return '0.0.0';
  }
}

/**
 * Display the CodeGraph banner
 */
export function showBanner(): void {
  // Generate ASCII art using figlet
  let banner: string;
  try {
    banner = figlet.textSync('CODEGRAPH', {
      font: 'ANSI Shadow',
      horizontalLayout: 'default',
    });
  } catch {
    // Fallback if figlet fails
    banner = `
   ██████╗ ██████╗ ██████╗ ███████╗ ██████╗ ██████╗  █████╗ ██████╗ ██╗  ██╗
  ██╔════╝██╔═══██╗██╔══██╗██╔════╝██╔════╝ ██╔══██╗██╔══██╗██╔══██╗██║  ██║
  ██║     ██║   ██║██║  ██║█████╗  ██║  ███╗██████╔╝███████║██████╔╝███████║
  ██║     ██║   ██║██║  ██║██╔══╝  ██║   ██║██╔══██╗██╔══██║██╔═══╝ ██╔══██║
  ╚██████╗╚██████╔╝██████╔╝███████╗╚██████╔╝██║  ██║██║  ██║██║     ██║  ██║
   ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝
`;
  }

  console.log();
  console.log(chalk.cyan(banner));
  console.log();
  console.log(`  ${chalk.bold('CodeGraph')} v${getVersion()}`);
  console.log('  Semantic code intelligence for Claude Code');
  console.log(chalk.dim('  Created by: Colby McHenry'));
  console.log();
}

/**
 * Show success checkmark
 */
export function success(message: string): void {
  console.log(chalk.green('  ✓') + ' ' + message);
}

/**
 * Show error message
 */
export function error(message: string): void {
  console.log(chalk.red('  ✗') + ' ' + message);
}

/**
 * Show info message
 */
export function info(message: string): void {
  console.log(chalk.blue('  ℹ') + ' ' + message);
}

/**
 * Show warning message
 */
export function warn(message: string): void {
  console.log(chalk.yellow('  ⚠') + ' ' + message);
}

/**
 * Show the "next steps" section after installation
 */
export function showNextSteps(location: 'global' | 'local', useNpx?: boolean): void {
  console.log();
  console.log(chalk.bold('  Done!') + ' Restart Claude Code to use CodeGraph.');
  console.log();

  if (location === 'global') {
    const cmd = useNpx ? 'npx @colbymchenry/codegraph' : 'codegraph';
    console.log(chalk.dim('  Quick start:'));
    console.log(chalk.dim('    cd your-project'));
    console.log(chalk.cyan(`    ${cmd} init -i`));
  } else {
    console.log(chalk.dim('  CodeGraph is ready to use in this project!'));
  }
  console.log();
}
