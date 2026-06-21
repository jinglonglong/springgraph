# FIX-1 Evidence: src/ Revert

**Date**: 2026-06-20
**Task**: Revert 4 forbidden `src/` file modifications per springkg design rule (`.omo/plans/springcloud.md` line 108)

---

## Files Reverted

| File | Reverted Lines | Feature Removed |
|------|---------------|-----------------|
| `src/db/queries.ts` | +21 lines | `decorators` filter in `searchNodes()` + `getEdgesForNodes()` method |
| `src/extraction/tree-sitter.ts` | +6 lines | Decorator persistence to `node.decorators` array |
| `src/index.ts` | +28 lines | `getDecorators()` + `getEdgesForNodes()` methods on CodeGraph class |
| `src/types.ts` | +3 lines | `decorators?: string[]` field on `SearchOptions` interface |

---

## Diff Evidence (Before Revert)

```
src/db/queries.ts             | 21 +++++++++++++++++++++
src/extraction/tree-sitter.ts |  6 ++++++
src/index.ts                  | 28 ++++++++++++++++++++++++++++
src/types.ts                  |  3 +++
4 files changed, 58 insertions(+)
```

### src/db/queries.ts (before revert)
```diff
+    // Filter by decorators
+    if (options.decorators && options.decorators.length > 0) {
+      const wanted = new Set(options.decorators);
+      results = results.filter((r) => {
+        const nodeDecs = r.node.decorators ?? [];
+        return nodeDecs.some((d) => wanted.has(d));
+      });
+    }
+
+  /**
+   * Get all edges where source OR target is in the given set of node IDs.
+   * Used by the web server's candidate-scoring pass.
+   */
+  getEdgesForNodes(nodeIds: string[]): Edge[] {
```

### src/types.ts (before revert)
```diff
+  /** Filter to nodes carrying at least one of these decorator/annotation names */
+  decorators?: string[];
```

### src/extraction/tree-sitter.ts (before revert)
```diff
+      // Also persist the decorator name on the node itself so it survives into
+      // the nodes table (this.nodes is still in-memory at this point).
+      const nodeObj = this.nodes.find(n => n.id === decoratedId);
+      if (nodeObj) {
+        nodeObj.decorators = [...(nodeDecs ?? []), name];
+      }
```

### src/index.ts (before revert)
```diff
+  /**
+   * Aggregate decorator/annotation names across all nodes that carry them.
+   * Tally is sorted by occurrence count descending.
+   */
+  getDecorators(limit: number): Array<{ name: string; count: number }> {
+
+  /**
+   * Get all edges where source OR target is in the given node ID set.
+   */
+  getEdgesForNodes(nodeIds: string[]): Edge[] {
```

---

## Verification: git diff --stat src/ (After Revert)

```
(no output - ZERO modifications)
```

**Status**: ✅ Confirmed clean - no src/ modifications remain.

---

## Build Status

```
npx tsc --noEmit
```

**Result**: ❌ FAILS - TypeScript compilation errors in `src/web/server.ts`:

```
src/web/server.ts(374,11): error TS2353: Object literal may only specify known properties, 
                           and 'decorators' does not exist in type 'SearchOptions'.

src/web/server.ts(518,31): error TS2339: Property 'getDecorators' does not exist 
                           on type 'CodeGraph'.

src/web/server.ts(624,23): error TS2339: Property 'getEdgesForNodes' does not exist 
                           on type 'CodeGraph'.
```

**Root Cause**: The springcloud branch HEAD (`d4ea76c`) contains `src/web/server.ts` that references `getDecorators()` and `getEdgesForNodes()` APIs, but these methods were NEVER committed - they only existed in the working tree modifications that have now been reverted. The branch was in an inconsistent state.

---

## Test Status

### springkg tests (team-a)
```
npm run test:springkg
```
**Result**: ✅ ALL PASSED
```
Test Files  3 passed (3)
Tests       8 passed | 1 skipped (9)
```

### Full test suite
```
npm test
```
**Result**: ❌ 6 test files failed, 20 tests failed, 1717 passed

#### Failed tests related to reverted features:

| Test File | Test Name | Error |
|-----------|-----------|-------|
| `web-server.test.ts` | `GET /api/overview returns a startup graph with real indexed nodes` | 500 instead of 200 |
| `web-server.test.ts` | `GET /api/decorators returns the aggregated decorator list` | 500 instead of 200 |
| `web-server.test.ts` | `GET /api/search?decorator=Service narrows to nodes...` | 2 results instead of 0 |

#### Non-related failures (Windows file locking):
- Multiple `EBUSY: resource busy or locked` errors in `resolution.test.ts` (Windows-specific SQLite locking issue)

---

## Findings

1. **The springcloud branch HEAD was already inconsistent**: `src/web/server.ts` called `getDecorators()` and `getEdgesForNodes()` but these methods were never committed - they only existed in uncommitted working tree modifications.

2. **Reverting exposed pre-existing brokenness**: By removing the working tree modifications, the build now fails because the API that server.ts depends on was never actually in the codebase.

3. **The unauthorized decorator feature was only in working tree**: None of the 4 reverted files were ever committed with the decorator changes - they were always uncommitted modifications.

4. **Springkg tests unaffected**: The `packages/springkg-*` tests continue to pass because they don't depend on the web server or the decorator APIs.

---

## Impact Assessment

- **src/ modifications**: ✅ Successfully reverted to baseline
- **Build (tsc)**: ❌ Broken due to server.ts referencing non-existent APIs
- **springkg tests**: ✅ Pass (8/9)
- **Full test suite**: ❌ 20 tests fail (6 due to server.ts inconsistency, 14 due to Windows EBUSY)

---

## Next Steps (Not in scope for FIX-1)

FIX-2 will address the `src/web/server.ts` issue by removing the decorator endpoints that depend on the reverted APIs.
