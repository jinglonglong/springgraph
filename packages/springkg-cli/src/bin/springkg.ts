#!/usr/bin/env node
/**
 * SpringKg CLI — bin shim.
 *
 * Thin entry that delegates to src/index.ts (the main module).
 * Keeps the package.json `bin` path stable while all command logic
 * lives in src/index.ts and src/commands/*.ts.
 */
import { main } from '../index.js';
main();
