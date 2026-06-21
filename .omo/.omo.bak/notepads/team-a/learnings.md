# Team A Learnings

## Task 4: SpringKg Orchestrator Implementation

### Key Insights

1. **CodeGraph API surface**:
   - `CodeGraph.init(path)` / `CodeGraph.open(path)` are the factory methods
   - `cg.sync()` returns `SyncResult` with `filesAdded/modified/removed` as **counts** (numbers), not arrays
   - `cg.getChangedFiles()` returns `{ added: string[], modified: string[], removed: string[] }` - the actual paths
   - `cg.getPendingFiles()` returns `PendingFile[]` with project-relative paths that must be resolved to absolute

2. **Duck-typing `cg` as `{ [k: string]: unknown }`**:
   - Store internally as `private readonly _cg: CodeGraph`
   - Expose publicly as `readonly cg: { [k: string]: unknown }` using `as unknown as` cast in constructor
   - Avoids TypeScript duplicate identifier conflicts

3. **Watch bridging**:
   - `FileWatcher` callback `onSyncComplete` receives `{ filesChanged, durationMs }` but NOT the actual file paths
   - To get actual paths, call `cg.getPendingFiles()` inside the callback and resolve to absolute paths
   - `PendingFile.path` is project-relative (POSIX style), use `path.resolve(projectPath, f.path)` for absolute

4. **ReadonlyArray issue**:
   - `SpringKgEnhanceInput` defines arrays as `ReadonlyArray<T>` which lacks `push()`
   - Build mutable arrays locally (`Array<T>`) then pass to input object - TypeScript accepts structurally compatible mutable arrays for readonly parameters

5. **`as any` usage**:
   - Used for duck-typed access to `getNodesInFile`, `getEdgesForNodes`, `getPendingFiles` from the cg facade
   - Task prohibited `as any` in return types but allows internal implementation uses for bridging the duck-typed interface

### Verification

- `npx tsc -b packages/springkg-shared packages/springkg-core` exits 0
