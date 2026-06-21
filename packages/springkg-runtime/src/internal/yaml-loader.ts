import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import type { ConfigFileContent } from '../types.js';
import { logResolverWarning } from '../types.js';

export interface ConfigFile {
  path: string;
  content: ConfigFileContent;
  profile?: string;
  priority: number;
}



/**
 * Parse .properties file content into key-value pairs
 */
function parseProperties(content: string): ConfigFileContent {
  const result: ConfigFileContent = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) {
      continue;
    }

    // Handle line continuation with backslash
    let expandedLine = trimmed;
    while (expandedLine.endsWith('\\')) {
      const nextLineIndex = lines.indexOf(line) + 1;
      if (nextLineIndex < lines.length) {
        expandedLine = expandedLine.slice(0, -1) + (lines[nextLineIndex]?.trim() ?? '');
      } else {
        break;
      }
    }

    const eqIndex = expandedLine.indexOf('=');
    const colonIndex = expandedLine.indexOf(':');
    const splitIndex = eqIndex === -1 ? colonIndex : colonIndex === -1 ? eqIndex : Math.min(eqIndex, colonIndex);

    if (splitIndex === -1) continue;

    const key = expandedLine.slice(0, splitIndex).trim();
    let value = expandedLine.slice(splitIndex + 1).trim();

    // Remove surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

/**
 * Check if a file matches a profile pattern
 */
function extractProfile(filename: string): string | undefined {
  const match = filename.match(/^application-(.+)\.(yml|yaml|properties)$/);
  return match ? match[1] : undefined;
}

/**
 * Determine file priority: bootstrap=100, application=50, profile-specific=25
 */
function determinePriority(filename: string, profile?: string): number {
  if (filename.startsWith('bootstrap')) {
    return 100;
  }
  if (profile) {
    return 25;
  }
  return 50;
}

/**
 * Load and parse a config file
 */
function loadFile(filePath: string): ConfigFileContent | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    if (filePath.endsWith('.properties')) {
      return parseProperties(content);
    }
    const loaded = yaml.load(content);
    if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) {
      return {};
    }
    return loaded as ConfigFileContent;
  } catch (error) {
    logResolverWarning('YamlLoader', `failed to load config file ${filePath}`, error);
    return null;
  }
}

/**
 * Scan all config files in src/main/resources and src/test/resources directories
 */
export async function loadConfigFiles(projectPath: string): Promise<ConfigFile[]> {
  const results: ConfigFile[] = [];
  const basePaths = [path.join(projectPath, 'src', 'main', 'resources')];

  // Add test resources if 'test' profile might be active
  basePaths.push(path.join(projectPath, 'src', 'test', 'resources'));

  for (const basePath of basePaths) {
    if (!fs.existsSync(basePath)) continue;

    const entries = fs.readdirSync(basePath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile()) continue;

      const filename = entry.name;
      const filePath = path.join(basePath, filename);

      // Check if filename matches supported patterns
      const isYml = filename.endsWith('.yml') || filename.endsWith('.yaml');
      const isProperties = filename.endsWith('.properties');
      const isApplication = filename.startsWith('application');
      const isBootstrap = filename.startsWith('bootstrap');

      if (!isYml && !isProperties) continue;
      if (!isApplication && !isBootstrap) continue;

      // Check profile
      const profile = extractProfile(filename);
      const priority = determinePriority(filename, profile);

      const content = loadFile(filePath);
      if (content) {
        results.push({ path: filePath, content, profile, priority });
      }
    }
  }

  return results;
}
