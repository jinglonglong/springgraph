# T68 — Reuse/Add/Handoff Policy Contract

## Tables and Decorator Sets

| Table name       | Decorators                                              |
|------------------|---------------------------------------------------------|
| `REUSE_DECORATORS` | `@RestController`, `@Controller`, `@Service`, `@Repository`, `@Component`, `@GetMapping`, `@PostMapping`, `@PutMapping`, `@DeleteMapping`, `@PatchMapping`, `@RequestMapping`, `@PathVariable`, `@RequestParam`, `@RequestHeader` |
| `ADD_DECORATORS`    | `@FeignClient`, `@Mapper`, `@Configuration`, `@Bean`       |
| `HANDOFF_DECORATORS` | `@ConfigurationProperties` → `team-d-runtime`             |

## Conflict Rule

**ADD wins over REUSE** when both appear on the same class/interface.

```
@Component + @Mapper  → shouldAdd = true, shouldReuse = false
```

This prevents Team B from emitting a `reuse=true` component row when Team C's mapper semantics are in play.

## Dedup Contract

`ReusePolicy.dedup(kind, codegraphNodeId, db)` — returns `true` (emit) when the
symbol is **not** already in the DB:

```
dedup -> !db.hasSymbol(kind, codegraphNodeId)
```

The `db` parameter satisfies the `ReusePolicyDb` interface:

```typescript
interface ReusePolicyDb {
  hasSymbol(kind: SpringKgNodeKind, codegraphNodeId: string): boolean;
}
```

This mirrors the future Team A `spring_symbols` query surface (`WHERE kind=? AND codegraph_node_id=?`).
Team B uses a local fake-DB in tests (`Set<string>` keyed as `"${kind}:${codegraphNodeId}"`)
so T68 stays pure and testable without a real DB dependency.

## Case-Insensitive Substring Matching

All decorator comparisons are case-insensitive substring checks against the full
decorator string (e.g. `@FeignClient(name="user-svc")` matches `@feignclient`).

```
shouldAdd(['@feignclient(name="user-svc")'])  -> true
shouldReuse(['@requestmapping(path="/users")']) -> true
```

## Handoff Routing

`handoffTeam(decorators)` returns the team label for known handoff decorators:

| Decorator               | Team returned      |
|-------------------------|--------------------|
| `@ConfigurationProperties` | `team-d-runtime`   |
| (everything else)        | `null` (no symbol) |

## Verified Test Outcomes (local fake-db, no live DB)

All policy tests pass under `packages/springkg-semantic/__tests__/policy.test.ts`:

- Every `REUSE_DECORATORS` entry → `shouldReuse=true`, `shouldAdd=false`
- Every `ADD_DECORATORS` entry → `shouldAdd=true`, `shouldReuse=false`
- Conflict case (`@Component + @Mapper`) → `shouldAdd=true` (ADD wins)
- `@ConfigurationProperties` → `handoffTeam(...) = 'team-d-runtime'`
- Unknown decorators → all three functions return falsy/null
- `ReusePolicy.dedup` idempotency: first call with a new `(kind, id)` → `true`;
  second call with same args (after `seen.add(...)`) → `false`

## Integration Status

Team A persistence / `spring_symbols` DB integration has **not landed yet**.
The local fake-db approach (a `Set<string>` keyed by `"${kind}:${codegraphNodeId}"`)
proves the idempotent decision logic in package-local tests.
Once Team A surfaces the real `hasSymbol(kind, codegraphNodeId)` query,
replace the fake-DB injection in tests and `ReusePolicy.dedup()` will work against the live DB
with no other changes.
