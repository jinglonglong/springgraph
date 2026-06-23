# Spring Cloud Multi-Module & Service Recognition Implementation Plan

> **Goal:** Implement multi-level Maven module hierarchy parsing and Spring Boot service detection using a SQLite-backed `modules` table, mapping files to modules, and exposing the structured module tree and service boundary classification to the architecture engine and WebUI.
> **Status:** Pending Implementation. Steps use checkbox (`- [ ]`) syntax for tracking.

---

## Technical Stack & Constraints
- TypeScript (TSX), Node.js, Vitest, SQLite (`better-sqlite3` / `node-sqlite3-wasm`).
- **No breaking changes** to existing NodeKind/EdgeKind semantics or core traversal.
- Compositional detection: new facets must live alongside existing Spring / MyBatis / Lombok facets.
- Incremental updates: changes to `pom.xml` or main classes must invalidate the corresponding module/file cache and trigger re-detection.

---

## File Changes & Additions

- `src/db/migrations.ts` — Increment schema version to 8. Add v8 migration creating the `modules` table and adding `module_id` to `files`.
- `src/db/schema.sql` — Add `modules` table schema and `files.module_id` column to the base schema.
- `src/architecture/types.ts` — Update `NodeArchitectureFacet` and `ArchitectureSnapshot` types. Export `ModuleNode` / `Module` types.
- `src/architecture/pom-tree-parser.ts` — **NEW**. Utility to parse recursive pom.xml hierarchies, scan files, find `@SpringBootApplication` and `main` methods, and extract ports.
- `src/architecture/profiles/spring-cloud.ts` — Modify `mavenModuleFacet` to be a lightweight project detector, and implement `mavenModuleTreeFacet` to build/write the module tree and assign signals.
- `src/architecture/facet-engine.ts` — Wire the `modules` table data (JOIN) into node architecture facets so nodes get their full `module` path and `moduleType`.
- `src/architecture/facet-cache.ts` — Implement cache invalidation rules for `pom.xml` and main class changes.
- `src/web/graph-response.ts` — Serialize the module tree and service modules in `/api/overview` and new endpoints.
- `__tests__/module-recognition.test.ts` — **NEW**. Complete unit/integration test suite covering multi-level hierarchy, service detection, port extraction, and incremental sync.

---

## Task 1: Database Schema & Migration v8

- [ ] **Step 1: Write a failing test for schema version 8**
  Update `__tests__/init-migrations.test.ts` or similar database tests to expect version 8. Alternatively, write a temporary test checking that a new DB has the `modules` table.

- [ ] **Step 2: Add migration v8 to `src/db/migrations.ts`**
  Set `CURRENT_SCHEMA_VERSION = 8`. Add migration object:
  ```typescript
  {
    version: 8,
    description: 'Add modules table and files.module_id foreign key for multi-module hierarchy',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS modules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_root TEXT NOT NULL,
          path TEXT NOT NULL,
          name TEXT NOT NULL,
          parent_path TEXT,
          packaging TEXT NOT NULL,
          is_service INTEGER DEFAULT 0,
          main_class_node_id INTEGER,
          port INTEGER,
          pom_path TEXT NOT NULL,
          UNIQUE(project_root, path)
        );
        CREATE INDEX IF NOT EXISTS idx_modules_parent ON modules(project_root, parent_path);
        CREATE INDEX IF NOT EXISTS idx_modules_service ON modules(project_root, is_service);
        ALTER TABLE files ADD COLUMN module_id INTEGER REFERENCES modules(id);
        CREATE INDEX IF NOT EXISTS idx_files_module ON files(module_id);
      `);
    }
  }
  ```

- [ ] **Step 3: Update `src/db/schema.sql`**
  Add the `modules` table and the `module_id` column to `files` table in the initial schema script, with schema version set to 8.

- [ ] **Step 4: Verify migration execution**
  Run `npx vitest run __tests__/sqlite-backend.test.ts` to ensure migrations run without errors and schema initializes correctly.

- [ ] **Step 5: Commit changes**
  `git add src/db/migrations.ts src/db/schema.sql && git commit -m "feat(db): add v8 migration for modules table"`

---

## Task 2: Architecture Types & API Surface

- [ ] **Step 1: Update `src/architecture/types.ts`**
  Add new fields:
  ```typescript
  export interface NodeArchitectureFacet {
    // ...
    moduleType?: 'service' | 'library' | 'parent-pom';
  }

  export interface ModuleNode {
    id: number;
    path: string;
    name: string;
    parentPath: string | null;
    packaging: string;
    isService: boolean;
    mainClassNodeId?: string; // Node ID string
    port?: number;
    children?: ModuleNode[];
  }

  export interface ArchitectureSnapshot {
    // ...
    moduleTree?: ModuleNode[];
    serviceModules?: ModuleNode[];
  }
  ```

- [ ] **Step 2: Verify compilation**
  Run `npx tsc --noEmit` to verify type safety.

- [ ] **Step 3: Commit changes**
  `git add src/architecture/types.ts && git commit -m "feat(architecture): update architecture types for modules"`

---

## Task 3: Implement POM Tree Parser

- [ ] **Step 1: Create `src/architecture/pom-tree-parser.ts`**
  Write utilities to:
  - Find all `pom.xml` files recursively from the project root.
  - Parse `<artifactId>`, `<parent>`, `<modules>`, and `<packaging>` using a lightweight regex parser or parser library.
  - Form a tree structure in memory using the relative paths and `<parent>` references.
  - Identify candidate main classes: scan files with `.java` extension for `@SpringBootApplication` and `public static void main(String[] args)`.
  - Extract port: read `application.yml`/`application.properties` and search for `server.port` / `server:\n  port:`.
  - Distinguish:
    - Service modules: packaging is jar/war AND has a main class with `@SpringBootApplication` AND `spring-boot-maven-plugin` plugin (optional fallback if main class found).
    - Library modules: packaging is jar AND has no main class.
    - Parent pom: packaging is pom.

- [ ] **Step 2: Write unit tests in `__tests__/pom-tree-parser.test.ts`**
  Mock a multi-module workspace structure using mock files and run the tree parser to verify matching artifactIds, parents, classifications, and port extraction.

- [ ] **Step 3: Verify and run tests**
  Run `npx vitest run __tests__/pom-tree-parser.test.ts`.

- [ ] **Step 4: Commit changes**
  `git add src/architecture/pom-tree-parser.ts __tests__/pom-tree-parser.test.ts && git commit -m "feat(architecture): implement and test pom-tree-parser"`

---

## Task 4: Facet Implementation & SQLite Storage

- [ ] **Step 1: Modify `src/architecture/profiles/spring-cloud.ts`**
  - Update `mavenModuleFacet`: keep it project-level, emitting a simple signal containing `isMultiModule` and `pomCount`.
  - Add `mavenModuleTreeFacet` implementation:
    - Run the POM tree parser.
    - Insert/update the parsed modules into the `modules` table (upsert using `INSERT OR REPLACE` or custom transaction).
    - Determine file-to-module mapping by matching the relative directory of each file with the deepest matching module path prefix.
    - Update `files.module_id` in the database.
    - Emit node-level `ArchitectureSignal` objects for each file belonging to a module (including `module` path and `moduleType`).

- [ ] **Step 2: Modify `src/architecture/facet-engine.ts`**
  - Update the engine's compilation logic so that it joins the `modules` table when building the final `NodeArchitectureFacet` list.
  - Ensure the `module` string in `NodeArchitectureFacet` is populated with the full path of the module (e.g., `services/user-service`) and `moduleType` is populated with the module's type.

- [ ] **Step 3: Write tests in `__tests__/module-recognition.test.ts`**
  Create a complete workspace fixture with nested pom.xml files and verify:
  1. The `modules` table is populated correctly.
  2. Every indexed file has the correct `module_id` foreign key.
  3. `springgraph` queries return the full path in the `module` facet.

- [ ] **Step 4: Run tests and typecheck**
  Run `npx vitest run __tests__/module-recognition.test.ts` and `npx tsc --noEmit`.

- [ ] **Step 5: Commit changes**
  `git add src/architecture/profiles/spring-cloud.ts src/architecture/facet-engine.ts __tests__/module-recognition.test.ts && git commit -m "feat(architecture): integrate mavenModuleTreeFacet and write to modules table"`

---

## Task 5: Incremental Synchronization & Cache Invalidation

- [ ] **Step 1: Modify `src/architecture/facet-cache.ts`**
  - Implement invalidation on file changes:
    - If a `pom.xml` changes, invalidate the entire cached module tree, trigger a full re-detect of project-level signals, and clear cached facets for files in that module.
    - If a Java file containing `@SpringBootApplication` is modified or deleted, re-run the service check for that module, update `modules.is_service` and `modules.main_class_node_id`, and invalidate cached node facets.

- [ ] **Step 2: Add incremental tests to `__tests__/module-recognition.test.ts`**
  - Add cases where `sync` is called after changing a `pom.xml` artifactId, adding a sub-module, or removing a `@SpringBootApplication` class. Verify database consistency.

- [ ] **Step 3: Run the full test suite**
  Run `npx vitest run`.

- [ ] **Step 4: Commit changes**
  `git add src/architecture/facet-cache.ts && git commit -m "feat(architecture): add cache invalidation for pom and main class changes"`

---

## Task 6: API Serialization & WebUI Integration

- [ ] **Step 1: Update Web endpoints in `src/web/graph-response.ts` / `src/web/architecture-api.ts`**
  - Fetch the module tree from the `modules` table using a recursive CTE or recursive function in JS, structure it as hierarchical `ModuleNode[]` elements, and include `moduleTree` and `serviceModules` in the API overview response payload.
  - Keep existing client compatibility.

- [ ] **Step 2: Update tests in `__tests__/web-architecture-api.test.ts`**
  Verify that the API `/api/overview` contains the newly added `moduleTree` and `serviceModules` fields.

- [ ] **Step 3: Run full verification**
  Run `npm run build && npm test`.

- [ ] **Step 4: Commit changes**
  `git add src/web/graph-response.ts src/web/architecture-api.ts __tests__/web-architecture-api.test.ts && git commit -m "feat(web): serialize moduleTree and serviceModules in API responses"`

---

## Verification & Parity Checks
- Run the entire test suite: `npm test`
- Run the build: `npm run build`
- Ensure no type errors or linter warnings in modified files.
