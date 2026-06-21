# FIX-1b Evidence: src/web/server.ts Revert

## Task
Revert `src/web/server.ts` to the committed baseline and verify no src/ modifications remain.

## Actions Taken

### 1. Examined git history
```bash
git log --oneline -5 -- src/web/server.ts
# Output: 4d0aa22 Merge team-a-foundation: monorepo scaffold, SpringDatabase, SpringKg, installer, CLI, tests
```
- `src/web/server.ts` was first committed in `4d0aa22` (team-a-foundation merge)
- Only ONE commit touched this file in its history

### 2. Reverted to committed baseline
```bash
git checkout HEAD -- src/web/server.ts
```

### 3. Verified src/ is clean
```bash
git diff --stat src/
# Output: (no output - zero modifications)
```

### 4. Verified server.ts matches HEAD
```bash
git diff src/web/server.ts
# Output: (no output - matches HEAD exactly)
```

## Status

| Requirement | Status | Notes |
|------------|--------|-------|
| `src/web/server.ts` reverted to committed baseline | ✅ DONE | Working tree matches HEAD |
| `git diff --stat src/` shows ZERO modifications | ✅ DONE | No output |
| `npx tsc --noEmit` exits 0 | ❌ FAILS | Pre-existing type errors |
| `npm run build` exits 0 | ❌ FAILS | Pre-existing type errors |

## Critical Finding: Pre-existing Type Errors

The committed baseline (`HEAD` = `4d0aa22`) contains **pre-existing type errors** in `src/web/server.ts`:

```
src/web/server.ts(374,11): error TS2353: Object literal may only specify known properties, and 'decorators' does not exist in type 'SearchOptions'.
src/web/server.ts(518,31): error TS2339: Property 'getDecorators' does not exist on type 'CodeGraph'.
src/web/server.ts(624,23): error TS2339: Property 'getEdgesForNodes' does not exist on type 'CodeGraph'.
```

These errors exist because the team-a-foundation commit (`4d0aa22`) added `src/web/server.ts` with code that calls methods that **do not exist** on the CodeGraph class:

| Method Called | Does It Exist on CodeGraph? |
|--------------|----------------------------|
| `SearchOptions.decorators` | NO - interface doesn't have this property |
| `CodeGraph.getDecorators()` | NO - method doesn't exist |
| `CodeGraph.getEdgesForNodes()` | NO - method doesn't exist |

## Analysis

1. **The "modifications" mentioned in the task** were the working tree changes that existed BEFORE this task began - they were replacing calls to non-existent methods (`cg.getDecorators()`, `cg.getEdgesForNodes()`) with working manual implementations (manual counting and `traverse()`).

2. **Reverting to "committed baseline"** (HEAD) restored the broken code that calls non-existent methods.

3. **The type errors are NOT new** - they were introduced in commit `4d0aa22` (team-a-foundation) and were never fixed.

## Root Cause

team-a-foundation committed `src/web/server.ts` with code that referenced methods/fields that were never implemented on the CodeGraph class:
- `decorators` property on `SearchOptions`
- `getDecorators()` method
- `getEdgesForNodes()` method

## Next Steps Required

The committed baseline (team-a-foundation) is fundamentally broken. To fix:

1. **Option A**: Add the missing methods to CodeGraph class in `src/index.ts`:
   - Add `decorators?: string[]` to `SearchOptions` interface in `src/types.ts`
   - Add `getDecorators(limit?: number): Array<{name: string, count: number}>` to CodeGraph
   - Add `getEdgesForNodes(nodeIds: string[]): Edge[]` to CodeGraph

2. **Option B**: Remove the broken routes from `src/web/server.ts` entirely

Neither option can be done without modifying `src/**`, which is forbidden per the springkg plan rule (`.omo/plans/springcloud.md` line 108).

## Recommendation

This issue needs to be escalated. The team-a-foundation commit introduced fundamentally broken code that cannot compile. Either:
1. The plan rule about not modifying `src/**` needs an exception for this fix
2. Or the springkg work needs to acknowledge that `src/web/server.ts` was never properly integrated

---

*Evidence captured: 2026-06-20*
*Task: FIX-1b*
*Reverted by: Claude Code (Sisyphus-Junior)*
