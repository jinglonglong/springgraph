#!/usr/bin/env node
/**
 * Quick-start the Springgraph Web UI for a project.
 * Usage: node start-webui.js <project-path> [port]
 */
import { Springgraph } from './src/index.ts';
import { startWebServer } from './src/web/server.ts';
import * as path from 'path';

const projectPath = process.argv[2] || '.';
const port = parseInt(process.argv[3] || '4000', 10);
const publicDir = path.resolve('./dist/web/public');

async function main() {
  console.log(`[start-webui] Opening Springgraph for: ${path.resolve(projectPath)}`);
  const cg = await Springgraph.open(path.resolve(projectPath));
  const { url, close } = await startWebServer(cg, { port, publicDir, open: true });
  console.log(`[start-webui] Web UI ready at: ${url}`);

  process.on('SIGINT', async () => {
    console.log('\n[start-webui] Shutting down...');
    await close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[start-webui] Fatal:', err);
  process.exit(1);
});
