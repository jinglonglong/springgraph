// Launch the Springgraph web server for the yytek-iot-cloud project
// Uses the compiled dist/ to avoid WASM resolution issues
const { Springgraph } = require('../dist/index.js');
const { startWebServer } = require('../dist/web/server.js');
const path = require('path');

async function main() {
  const projectPath = 'D:/code/yytek-iot-cloud';
  const port = Number(process.env.SPRINGGRAPH_WEB_PORT || 7333);
  const publicDir = path.resolve(__dirname, '..', 'dist', 'web', 'public');

  console.log('[launch-web] Opening Springgraph index for:', projectPath);
  const cg = await Springgraph.open(projectPath);

  console.log('[launch-web] Starting web server on port', port);
  const { url, close } = await startWebServer(cg, {
    port,
    publicDir,
    host: '127.0.0.1',
    open: false,
  });

  console.log('[launch-web] ============================================');
  console.log('[launch-web]  Web UI ready at:', url);
  console.log('[launch-web]  Press Ctrl+C to stop');
  console.log('[launch-web] ============================================');

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
