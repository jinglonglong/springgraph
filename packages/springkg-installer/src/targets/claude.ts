import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { SpringkgAgentTarget, Location, DetectionResult, WriteResult, InstallOptions } from './types.js';
import { getMcpServerConfig } from './shared.js';

function mcpJsonPath(loc: Location): string {
  if (loc === 'global') {
    return path.join(os.homedir(), '.claude.json');
  }
  return path.join(process.cwd(), '.mcp.json');
}

export const claudeTarget: SpringkgAgentTarget = {
  id: 'claude',
  displayName: 'Claude',
  supportsLocation: () => true,

  detect(loc: Location): DetectionResult {
    const p = mcpJsonPath(loc);
    if (!fs.existsSync(p)) {
      return { installed: false, alreadyConfigured: false };
    }
    try {
      const content = JSON.parse(fs.readFileSync(p, 'utf-8'));
      const alreadyConfigured = !!content.mcpServers?.springkg;
      return { installed: true, alreadyConfigured, configPath: p };
    } catch {
      return { installed: true, alreadyConfigured: false, configPath: p };
    }
  },

  install(loc: Location, _opts: InstallOptions): WriteResult {
    const p = mcpJsonPath(loc);
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let config: Record<string, unknown> = {};
    if (fs.existsSync(p)) {
      try { config = JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { /* start fresh */ }
    }

    if (!config.mcpServers) config.mcpServers = {};

    const mcpServers = config.mcpServers as Record<string, unknown>;
    const before = JSON.stringify(config);
    mcpServers.springkg = getMcpServerConfig();
    const after = JSON.stringify(config);

    const action = before === after ? 'unchanged' : (fs.existsSync(p) ? 'updated' : 'created');
    fs.writeFileSync(p, JSON.stringify(config, null, 2) + '\n');

    return { files: [{ path: p, action }] };
  },

  uninstall(loc: Location): WriteResult {
    const p = mcpJsonPath(loc);
    if (!fs.existsSync(p)) {
      return { files: [{ path: p, action: 'not-found' }] };
    }

    let config: Record<string, unknown> = {};
    try { config = JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return { files: [] }; }

    const mcpServers = config.mcpServers as Record<string, unknown> | undefined;
    if (!mcpServers?.springkg) {
      return { files: [{ path: p, action: 'unchanged' }] };
    }

    delete mcpServers.springkg;
    fs.writeFileSync(p, JSON.stringify(config, null, 2) + '\n');

    return { files: [{ path: p, action: 'removed' }] };
  },

  printConfig(_loc: Location): string {
    return JSON.stringify({ mcpServers: { springkg: getMcpServerConfig() } }, null, 2);
  },

  describePaths(loc: Location): string[] {
    return [mcpJsonPath(loc)];
  },
};
