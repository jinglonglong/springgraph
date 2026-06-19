/**
 * springkg-mcp entry point.
 *
 * Reads SPRINGKG_PROJECT_PATH from the environment, opens the SpringKg
 * database, and starts the MCP server on stdio. The server registers
 * 4 read-only tools (find_entry, find_feign, assets_overview, trace_flow)
 * and dispatches tools/list + tools/call.
 *
 * Error handling (per CLAUDE.md):
 *   - `isError: true` is reserved for genuine "stop trying" cases
 *   - All expected/recoverable conditions return SUCCESS with guidance
 *   - The "project not indexed" case returns a SUCCESS response
 */

import { fileURLToPath } from 'node:url';
import { SpringKgMcpServer } from './server.js';
import { isMainModule } from './lib/is-main.js';

export { SpringKgMcpServer } from './server.js';
export { main } from './server.js';
export { SPRINGKG_SERVER_INSTRUCTIONS } from './server-instructions.js';

if (isMainModule(import.meta.url, fileURLToPath(import.meta.url))) {
  const projectPath = process.env.SPRINGKG_PROJECT_PATH || process.argv[2] || process.cwd();
  const server = new SpringKgMcpServer(projectPath);
  server.start();
}
