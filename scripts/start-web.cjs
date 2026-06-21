// Quick web-server launcher for the V2 playground smoke test.
const path = require('path');
const CodeGraph = require('../dist').default;
const { startWebServer } = require('../dist/web/server');

async function main() {
  const projectPath = process.argv[2];
  if (!projectPath) {
    console.error('Usage: node scripts/start-web.cjs <project-root-or-.codegraph-dir> [port]');
    process.exit(2);
  }
  const port = parseInt(process.argv[3] || '7333', 10);
  const publicDir = path.resolve(__dirname, '..', 'dist', 'web', 'public');
  const cg = await CodeGraph.open(projectPath);
  const handle = await startWebServer(cg, { port, publicDir });
  console.log('listening at', handle.url);
  // Run until killed.
}

main().catch((err) => {
  console.error('start-web failed:', err);
  process.exit(1);
});
