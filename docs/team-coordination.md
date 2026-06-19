# Team Coordination

> This file is maintained by Team G. Teams A–F append status updates to their own sections.

---

## Team C — Data Access / MyBatis / SQL

**Status**: ✅ Sprint 2 implementation complete

### Tasks completed (T25–T31)

| Task | Status | Notes |
|---|---|---|
| T25 MyBatisXmlExtractor | ✅ Done | XML enhancement with include expansion, resultMap, dynamic SQL, cycle detection |
| T26 AnnotationSqlExtractor | ✅ Done | @Select/@Insert/@Update/@Delete/@SelectProvider annotation parsing |
| T27 SqlTableColumnExtractor | ✅ Done | SQL table/column extraction with dynamic tag confidence scoring |
| T28 SqlWriter | ✅ Done | Write to springkg.db with idempotent INSERT OR REPLACE |
| T29 MapperBindingResolver | ✅ Done | Binds Java Mapper interfaces to XML statements via BIND_TO edges |
| T30 MyBatisPlusResolver | ✅ Done | @TableName, @TableId, @TableField entity resolution with snake_case convention |
| T31 JPAEntityResolver | ✅ Done | @Entity, @Table JPA entity to table mapping |
| Index export | ✅ Done | All modules exported from `packages/springkg-data/src/index.ts` |

### Tests

- 27 tests, all passing (`npx vitest run packages/springkg-data`)
- 7 test files covering all 7 modules

### Schema amendment requests

None — Team A's schema already covered the required columns (`mapper_namespace`, `statement_id`, `operation`, `sql_preview`, `xml_path`).

### Open questions for Team E

1. Should `spring_find_mapper` filter on `kind='mapper'` or `kind='class'` with `@Mapper` decorator?
2. How should annotation-only Mapper methods (without XML binding) appear in `spring_find_mapper` output?
3. Is the `sql_statement.codegraphNodeId` field used by Team E's MCP tools, or can it be a placeholder?

### Merge order

Team C ships in one PR (T25–T31 together) since all modules are independent and Team E can start T33/T34 once this lands.
