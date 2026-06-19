-- ============================================================
-- T14 — FeignResolver
-- Source: packages/springkg-semantic/__tests__/feign-resolver.test.ts (6 tests passed)
-- ============================================================
-- NOTE: springkg.db is not yet provisioned by Team A. This is a
-- fixture-derived SQL sketch that mirrors the spring_symbols /
-- spring_edges rows the resolver would emit when Team A's
-- persistence layer lands.

-- spring_symbols (kind = 'feign_client') representative rows
INSERT INTO spring_symbols (kind, codegraph_node_id, name, qualified_name, file_path, start_line, end_line, metadata, confidence)
VALUES
  -- name="user-service" -> targetServiceName=user-service, confidence 1.0
  (
    'feign_client', 'feign-client-1', 'UserClient',
    'com.example.UserClient', 'src/UserClient.java', 1, 20,
    json_object(
      'name','user-service','value',NULL,'contextId',NULL,'path',NULL,'url',NULL,
      'targetServiceName','user-service','isDirectConnect',false
    ),
    1.0
  ),
  -- value="order-svc" -> targetServiceName=order-svc, confidence 1.0
  (
    'feign_client', 'feign-client-1', 'OrderClient',
    'com.example.OrderClient', 'src/OrderClient.java', 1, 20,
    json_object(
      'name',NULL,'value','order-svc','contextId',NULL,'path',NULL,'url',NULL,
      'targetServiceName','order-svc','isDirectConnect',false
    ),
    1.0
  ),
  -- contextId="legacyX" only -> fallback, confidence 0.7
  (
    'feign_client', 'feign-client-1', 'LegacyClient',
    'com.example.LegacyClient', 'src/LegacyClient.java', 1, 20,
    json_object(
      'name',NULL,'value',NULL,'contextId','legacyX','path',NULL,'url',NULL,
      'targetServiceName','legacyX','isDirectConnect',false
    ),
    0.7
  ),
  -- name + path -> targetServiceName=x, path=/api/v2
  (
    'feign_client', 'feign-client-1', 'XClient',
    'com.example.XClient', 'src/XClient.java', 1, 20,
    json_object(
      'name','x','value',NULL,'contextId',NULL,'path','/api/v2','url',NULL,
      'targetServiceName','x','isDirectConnect',false
    ),
    1.0
  ),
  -- url=... -> isDirectConnect=true, remote_service confidence 1.0
  (
    'feign_client', 'feign-client-1', 'StaticClient',
    'com.example.StaticClient', 'src/StaticClient.java', 1, 20,
    json_object(
      'name','x','value',NULL,'contextId',NULL,'path',NULL,'url','http://static.example.com/x',
      'targetServiceName','x','isDirectConnect',true
    ),
    1.0
  );

-- spring_symbols (kind = 'remote_service'), one per unique targetServiceName
INSERT INTO spring_symbols (kind, codegraph_node_id, name, qualified_name, metadata, confidence)
VALUES
  ('remote_service', 'remote-service:user-service', 'user-service', 'user-service',
   json_object('targetServiceName','user-service','url',NULL,'isDirectConnect',false), 0.8),
  ('remote_service', 'remote-service:order-svc', 'order-svc', 'order-svc',
   json_object('targetServiceName','order-svc','url',NULL,'isDirectConnect',false), 0.8),
  ('remote_service', 'remote-service:x', 'x', 'x',
   json_object('targetServiceName','x','url','http://static.example.com/x','isDirectConnect',true), 1.0);

-- spring_symbols (kind = 'feign_method'), one per mapped method on the Feign interface
-- Example fixture: @GetMapping("/list") UserDto[] list()
INSERT INTO spring_symbols (kind, codegraph_node_id, name, qualified_name, file_path, start_line, end_line, metadata, confidence)
VALUES
  (
    'feign_method', 'method-1', 'list',
    'com.example.UserClient.list', 'src/UserClient.java', 3, 8,
    json_object(
      'feignPath','/list',
      'httpMethod','GET',
      'paramTypes', json_array('FilterDto'),
      'returnType','UserDto[]',
      'targetServiceName','user-service',
      'feignClientCodegraphNodeId','client-1'
    ),
    1.0
  );

-- spring_edges (kind = 'BELONGS_TO'): feign_method -> feign_client
INSERT INTO spring_edges (source_id, target_id, kind, confidence)
VALUES
  ('<sha-feign_method-method-1>', '<sha-feign_client-feign-client-1>', 'BELONGS_TO', 1.0);