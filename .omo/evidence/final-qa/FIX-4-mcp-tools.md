# FIX-4 — Missing MCP Tools Remediated (2026-06-20)

## Scope

Implemented and registered the 6 missing SpringKG MCP tools in `packages/springkg-mcp/src/`:

1. `spring_method_impact`
2. `spring_field_impact`
3. `spring_module_summary`
4. `spring_find_change_surface`
5. `spring_runtime_dependency`
6. `spring_env_diff`

Also added one Team E test per tool under `packages/springkg-mcp/__tests__/team-e/`.

## Files changed

- `packages/springkg-mcp/src/server.ts`
- `packages/springkg-mcp/src/server-instructions.ts`
- `packages/springkg-mcp/src/tools/method-impact.ts`
- `packages/springkg-mcp/src/tools/field-impact.ts`
- `packages/springkg-mcp/src/tools/module-summary.ts`
- `packages/springkg-mcp/src/tools/find-change-surface.ts`
- `packages/springkg-mcp/src/tools/runtime-dependency.ts`
- `packages/springkg-mcp/src/tools/env-diff.ts`
- `packages/springkg-mcp/__tests__/team-e/method-impact.test.ts`
- `packages/springkg-mcp/__tests__/team-e/field-impact.test.ts`
- `packages/springkg-mcp/__tests__/team-e/module-summary.test.ts`
- `packages/springkg-mcp/__tests__/team-e/find-change-surface.test.ts`
- `packages/springkg-mcp/__tests__/team-e/runtime-dependency.test.ts`
- `packages/springkg-mcp/__tests__/team-e/env-diff.test.ts`
- `src/web/server.ts` (repo-wide build compatibility fix for removed CodeGraph APIs)

## Verification

### 1) Package build

Command:

```bash
cd packages/springkg-mcp
npm run build
```

Result: **PASS**

### 2) SpringKG MCP tests

Command:

```bash
npx vitest run packages/springkg-mcp
```

Result: **PASS**

- Test files: 7 passed
- Tests: 25 passed, 0 failed

### 3) Repo-wide build

Command:

```bash
npm run build
```

Result: **PASS**

Note: this required a small compatibility fix in `src/web/server.ts` because the file still referenced removed `CodeGraph` APIs (`decorators` search option, `getDecorators`, `getEdgesForNodes`).

### 4) Live MCP smoke test

Command used:

```bash
python -c "import json, subprocess; req=json.dumps({'jsonrpc':'2.0','method':'tools/list','id':1})+'\n'; proc=subprocess.run(['node','packages/springkg-mcp/dist/bin/springkg-mcp.js','--mcp','--path','examples/springcloud-demo'], input=req, text=True, capture_output=True, cwd=r'D:\code\codegraph-springcloud'); print(proc.stdout.strip())"
```

Observed result:

- `tools/list` returned **15** tools total.
- The returned list now includes:
  - `spring_method_impact`
  - `spring_field_impact`
  - `spring_module_summary`
  - `spring_find_change_surface`
  - `spring_runtime_dependency`
  - `spring_env_diff`

Count check command:

```bash
python -c "import json, subprocess; req=json.dumps({'jsonrpc':'2.0','method':'tools/list','id':1})+'\n'; proc=subprocess.run(['node','packages/springkg-mcp/dist/bin/springkg-mcp.js','--mcp','--path','examples/springcloud-demo'], input=req, text=True, capture_output=True, cwd=r'D:\code\codegraph-springcloud'); lines=[line for line in proc.stdout.splitlines() if line.strip()]; data=json.loads(lines[-1]); print(len(data['result']['tools']))"
```

Output:

```text
15
```

## Sample invocations

### `spring_method_impact`

```json
{
  "name": "spring_method_impact",
  "arguments": {
    "methodName": "approve",
    "depth": 2
  }
}
```

### `spring_field_impact`

```json
{
  "name": "spring_field_impact",
  "arguments": {
    "fieldName": "status",
    "className": "Order"
  }
}
```

### `spring_module_summary`

```json
{
  "name": "spring_module_summary",
  "arguments": {
    "modulePath": "com.example.order"
  }
}
```

### `spring_find_change_surface`

```json
{
  "name": "spring_find_change_surface",
  "arguments": {
    "files": [
      "src/order/OrderController.java",
      "src/order/OrderService.java"
    ],
    "depth": 2
  }
}
```

### `spring_runtime_dependency`

```json
{
  "name": "spring_runtime_dependency",
  "arguments": {
    "serviceName": "OrderService"
  }
}
```

### `spring_env_diff`

```json
{
  "name": "spring_env_diff",
  "arguments": {
    "env1": "dev",
    "env2": "prod"
  }
}
```

## Outcome

- Missing tools implemented: **6/6**
- MCP `tools/list` count: **15/15**
- Team E coverage added for each missing tool: **yes**
- `packages/springkg-mcp` build: **pass**
- `npx vitest run packages/springkg-mcp`: **0 failures**
- `npm run build`: **pass**
