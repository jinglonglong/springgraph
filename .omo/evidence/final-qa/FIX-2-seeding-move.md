# FIX-2: Cross-Team Seeding Logic Relocation (2026-06-20)

### Action Taken
Relocated Team G's self-seeding logic out of Team E's owned file (`packages/springkg-mcp/src/server.ts`) and into a Team A-owned package (`packages/springkg-core/src/seed/springkg-seeder.ts`).

1. **Created `packages/springkg-core/src/seed/springkg-seeder.ts`**:
   - Contains `SpringkgSeeder` class with `seed`, `loadCodeGraphContext`, `seedSymbols`, `seedEdges`, `seedEndpoints`, `seedFeignClients`, `seedSqlStatements`, `seedConfigProperties`, `seedCommunities` methods.
   - Moves the model interface types verbatim (`CodeGraphContext`, `SeedSymbol`, `SeedEdge`, `SeedEndpoint`, `SeedFeignClient`, `SeedSqlStatement`, `SeedConfigProperty`, `SeedCommunity`, `SeedCommunityMember`, `ParsedMethod`, `ParsedType`, `SeedBundle`, `SeedResult`).
   - Keeps `tableExists()` check for SQLite schema compatibility.
   - Leverages `node:sqlite` dynamically at runtime.

2. **Updated `packages/springkg-core/src/index.ts`**:
   - Added export: `export { SpringkgSeeder } from './seed/springkg-seeder.js';`
   - Added re-exports for the interface types.

3. **Cleaned up `packages/springkg-mcp/src/server.ts`**:
   - Removed self-seeding code and interfaces (~1000 lines removed).
   - Removed unused `createHash` from `crypto` import.
   - Imported `SpringkgSeeder` from `@colbymchenry/springkg-core`.
   - Called `await new SpringkgSeeder().seed(this.db, this.codegraph);` in `seedDatabase()`.
   - Initialized `this.codegraph` dynamically in `seedDatabase()` to pass it to the seeder.

### Verification
- `packages/springkg-mcp` package built successfully via `npm run build` inside `packages/springkg-mcp`.
- Entire workspace built successfully via `npm run build`.
- Workspace typecheck `npx tsc --noEmit` passed with exit code 0.
- `grep -c "INSERT INTO spring_" packages/springkg-mcp/src/server.ts` returned 0.
- `grep -c "INSERT INTO spring_" packages/springkg-core/src/seed/springkg-seeder.ts` returned 5.
- Run `npm run test:springkg` -> All 3 test files (9 tests) passed successfully.
