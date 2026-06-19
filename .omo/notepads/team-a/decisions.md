# Team A Decisions

## 2026-06-19
- Use `D:\code\cg-team-a` worktree for all code edits; keep `.omo` state in worktree.
- Use npm workspaces (`packages/*`) and `workspace:*` protocol for intra-monorepo deps.
- `springkg-shared` has zero runtime deps on `@colbymchenry/codegraph`.
- `springkg-core` declares `@colbymchenry/codegraph` as peer dependency.
- Deep-import `createDatabase` from `@colbymchenry/codegraph/dist/db/sqlite-adapter.js` for `SpringDatabase`.
