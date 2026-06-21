# Cross-team integration check

Status: FAIL

Integration score used for final verdict: 4/5 domain-presence checks passed, but end-to-end flow failed.

Checks:
1. Controller domain present — PASS (`spring_symbols` contains `UserController` and `OrderController`).
2. Service domain present — PASS (`spring_symbols` contains `UserService` and `OrderService` methods/classes).
3. Mapper domain present — PASS (`spring_symbols` contains `UserMapper` and `OrderMapper`).
4. Config / community domains present — PASS (`runtime_config_properties` has 14 rows; `feature_communities` has 4 rows).
5. SQL domain present and linked into flow — FAIL (`spring_sql_statements` has 0 rows; mapper tools return no methods/SQL).

Supporting evidence:
- `criteria-session-stdout.json` entry `integration-entry-orders` resolves endpoint → controller → service.
- `criteria-session-stdout.json` entries `integration-mapper-order` and `integration-mapper-user` return empty method sets.
- `post-session-db-counts.json` shows `spring_sql_statements: 0`, `spring_feign_clients: 0`, `spring_endpoints: 1`.
- `mcp-session-stderr.txt` shows runtime seeding summary: `symbols=17, endpoints=1, feign=0, sql=0, config=14`.

Conclusion: multiple team domains are present in the DB, but the planned cross-team controller → service → mapper → SQL flow does not complete.
