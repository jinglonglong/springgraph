# T68 — Add vs Reuse Policy (policy.ts)

**Source:** `packages/springkg-semantic/__tests__/policy.test.ts` — **23 tests passed**

## REUSE_DECORATORS
CodeGraph already extracts these stereotypes; Team B emits rows that point at the
existing CodeGraph node and leaves content fields null.

| Decorator | spring_symbols.kind |
|---|---|
| `@RestController` | `controller` |
| `@Controller` | `controller` |
| `@Service` | `service` |
| `@Repository` | `repository` |
| `@Component` | `component` |
| `@GetMapping` | (parameter / mapping) |
| `@PostMapping` | (parameter / mapping) |
| `@PutMapping` | (parameter / mapping) |
| `@DeleteMapping` | (parameter / mapping) |
| `@PatchMapping` | (parameter / mapping) |
| `@RequestMapping` | (mapping) |
| `@PathVariable` | (parameter) |
| `@RequestParam` | (parameter) |
| `@RequestHeader` | (parameter) |

## ADD_DECORATORS
CodeGraph does not surface these; Team B writes a full row.

| Decorator | spring_symbols.kind |
|---|---|
| `@FeignClient` | `feign_client` |
| `@Mapper` | `mapper` (Team C hand-off marker) |
| `@Configuration` | `configuration` |
| `@Bean` | `bean` (inside `@Configuration`) |

## HANDOFF_DECORATORS
Recognized but not emitted — owned by another team.

| Decorator | Owner |
|---|---|
| `@ConfigurationProperties` | Team D (`config_property`) |

## Conflict Rule (ADD wins over REUSE)
A class with both decorators routes to ADD:

```
@Component + @Mapper  -> shouldAdd=true, shouldReuse=false
```

## Matching Semantics
Case-insensitive substring matching against full decorator strings:

```
shouldAdd(['@feignclient(name="user-svc")'])         -> true
shouldReuse(['@requestmapping(path="/users")'])      -> true
handoffTeam(['@ConfigurationProperties(prefix="app")']) -> 'team-d-runtime'
```

## Dedup Contract
`ReusePolicy.dedup(kind, codegraphNodeId, db)` returns `true` (emit) iff the
`(kind, codegraphNodeId)` pair does not yet exist. The DB parameter satisfies
the `ReusePolicyDb` interface:

```typescript
interface ReusePolicyDb {
  hasSymbol(kind: SpringKgNodeKind, codegraphNodeId: string): boolean;
}
```

Tests use a local `Set<string>` keyed by `"${kind}:${codegraphNodeId}"` to
prove the idempotent decision logic without a real DB.

## Integration Status
- Team A `spring_symbols` / DB integration has **not landed yet**.
- Once Team A surfaces the real `hasSymbol(kind, codegraphNodeId)` query,
  `ReusePolicy.dedup()` will work against the live DB without other changes.