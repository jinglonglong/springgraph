# CodeGraph Language Verification Guide

You are verifying that CodeGraph fully supports a specific programming language. The user will give you a path to a real-world, popular open-source codebase cloned locally. Your job is to run a battery of realistic prompts against it using CodeGraph's API and verify the results are good enough to say that language is **covered and supported**.

A language is NOT verified until an LLM can reliably use CodeGraph's MCP tools to navigate that codebase — finding the right symbols, understanding call chains, exploring subsystems, and getting useful context for real tasks.

## Setup

### 1. Build and index

```bash
npm run build
rm -rf <codebase_path>/.codegraph
node dist/bin/codegraph.js init -iv <codebase_path>
```

The `-iv` flag gives verbose output showing extraction progress, node/edge counts, and timing.

### 2. Quick sanity check

```bash
# Verify nodes were extracted with proper qualified names
sqlite3 <codebase_path>/.codegraph/codegraph.db \
  "SELECT name, kind, qualified_name FROM nodes WHERE kind = 'method' LIMIT 10;"

# GOOD: file.go::StructName::method_name  (owner type present)
# BAD:  file.go::file.go::method_name     (owner type missing — needs getReceiverType)

# Check edge counts
sqlite3 <codebase_path>/.codegraph/codegraph.db \
  "SELECT kind, COUNT(*) FROM edges GROUP BY kind ORDER BY COUNT(*) DESC;"

# Check node kind distribution
sqlite3 <codebase_path>/.codegraph/codegraph.db \
  "SELECT kind, COUNT(*) FROM nodes GROUP BY kind ORDER BY COUNT(*) DESC;"
```

If methods are missing their owner type in `qualified_name`, fix that first (see [Adding getReceiverType](#adding-getreceivertype)) before proceeding with the full test battery.

## The Test Battery

Run **all** of the following test categories against the codebase. Use the Node.js API directly — the test scripts below are templates. Adapt the queries to match real types, methods, and subsystems in the codebase you're testing.

**Pass criteria for each test:** Does the result give an LLM enough correct information to answer the question or complete the task? Would you trust these results if you were the LLM?

---

### Test 1: `codegraph_explore` — Deep Exploration (MOST IMPORTANT)

This is the primary tool LLMs use. It must return relevant source code grouped by file, with correct relationships, for a natural language query. Test it with **at least 5 different query types**:

```bash
node -e "
const { CodeGraph } = require('./dist/index.js');
async function test() {
  const cg = await CodeGraph.open('<codebase_path>');

  const queries = [
    // A. Subsystem exploration — broad topic, should find the right files and key classes
    'How does the caching system work?',

    // B. Specific class/type deep dive — should return that class, its methods, and related types
    'CacheBuilder configuration and build process',

    // C. Cross-cutting concern — should find implementations across multiple files
    'How are errors handled and propagated?',

    // D. Data flow question — should trace through multiple layers
    'How does data flow from input to storage?',

    // E. Implementation detail — specific method behavior
    'How does eviction decide which entries to remove?',
  ];

  for (const query of queries) {
    console.log(\`\n========================================\`);
    console.log(\`QUERY: \${query}\`);
    console.log(\`========================================\`);

    const subgraph = await cg.findRelevantContext(query, {
      searchLimit: 8, traversalDepth: 3, maxNodes: 80, minScore: 0.2,
    });

    // Show entry points — these are what the LLM sees first
    console.log(\`\nEntry points (\${subgraph.roots.length}):\`);
    for (const rootId of subgraph.roots.slice(0, 8)) {
      const node = subgraph.nodes.get(rootId);
      if (node) console.log(\`  \${node.name} (\${node.kind}) — \${node.filePath}:\${node.startLine}\`);
    }

    // Show file distribution — are the right files surfacing?
    const fileGroups = new Map();
    for (const node of subgraph.nodes.values()) {
      if (!fileGroups.has(node.filePath)) fileGroups.set(node.filePath, []);
      fileGroups.get(node.filePath).push(node.name);
    }
    console.log(\`\nFiles (\${fileGroups.size}):\`);
    for (const [file, nodes] of [...fileGroups.entries()].sort((a,b) => b[1].length - a[1].length).slice(0, 8)) {
      console.log(\`  \${file} (\${nodes.length} symbols): \${nodes.slice(0, 6).join(', ')}\`);
    }

    // Show edge distribution — are relationships being captured?
    const edgeKinds = new Map();
    for (const edge of subgraph.edges) {
      edgeKinds.set(edge.kind, (edgeKinds.get(edge.kind) || 0) + 1);
    }
    console.log(\`\nEdges (\${subgraph.edges.length}):\`);
    for (const [kind, count] of [...edgeKinds.entries()].sort((a,b) => b - a)) {
      console.log(\`  \${kind}: \${count}\`);
    }

    console.log(\`\nTotal: \${subgraph.nodes.size} nodes, \${subgraph.edges.length} edges, \${fileGroups.size} files\`);
  }

  await cg.close();
}
test().catch(console.error);
"
```

**What to check for each query:**
- Do the entry points make sense for the question?
- Are the right files surfacing (not just test files or unrelated code)?
- Is there a mix of edge types (calls, contains, extends, implements) — not just `contains`?
- Does the node count feel right? Too few (<5) means search failed. Too many irrelevant ones means noise.

---

### Test 2: `codegraph_search` — Symbol Lookup

Test that searching for specific symbols returns the right results ranked correctly.

```bash
node -e "
const { CodeGraph } = require('./dist/index.js');
async function test() {
  const cg = await CodeGraph.open('<codebase_path>');

  const searches = [
    // A. Class by name
    { query: 'CacheBuilder', kinds: ['class'], desc: 'Find a specific class' },

    // B. Method on a specific type (the classic disambiguation test)
    { query: 'CacheBuilder build', kinds: ['method'], desc: 'Method on specific class' },

    // C. Common method name — should still find relevant ones
    { query: 'get', kinds: ['method'], desc: 'Common method name' },

    // D. Interface/trait
    { query: 'Cache', kinds: ['interface'], desc: 'Find an interface' },

    // E. Enum
    { query: 'Strength', kinds: ['enum'], desc: 'Find an enum' },
  ];

  for (const s of searches) {
    console.log(\`\n--- \${s.desc}: \"\${s.query}\" (kinds: \${s.kinds}) ---\`);
    const results = cg.searchNodes(s.query, { limit: 10, kinds: s.kinds });
    for (const r of results) {
      console.log(\`  \${r.score.toFixed(1)} | \${r.node.name} (\${r.node.kind}) | \${r.node.qualifiedName}\`);
    }
    if (results.length === 0) console.log('  *** NO RESULTS ***');
  }

  await cg.close();
}
test().catch(console.error);
"
```

**What to check:**
- Does the target symbol rank in the top 3?
- For common names like `get`, do the results include qualified names that help disambiguate?
- Are there zero-result queries? That's a bug.

---

### Test 3: `codegraph_callers` / `codegraph_callees` — Call Chain Tracing

Test that call relationships were extracted correctly.

```bash
node -e "
const { CodeGraph } = require('./dist/index.js');
async function test() {
  const cg = await CodeGraph.open('<codebase_path>');

  // Pick 3-4 important methods and check their call graphs
  const symbols = ['build', 'get', 'put', 'invalidate'];

  for (const sym of symbols) {
    // Find the symbol
    const results = cg.searchNodes(sym, { limit: 5, kinds: ['method'] });
    if (results.length === 0) { console.log(\`\${sym}: not found\`); continue; }

    const node = results[0].node;
    console.log(\`\n--- \${node.name} (\${node.qualifiedName}) ---\`);

    // Check callees (what does it call?)
    const callees = cg.getCallees(node.id);
    console.log(\`  Callees (\${callees.length}): \${callees.slice(0, 10).map(c => c.node.name).join(', ')}\`);

    // Check callers (what calls it?)
    const callers = cg.getCallers(node.id);
    console.log(\`  Callers (\${callers.length}): \${callers.slice(0, 10).map(c => c.node.name).join(', ')}\`);
  }

  await cg.close();
}
test().catch(console.error);
"
```

**What to check:**
- Do methods have callers AND callees? If a method has 0 of both, edge extraction may be broken.
- Do the callers/callees make sense? A `build()` method should call constructor-like things, and be called by setup/initialization code.
- Are the counts reasonable? A core method in a popular codebase should have multiple callers.

---

### Test 4: `codegraph_impact` — Change Impact Analysis

Test that the impact radius correctly identifies affected code.

```bash
node -e "
const { CodeGraph } = require('./dist/index.js');
async function test() {
  const cg = await CodeGraph.open('<codebase_path>');

  // Pick a core class or interface that many things depend on
  const results = cg.searchNodes('<CoreClass>', { limit: 1, kinds: ['class', 'interface'] });
  if (results.length === 0) { console.log('Not found'); return; }

  const node = results[0].node;
  console.log(\`Impact analysis for: \${node.name} (\${node.kind}) — \${node.filePath}\`);

  const impact = cg.getImpactRadius(node.id, 2);
  console.log(\`\nAffected nodes: \${impact.nodes.size}\`);
  console.log(\`Affected edges: \${impact.edges.length}\`);

  // Group by file
  const files = new Map();
  for (const n of impact.nodes.values()) {
    if (!files.has(n.filePath)) files.set(n.filePath, []);
    files.get(n.filePath).push(n.name);
  }
  console.log(\`Affected files: \${files.size}\`);
  for (const [file, nodes] of [...files.entries()].sort((a,b) => b[1].length - a[1].length).slice(0, 10)) {
    console.log(\`  \${file}: \${nodes.slice(0, 5).join(', ')}\`);
  }

  await cg.close();
}
test().catch(console.error);
"
```

**What to check:**
- Does changing a core interface/class show a wide impact radius?
- Are the affected files reasonable (things that import/extend/use it)?
- Is the impact radius non-empty? Zero impact on a core type means edges are missing.

---

### Test 5: Edge Extraction Quality

Directly verify that the major edge types are being extracted for this language.

```bash
node -e "
const { CodeGraph } = require('./dist/index.js');
async function test() {
  const cg = await CodeGraph.open('<codebase_path>');

  // Check overall edge distribution
  console.log('=== Edge distribution ===');
  // (Use sqlite3 query from sanity check above)

  // Find a class that extends another
  const classes = cg.searchNodes('', { limit: 100, kinds: ['class'] });
  let foundExtends = false, foundImplements = false;
  for (const r of classes) {
    const callees = cg.getCallees(r.node.id);
    // getCallees returns all outgoing edges, check for extends/implements
    // Better: use graph traversal
  }

  // Verify specific relationship types exist
  const checks = [
    { desc: 'contains edges (class → method)', query: 'SELECT COUNT(*) FROM edges WHERE kind = \"contains\"' },
    { desc: 'calls edges', query: 'SELECT COUNT(*) FROM edges WHERE kind = \"calls\"' },
    { desc: 'imports edges', query: 'SELECT COUNT(*) FROM edges WHERE kind = \"imports\"' },
    { desc: 'extends edges', query: 'SELECT COUNT(*) FROM edges WHERE kind = \"extends\"' },
    { desc: 'implements edges', query: 'SELECT COUNT(*) FROM edges WHERE kind = \"implements\"' },
  ];
  // Run these via sqlite3 (shown in sanity check section)

  await cg.close();
}
test().catch(console.error);
"
```

```bash
sqlite3 <codebase_path>/.codegraph/codegraph.db "
  SELECT kind, COUNT(*) as cnt FROM edges GROUP BY kind ORDER BY cnt DESC;
"
```

**What to check:**
- `contains` should be the most common (structural hierarchy).
- `calls` should be plentiful — if near zero, call extraction is broken for this language.
- `imports` should exist — if zero, import parsing is broken.
- `extends` and `implements` should exist if the language has inheritance — if zero, `extractInheritance()` may not handle this language's AST.

---

### Test 6: Node Extraction Completeness

Verify all expected node kinds are being extracted.

```bash
sqlite3 <codebase_path>/.codegraph/codegraph.db "
  SELECT kind, COUNT(*) as cnt FROM nodes GROUP BY kind ORDER BY cnt DESC;
"
```

**What to check for each language:**

| Node Kind | Expected? | Notes |
|-----------|-----------|-------|
| `file` | Always | One per source file |
| `class` | If language has classes | |
| `method` | If language has methods | Should include owner type in `qualified_name` |
| `function` | If language has top-level functions | |
| `interface` | If language has interfaces/protocols | |
| `enum` | If language has enums | |
| `enum_member` | If language has enums | Values inside enums |
| `import` | Always | One per import statement |
| `variable` / `field` | Usually | Fields, constants, top-level vars |
| `struct` | If language has structs | Go, Rust, C, Swift |
| `trait` | If language has traits | Rust |

If an expected node kind has 0 count, the language extractor is missing that AST type.

---

### Test 7: Real-World LLM Prompts

This is the final and most important test. Simulate the kinds of questions a developer would actually ask an LLM that's using CodeGraph. For each prompt, run `findRelevantContext` (which powers `codegraph_explore`) and evaluate whether the returned context would let an LLM give a correct, complete answer.

**Run at least 5 of these prompt styles, adapted to the actual codebase:**

```bash
node -e "
const { CodeGraph } = require('./dist/index.js');
async function test() {
  const cg = await CodeGraph.open('<codebase_path>');

  const prompts = [
    // 1. \"How does X work?\" — subsystem understanding
    'How does the cache eviction policy work?',

    // 2. \"Where is X implemented?\" — symbol location
    'Where is the LRU eviction logic implemented?',

    // 3. \"What calls X?\" — usage discovery
    'What code triggers cache invalidation?',

    // 4. \"I want to change X, what breaks?\" — impact assessment
    'If I change the Cache interface, what else is affected?',

    // 5. \"How do X and Y interact?\" — cross-component relationships
    'How does CacheBuilder connect to LocalCache?',

    // 6. \"Show me the flow from A to B\" — data/control flow
    'What happens when a cache entry expires?',

    // 7. \"What are all the implementations of X?\" — polymorphism
    'What classes implement the Cache interface?',

    // 8. Bug investigation prompt
    'Cache entries are not being evicted when they should be — where should I look?',
  ];

  for (const prompt of prompts) {
    console.log(\`\n========================================\`);
    console.log(\`PROMPT: \${prompt}\`);
    console.log(\`========================================\`);

    const subgraph = await cg.findRelevantContext(prompt, {
      searchLimit: 8, traversalDepth: 3, maxNodes: 80, minScore: 0.2,
    });

    console.log(\`Result: \${subgraph.nodes.size} nodes, \${subgraph.edges.length} edges, \${subgraph.roots.length} entry points\`);

    console.log('Entry points:');
    for (const rootId of subgraph.roots.slice(0, 5)) {
      const node = subgraph.nodes.get(rootId);
      if (node) console.log(\`  \${node.name} (\${node.kind}) — \${node.filePath}:\${node.startLine}\`);
    }

    const fileGroups = new Map();
    for (const node of subgraph.nodes.values()) {
      if (!fileGroups.has(node.filePath)) fileGroups.set(node.filePath, []);
      fileGroups.get(node.filePath).push(node.name);
    }
    console.log('Top files:');
    for (const [file, nodes] of [...fileGroups.entries()].sort((a,b) => b[1].length - a[1].length).slice(0, 5)) {
      console.log(\`  \${file} (\${nodes.length}): \${nodes.slice(0, 5).join(', ')}\`);
    }

    // PASS/FAIL judgment
    const hasEntryPoints = subgraph.roots.length > 0;
    const hasEdges = subgraph.edges.length > 0;
    const hasMultipleFiles = fileGroups.size > 1;
    console.log(\`\\nVERDICT: \${hasEntryPoints && hasEdges && hasMultipleFiles ? 'PASS' : 'FAIL — needs investigation'}\`);
  }

  await cg.close();
}
test().catch(console.error);
"
```

**What to check for each prompt:**
- Does it return entry points? Zero entry points = total failure.
- Are the entry points **relevant** to the question? (Not just random symbols that happen to share a word.)
- Does it span multiple files? Most real questions involve cross-file understanding.
- Are relationships present? An LLM needs to understand how symbols connect, not just a list of names.
- Would **you** be able to answer the question from this context?

---

## Diagnosing Failures

| Symptom | Likely Cause | Where to Fix |
|---------|-------------|--------------|
| Method missing owner type in `qualified_name` | Language needs `getReceiverType` | `src/extraction/languages/<lang>.ts` |
| `codegraph_explore` returns irrelevant files | Common names flooding FTS; co-location boost not helping | `src/db/queries.ts: findNodesByExactName`, `src/context/index.ts` |
| Zero `calls` edges | `callTypes` missing or wrong AST node type | `src/extraction/languages/<lang>.ts: callTypes` |
| Zero `extends`/`implements` edges | `extractInheritance()` doesn't handle this language's AST | `src/extraction/tree-sitter.ts: extractInheritance()` |
| Missing node kinds (no enums, no interfaces) | AST type not listed in extractor | `src/extraction/languages/<lang>.ts: enumTypes`, `interfaceTypes`, etc. |
| Search term dropped from query | Term is in the stop words list | `src/search/query-utils.ts: STOP_WORDS` |
| `qualified_name` missing class for nested methods | Extraction not walking parent stack correctly | `src/extraction/tree-sitter.ts: visitNode()` |
| Import edges missing | `extractImport` returns null for this syntax | `src/extraction/languages/<lang>.ts: extractImport` |
| C++ classes/structs/enums missing from macro namespaces | Macros like `NLOHMANN_JSON_NAMESPACE_BEGIN` cause tree-sitter to misparse namespace blocks as `function_definition` | `src/extraction/languages/c-cpp.ts: isMisparsedFunction` filters bad names; `src/extraction/tree-sitter.ts: visitFunctionBody` extracts structural nodes |
| C++ classes missing from `.h` headers | `.h` files default to `c` language which has `classTypes: []` | `src/extraction/grammars.ts: looksLikeCpp()` — content-based heuristic promotes `.h` files to `cpp` when C++ patterns detected |
| Ruby methods inside modules missing owner in `qualified_name` | Ruby `module` AST nodes not being extracted | `src/extraction/languages/ruby.ts: visitNode` hook extracts modules; `src/extraction/tree-sitter.ts: isInsideClassLikeNode` includes `module` kind |

## After Fixing Issues

```bash
npm run build
rm -rf <codebase_path>/.codegraph
node dist/bin/codegraph.js init -iv <codebase_path>
# Re-run the failing tests from above
```

Always run the full test suite before marking a language as verified:

```bash
npm test
```

## Adding `getReceiverType`

**Only needed for languages where methods are top-level or outside their owner type in the AST.** If the language nests methods inside class/struct bodies (Python, Java, TypeScript, C#), the qualified name already includes the parent — verify with the sanity check before adding anything.

### 1. Add the hook to the language extractor

In `src/extraction/languages/<lang>.ts`, add `getReceiverType` to the extractor object:

```typescript
getReceiverType: (node, source) => {
  // Extract the owner type name from the method's AST node.
  // Return the type name string, or undefined if not applicable.
  //
  // The core extractMethod() in tree-sitter.ts will use this to set:
  //   qualifiedName = `${filePath}::${receiverType}::${methodName}`
},
```

### 2. Reference: Go implementation

```typescript
// src/extraction/languages/go.ts
getReceiverType: (node, source) => {
  const receiver = getChildByField(node, 'receiver');
  if (!receiver) return undefined;
  const text = getNodeText(receiver, source);
  const match = text.match(/\*?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/);
  return match?.[1];
},
```

### 3. Where it's consumed

`src/extraction/tree-sitter.ts` in `extractMethod()`:

```typescript
const receiverType = this.extractor.getReceiverType?.(node, this.source);
if (receiverType) {
  extraProps.qualifiedName = `${this.filePath}::${receiverType}::${name}`;
}
```

## Key Files

| File | Role |
|------|------|
| `src/extraction/languages/<lang>.ts` | Language extractor — node types, call types, `getReceiverType` |
| `src/extraction/tree-sitter.ts` | Core extraction — `extractMethod()`, `extractCall()`, `extractInheritance()` |
| `src/extraction/tree-sitter-types.ts` | `LanguageExtractor` interface definition |
| `src/search/query-utils.ts` | `STOP_WORDS`, `extractSearchTerms`, `scorePathRelevance` |
| `src/db/queries.ts` | `searchNodesFTS` (BM25), `findNodesByExactName` (co-location boost) |
| `src/context/index.ts` | `findRelevantContext` — hybrid search + graph traversal |
| `src/mcp/tools.ts` | MCP tool handlers — `codegraph_explore` implementation |

## Language Status

### Verified

- [x] **Go** — `getReceiverType` extracts receiver from `func (sl *Type) method()`
- [x] **Swift** — NOT needed. Tree-sitter nests methods inside class/extension bodies
- [x] **Java** — NOT needed. Methods nested in class body. Verified against Guava
- [x] **Python** — NOT needed. Methods nested in class body. Verified against Flask
- [x] **Rust** — `getReceiverType` walks up to parent `impl_item` to extract type name. Also adds `contains` edges from struct to impl methods. Verified against Deno
- [x] **C** — NOT needed. No methods in C. Strong function/struct/enum extraction with excellent call edge density. Verified against Redis
- [x] **C++** — NOT needed for header-only libs. `isMisparsedFunction` hook filters macro-caused misparse artifacts (e.g. `NLOHMANN_JSON_NAMESPACE_BEGIN`). `visitFunctionBody` now extracts structural nodes (classes/structs/enums) inside macro-confused "function" bodies. Content-based `.h` detection (`looksLikeCpp` in `grammars.ts`) promotes C++ headers to `cpp` language so classes in `.h` files are extracted. Verified against nlohmann/json and gRPC. Note: out-of-class `Type::method()` definitions would need `getReceiverType` but are uncommon in header-only codebases.
- [x] **C#** — NOT needed. Methods nested in class body. Added `base_list` handling in `extractInheritance` for C#'s `: Parent, IInterface` syntax. Added `propertyTypes` support for C# `property_declaration` nodes. Fixed `extractField` to handle C#'s nested `variable_declaration > variable_declarator` structure. Verified against Jellyfin
- [x] **Ruby** — NOT needed for `getReceiverType`. Methods nested in class body. Added `visitNode` hook to extract Ruby `module` nodes (concerns, namespaces) with proper containment and qualified names. Methods inside modules get `Module::method` qualified names. Also wired up the `ExtractorContext` with `pushScope`/`popScope` for language hooks. Verified against Discourse

### Needs Verification

Check these — may need `getReceiverType` if methods are top-level in the AST:

- [ ] Kotlin — extension functions `fun Type.method()`

Verify these DON'T need `getReceiverType` (methods nested in class body):

- [ ] TypeScript
