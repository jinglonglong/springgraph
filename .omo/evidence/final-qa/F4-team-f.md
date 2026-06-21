# F4 Team F — Community Audit

**Team**: F (Community / Impact Analysis)
**Owned**: `packages/springkg-community/src/**`
**Tasks**: 3 | **Done**: 0/3 | **Status**: ❌ FAIL

## Task Completion

| # | Task | Status | File Evidence |
|---|------|--------|---------------|
| T47 | CommunityBuilder | ❌ | Only 2-line stub in `index.ts` |
| T48 | SummaryGenerator | ❌ | Implemented in Team A's territory (`springkg-core/src/community/`) |
| T49 | DirtyQueue | ❌ | Not implemented |

## Package State

```
packages/springkg-community/src/index.ts
```

**Contents** (2 lines):
```typescript
export default function springCommunity(): string {
  return 'springkg-community';
}
```

## Analysis

- **T47 (CommunityBuilder)**: Should be in `springkg-community/src/community-builder.ts` — file does not exist
- **T48 (SummaryGenerator)**: Implementation exists in `springkg-core/src/community/summary-generator.ts` — this is Team A's territory (T8 stub), NOT Team F's package
- **T49 (DirtyQueue)**: Should be in `springkg-community/src/dirty-queue.ts` — file does not exist

## Violations

None (Team F didn't write enough code to violate anything).

## Recommendation

Either:
1. Complete T47/T48/T49 in `springkg-community/src/` as planned
2. OR formally delegate T48 to Team A and remove Team F from the plan
