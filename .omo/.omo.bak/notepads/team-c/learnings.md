
- T27 `SqlTableColumnExtractor` is a pure parser in `packages/springkg-data/src/sql-table-column.ts`; it normalizes whitespace, detects tables via `FROM`/`JOIN`/`INSERT INTO`/`UPDATE`/`DELETE FROM`/`TRUNCATE TABLE`, strips schema prefixes, and tracks aliases from `users u` and `users AS u`.
- Column extraction currently covers SELECT lists, INSERT column lists, UPDATE `SET` assignments, UPDATE `WHERE` identifiers, and JOIN `ON` identifiers so the required alias case emits `id`, `name`, and `user_id`.
- Root `vitest.config.ts` only included top-level `__tests__` initially; adding `packages/*/__tests__/**/*.test.ts` was required so `npx vitest run packages/springkg-data/__tests__/sql-table-column.test.ts` discovers package-local tests as specified by the task.
