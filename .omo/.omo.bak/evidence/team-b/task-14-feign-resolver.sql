-- ============================================================
-- T14 — FeignResolver: feign_client, remote_service, feign_method + BELONGS_TO
-- ============================================================
-- Evidence derived from package-local verified fixtures:
--   packages/springkg-semantic/__tests__/feign-resolver.test.ts
--   packages/springkg-semantic/src/feign-resolver.ts
--
-- NOTE: No live springkg.db exists yet (Team A persistence not landed).
--       This is a fixture-grounded SQL-style snapshot for illustration.
-- ============================================================

-- ----------------------------------------------------------
-- spring_symbols — feign_client rows
-- ----------------------------------------------------------
-- Case: @FeignClient(name="user-service") on an interface
-- confidence = 1.0 when name= or value= is present; 0.7 when only contextId or fallback name
INSERT INTO spring_symbols (kind, codegraph_node_id, name, qualified_name, file_path, start_line, end_line, metadata, confidence, created_at)
VALUES (
  'feign_client',
  'feign-client-1',
  'UserClient',
  'com.example.UserClient',
  'src/UserClient.java',
  1,
  20,
  '{"name":"user-service","value":null,"contextId":null,"path":null,"url":null,"targetServiceName":"user-service","isDirectConnect":false}',
  1.0,
  1740000000000
);

-- Case: @FeignClient(value="order-svc") — value= used as targetServiceName
INSERT INTO spring_symbols (kind, codegraph_node_id, name, qualified_name, file_path, start_line, end_line, metadata, confidence, created_at)
VALUES (
  'feign_client',
  'feign-client-1',
  'OrderClient',
  'com.example.OrderClient',
  'src/OrderClient.java',
  1,
  20,
  '{"name":null,"value":"order-svc","contextId":null,"path":null,"url":null,"targetServiceName":"order-svc","isDirectConnect":false}',
  1.0,
  1740000000000
);

-- Case: @FeignClient(contextId="legacyX") — falls back to contextId; confidence 0.7
INSERT INTO spring_symbols (kind, codegraph_node_id, name, qualified_name, file_path, start_line, end_line, metadata, confidence, created_at)
VALUES (
  'feign_client',
  'feign-client-1',
  'LegacyClient',
  'com.example.LegacyClient',
  'src/LegacyClient.java',
  1,
  20,
  '{"name":null,"value":null,"contextId":"legacyX","path":null,"url":null,"targetServiceName":"legacyX","isDirectConnect":false}',
  0.7,
  1740000000000
);

-- Case: @FeignClient(name="x", url="http://static.example.com/x") — isDirectConnect: true, remote_service confidence 1.0
INSERT INTO spring_symbols (kind, codegraph_node_id, name, qualified_name, file_path, start_line, end_line, metadata, confidence, created_at)
VALUES (
  'feign_client',
  'feign-client-1',
  'StaticClient',
  'com.example.StaticClient',
  'src/StaticClient.java',
  1,
  20,
  '{"name":"x","value":null,"contextId":null,"path":null,"url":"http://static.example.com/x","targetServiceName":"x","isDirectConnect":true}',
  1.0,
  1740000000000
);

-- ----------------------------------------------------------
-- spring_symbols — remote_service rows (one per unique targetServiceName per enhance pass)
-- ----------------------------------------------------------
INSERT INTO spring_symbols (kind, codegraph_node_id, name, qualified_name, file_path, start_line, end_line, metadata, confidence, created_at)
VALUES
  ('remote_service', 'remote-service:user-service', 'user-service', 'user-service', NULL, NULL, NULL, '{"targetServiceName":"user-service","url":null,"isDirectConnect":false}', 0.8, 1740000000000),
  ('remote_service', 'remote-service:order-svc',  'order-svc',  'order-svc',  NULL, NULL, NULL, '{"targetServiceName":"order-svc","url":null,"isDirectConnect":false}', 0.8, 1740000000000),
  ('remote_service', 'remote-service:x',         'x',          'x',          NULL, NULL, NULL, '{"targetServiceName":"x","url":"http://static.example.com/x","isDirectConnect":true}',  1.0, 1740000000000);

-- ----------------------------------------------------------
-- spring_symbols — feign_method rows (one per mapped method in a Feign interface)
-- ----------------------------------------------------------
-- Example fixture: interface=UserClient (@FeignClient(name="user-service")),
--   method=getList, decorators=[@GetMapping("/list")], returnType='UserDto[]'
--   parameter: id=param-1, metadata.typeName='FilterDto' (no decorator — not @RequestBody)
--   contains edges: client->method, method->param
INSERT INTO spring_symbols (kind, codegraph_node_id, name, qualified_name, file_path, start_line, end_line, metadata, confidence, created_at)
VALUES (
  'feign_method',
  'method-1',
  'list',
  'com.example.UserClient.list',
  'src/UserClient.java',
  3,
  8,
  '{"feignPath":"/list","httpMethod":"GET","paramTypes":["FilterDto"],"returnType":"UserDto[]","targetServiceName":"user-service","feignClientCodegraphNodeId":"client-1"}',
  1.0,
  1740000000000
);

-- ----------------------------------------------------------
-- spring_edges — BELONGS_TO (feign_method -> feign_client)
-- ----------------------------------------------------------
-- id = sha256("BELONGS_TO" | feign_method.id | feign_client.id | "BELONGS_TO").slice(0,32)
INSERT INTO spring_edges (source_id, target_id, kind, metadata, confidence, created_at)
VALUES
  ('<feign_method:hash-of-method1>', '<feign_client:hash-of-client1>', 'BELONGS_TO', '{}', 1.0, 1740000000000);

-- ----------------------------------------------------------
-- Summary of verifiable fixture outcomes
-- ----------------------------------------------------------
-- Target service name resolution priority (from @FeignClient decorator):
--   name=  -> targetServiceName  (confidence 1.0 for feign_client)
--   value= -> targetServiceName  (confidence 1.0)
--   contextId= -> targetServiceName  (confidence 0.7)
--   kebabCase(interfaceName) -> targetServiceName  (confidence 0.7, no attr present)
--
-- Dedup: remote_service emitted once per unique targetServiceName per enhance pass
--   (new Map() keyed by spec.targetServiceName)
--
-- feignPath = joinPaths(feignClient.path, methodMapping.path)
--   with leading slash normalization and collapse of double slashes
--
-- @FeignClient(path="/api/v2") on the interface propagates into feignPath of all its methods
