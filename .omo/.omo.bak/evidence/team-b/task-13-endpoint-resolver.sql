-- ============================================================
-- T13 — EndpointResolver: spring_symbols(kind='endpoint') + HANDLED_BY / CALLS edges
-- ============================================================
-- Evidence derived from package-local verified fixtures:
--   packages/springkg-semantic/__tests__/endpoint-resolver.test.ts
--   packages/springkg-semantic/src/endpoint-resolver.ts
--
-- NOTE: No live springkg.db exists yet (Team A persistence not landed).
--       This is a fixture-grounded SQL-style snapshot for illustration.
-- ============================================================

-- ----------------------------------------------------------
-- spring_symbols (kind = 'endpoint')
-- Columns: id, kind, codegraph_node_id, name, qualified_name,
--          file_path, start_line, end_line, metadata (JSON),
--          confidence, created_at, updated_at
-- ----------------------------------------------------------

-- Case 1: GET /users/{id} — method-level @GetMapping, no class-level @RequestMapping
-- Input fixture: controller=REST_USER_CTRL, method=getUser, decorators=[@GetMapping("/users/{id}")],
--   metadata.returnTypeNodeId='dto-user', calls edge: method -> service-1
INSERT INTO spring_symbols (kind, codegraph_node_id, name, qualified_name, file_path, start_line, end_line, metadata, confidence, created_at)
VALUES (
  'endpoint',
  'method-1',
  'GET /users/{id}',
  'com.example.UserController.getUser#GET:/users/{id}',
  'src/UserController.java',
  5,
  20,
  '{"httpMethod":"GET","classPath":null,"methodPath":"/users/{id}","params":[],"requestDtoCodegraphNodeId":null,"responseDtoCodegraphNodeId":"dto-user","controllerCodegraphNodeId":"controller-1"}',
  1.0,
  1740000000000
);

-- Case 2: GET /api/users — merged class-level @RequestMapping("/api") + method-level @GetMapping("/users")
-- Input fixture: controller decorators=[@RestController, @RequestMapping("/api")],
--   method decorators=[@GetMapping("/users")]
INSERT INTO spring_symbols (kind, codegraph_node_id, name, qualified_name, file_path, start_line, end_line, metadata, confidence, created_at)
VALUES (
  'endpoint',
  'method-1',
  'GET /api/users',
  'com.example.UserController.getUser#GET:/api/users',
  'src/UserController.java',
  5,
  20,
  '{"httpMethod":"GET","classPath":"/api","methodPath":"/users","params":[],"requestDtoCodegraphNodeId":null,"responseDtoCodegraphNodeId":null,"controllerCodegraphNodeId":"controller-1"}',
  1.0,
  1740000000000
);

-- Case 3: RequestMapping array fans out to one endpoint per path — GET /a and GET /b
-- Input fixture: method decorators=[@RequestMapping({ value: ["/a", "/b"], method: RequestMethod.GET })]
INSERT INTO spring_symbols (kind, codegraph_node_id, name, qualified_name, file_path, start_line, end_line, metadata, confidence, created_at)
VALUES
  ('endpoint', 'method-1', 'GET /a', 'com.example.UserController.getUser#GET:/a', 'src/UserController.java', 5, 20, '{"httpMethod":"GET","classPath":null,"methodPath":"/a","params":[],"controllerCodegraphNodeId":"controller-1"}', 1.0, 1740000000000),
  ('endpoint', 'method-1', 'GET /b', 'com.example.UserController.getUser#GET:/b', 'src/UserController.java', 5, 20, '{"httpMethod":"GET","classPath":null,"methodPath":"/b","params":[],"controllerCodegraphNodeId":"controller-1"}', 1.0, 1740000000000);

-- Case 4: endpoint with @RequestParam and @PathVariable extracted into params metadata
-- Input fixture: method=getSearch, decorators=[@GetMapping("/search")], metadata.returnTypeNodeId='dto-user-list'
--   param: name=q, decorators=[@RequestParam("q")], metadata.typeName='String'
--   param: name=limit, decorators=[@RequestParam(name="limit")], metadata.typeName='int'
INSERT INTO spring_symbols (kind, codegraph_node_id, name, qualified_name, file_path, start_line, end_line, metadata, confidence, created_at)
VALUES (
  'endpoint',
  'method-search',
  'GET /search',
  'com.example.UserController.search#GET:/search',
  'src/UserController.java',
  5,
  20,
  '{"httpMethod":"GET","classPath":null,"methodPath":"/search","params":[{"name":"q","kind":"RequestParam","typeName":"String","required":true},{"name":"limit","kind":"RequestParam","typeName":"int","required":true}],"responseDtoCodegraphNodeId":"dto-user-list","controllerCodegraphNodeId":"controller-1"}',
  1.0,
  1740000000000
);

-- ----------------------------------------------------------
-- spring_edges — HANDLED_BY and CALLS
-- Columns: id, source_id, target_id, kind, metadata (JSON),
--          confidence, created_at
-- ----------------------------------------------------------

-- HANDLED_BY: endpoint -> method (always one per endpoint)
-- id = sha256("HANDLED_BY" | endpoint.id | method.id | "HANDLED_BY").slice(0,32)
INSERT INTO spring_edges (source_id, target_id, kind, metadata, confidence, created_at)
VALUES
  ('<endpoint:hash-of-case1>', 'method-1', 'HANDLED_BY', '{}', 1.0, 1740000000000),
  ('<endpoint:hash-of-case2>', 'method-1', 'HANDLED_BY', '{}', 1.0, 1740000000000),
  ('<endpoint:hash-of-case3a>', 'method-1', 'HANDLED_BY', '{}', 1.0, 1740000000000),
  ('<endpoint:hash-of-case3b>', 'method-1', 'HANDLED_BY', '{}', 1.0, 1740000000000),
  ('<endpoint:hash-of-case4>', 'method-search', 'HANDLED_BY', '{}', 1.0, 1740000000000);

-- CALLS: forwarded directly from the codegraph 'calls' edge where method -> some-callee
-- Only emitted for methods that have existing codegraph 'calls' edges in the input.
-- Example: method-1 calls service-1 (from test case 1)
INSERT INTO spring_edges (source_id, target_id, kind, metadata, confidence, created_at)
VALUES
  ('method-1', 'service-1', 'CALLS', '{}', 1.0, 1740000000000);

-- ----------------------------------------------------------
-- Summary of verifiable fixture outcomes
-- ----------------------------------------------------------
-- symbolsAdded per endpoint test case:
--   case 1 (GetMapping): 1 endpoint, 1 HANDLED_BY, 1 CALLS edge
--   case 2 (merged paths): 1 endpoint, 1 HANDLED_BY edge, 0 CALLS
--   case 3 (array fan-out): 2 endpoints, 2 HANDLED_BY edges, 0 CALLS
--   case 4 (params extracted): 1 endpoint, 1 HANDLED_BY, 0 CALLS
--
-- byKind.endpoint counts match result.byKind.endpoint from each test assertion.
