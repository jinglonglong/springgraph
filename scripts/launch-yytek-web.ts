// Launch the Springgraph web server for the yytek-iot-cloud project
import { Springgraph } from '../src/index.js';
import { startWebServer } from '../src/web/server.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const projectPath = 'D:/code/yytek-iot-cloud';
const port = Number(process.env.SPRINGGRAPH_WEB_PORT || 7333);
const publicDir = path.resolve(__dirname, '..', 'dist', 'web', 'public');

async function main() {
  console.log('[launch-web] Opening Springgraph index for:', projectPath);
  const cg = await Springgraph.open(projectPath);

  console.log('[launch-web] Starting web server on port', port);
  const { url, close } = await startWebServer(cg, {
    port,
    publicDir,
    host: '127.0.0.1',
    open: false,
  });

  console.log('[launch-web] Web UI ready at:', url);
  console.log('[launch-web] Press Ctrl+C to stop');

  // Keep alive
  process.on('SIGINT', async () => {
    console.log('\n[launch-web] Shutting down...');
    await close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[launch-web] Fatal:', err);
  process.exit(1);
});
