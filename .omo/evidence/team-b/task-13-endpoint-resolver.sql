-- ============================================================
-- T13 — EndpointResolver
-- Source: packages/springkg-semantic/__tests__/endpoint-resolver.test.ts (5 tests passed)
-- ============================================================
-- NOTE: springkg.db is not yet provisioned by Team A. This is a
-- fixture-derived SQL sketch that mirrors the spring_symbols /
-- spring_edges rows the resolver would emit when Team A's
-- persistence layer lands.

-- spring_symbols (kind = 'endpoint') representative rows
INSERT INTO spring_symbols (kind, codegraph_node_id, name, qualified_name, file_path, start_line, end_line, metadata, confidence)
VALUES
  -- Case 1: class-level @RequestMapping only, no method mapping => NO endpoint emitted (negative case)
  -- (intentionally omitted)

  -- Case 2: method-level @GetMapping("/users/{id}"), no class mapping
  (
    'endpoint',
    'method-1',
    'GET /users/{id}',
    'com.example.UserController.getUser#GET:/users/{id}',
    'src/UserController.java',
    5, 20,
    json_object(
      'httpMethod','GET',
      'classPath',NULL,
      'methodPath','/users/{id}',
      'params',json_array(),
      'requestDtoCodegraphNodeId',NULL,
      'responseDtoCodegraphNodeId','dto-user',
      'controllerCodegraphNodeId','controller-1'
    ),
    1.0
  ),

  -- Case 3: class @RequestMapping("/api") + method @GetMapping("/users")
  (
    'endpoint',
    'method-1',
    'GET /api/users',
    'com.example.UserController.getUser#GET:/api/users',
    'src/UserController.java',
    5, 20,
    json_object(
      'httpMethod','GET',
      'classPath','/api',
      'methodPath','/users',
      'params',json_array(),
      'controllerCodegraphNodeId','controller-1'
    ),
    1.0
  ),

  -- Case 4: @RequestMapping multi-path fan-out => 2 endpoints
  (
    'endpoint','method-1','GET /a','com.example.UserController.x#GET:/a',
    'src/UserController.java',5,20,
    json_object('httpMethod','GET','methodPath','/a','controllerCodegraphNodeId','controller-1'),
    1.0
  ),
  (
    'endpoint','method-1','GET /b','com.example.UserController.x#GET:/b',
    'src/UserController.java',5,20,
    json_object('httpMethod','GET','methodPath','/b','controllerCodegraphNodeId','controller-1'),
    1.0
  ),

  -- Case 5: search endpoint with 2 @RequestParam params
  (
    'endpoint',
    'method-search',
    'GET /search',
    'com.example.UserController.search#GET:/search',
    'src/UserController.java',
    5, 20,
    json_object(
      'httpMethod','GET',
      'methodPath','/search',
      'params',json_array(
        json_object('name','q','kind','RequestParam','typeName','String','required',true),
        json_object('name','limit','kind','RequestParam','typeName','int','required',true)
      ),
      'responseDtoCodegraphNodeId','dto-user-list',
      'controllerCodegraphNodeId','controller-1'
    ),
    1.0
  );

-- spring_edges (HANDLED_BY): endpoint node id -> method codegraph id
INSERT INTO spring_edges (source_id, target_id, kind, confidence)
VALUES
  ('<endpoint-sha-method-1>',        'method-1',      'HANDLED_BY', 1.0),
  ('<endpoint-sha-api-users>',       'method-1',      'HANDLED_BY', 1.0),
  ('<endpoint-sha-a>',               'method-1',      'HANDLED_BY', 1.0),
  ('<endpoint-sha-b>',               'method-1',      'HANDLED_BY', 1.0),
  ('<endpoint-sha-search>',          'method-search', 'HANDLED_BY', 1.0);

-- spring_edges (CALLS): method -> callee, mirrored from codegraph 'calls' edges in the input
INSERT INTO spring_edges (source_id, target_id, kind, confidence)
VALUES
  ('method-1', 'service-1', 'CALLS', 1.0);