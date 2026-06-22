import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    external: ['node:sqlite'],
  },
  server: {
    deps: {
      external: ['node:sqlite'],
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./__tests__/setup.ts'],
    include: ['__tests__/**/*.test.ts', 'packages/*/__tests__/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    /**
     * Several MCP integration tests (mcp-daemon, mcp-initialize, mcp-ppid-watchdog,
     * mcp-roots) spawn `dist/bin/springgraph.js serve --mcp` with `process.execPath`
     * and rely on the child inheriting `process.env`. On a Node >= 25 dev machine
     * the CLI's hard-block (src/bin/springgraph.ts) would otherwise exit the child
     * before it ever responds, so every spawn-based test times out — see #478.
     *
     * Setting the override here keeps the CLI's runtime guard intact for end
     * users (it's still enforced when `springgraph` is invoked directly) while
     * letting the test suite run on whatever Node the contributor happens to
     * have installed. CI on Node 22/23 is unaffected — the guard doesn't fire
     * there, so the variable is a no-op.
     */
    env: {
      SPRINGGRAPH_ALLOW_UNSAFE_NODE: '1',
      /**
       * The suite spawns real CLI/MCP processes; without this they would write
       * telemetry state into the contributor's real ~/.springgraph and count test
       * tool calls as real usage. The telemetry unit tests are unaffected —
       * they inject their own `env` via the Telemetry constructor.
       */
      SPRINGGRAPH_TELEMETRY: '0',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
