# Decisions

> Record important architectural and technical decisions made during the project.

## 2026-06-19

- (initial entry)

## ESM Import Extension Convention

- Decision: Use explicit `.js` extensions for all relative ESM imports in TypeScript files (`from './migrations.js'` instead of `from './migrations'`). This prevents directory import resolution failures on Windows where Node.js ESM resolver behaves differently from POSIX. The `.js` extension maps to the compiled `.js` output in the same directory after TypeScript compilation.
- Decision: Use `import` statements for all Node.js built-in modules instead of `require()` when the file is an ES module. `require()` is not available in ESM context and will throw a `ReferenceError` at runtime. The `as typeof import(...)` type assertion was also unnecessary once a proper import is used.
- Decision: Stub missing `CodeGraph` methods (`getDecorators`, `getEdgesForNodes`) with empty array returns rather than implementing the full feature, since these are part of Team G's validation task but the underlying implementations on `CodeGraph` don't exist yet. This unblocks compilation while preserving the web UI API surface for future work.
