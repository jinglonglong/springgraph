-- ============================================================
-- T42 — FeignDto (FeignRequestResponseType): dto rows + USES_DTO edges
-- ============================================================
-- Evidence derived from package-local verified fixtures:
--   packages/springkg-semantic/__tests__/feign-dto.test.ts
--   packages/springkg-semantic/src/feign-dto.ts
--
-- NOTE: No live springkg.db exists yet (Team A persistence not landed).
--       This is a fixture-grounded SQL-style snapshot for illustration.
-- ============================================================

-- ----------------------------------------------------------
-- spring_symbols — dto rows
-- ----------------------------------------------------------
-- dto node emitted when a Feign method has a request body param OR a response return type
-- that is not a primitive / primitive-like type (see isPrimitiveLike filter).
--
-- id = sha256("dto" | feignMethodId | role | dto.codegraphNodeId | dto.typeName).slice(0,32)
--
-- Input fixtures:
--   interface: UserClient (@FeignClient(name="user-service"))
--   method:    create, decorators=[@PostMapping("/users")], returnType='UserDto',
--              metadata.returnTypeNodeId='dto-user'
--   parameter: req, decorators=[@RequestBody],
--              metadata.typeName='CreateUserRequest', metadata.typeNodeId='dto-create-user-request'
--   contains edges: interface->method, method->param

-- Request DTO node (role='request')
INSERT INTO spring_symbols (kind, codegraph_node_id, name, qualified_name, file_path, start_line, end_line, metadata, confidence, created_at)
VALUES (
  'dto',
  'dto-create-user-request',
  'CreateUserRequest',
  'CreateUserRequest',
  NULL,
  NULL,
  NULL,
  '{"fromFeignMethodId":"method-create","role":"request","typeName":"CreateUserRequest"}',
  0.9,
  1740000000000
);

-- Response DTO node (role='response')
INSERT INTO spring_symbols (kind, codegraph_node_id, name, qualified_name, file_path, start_line, end_line, metadata, confidence, created_at)
VALUES (
  'dto',
  'dto-user',
  'UserDto',
  'UserDto',
  NULL,
  NULL,
  NULL,
  '{"fromFeignMethodId":"method-create","role":"response","typeName":"UserDto"}',
  0.9,
  1740000000000
);

-- ----------------------------------------------------------
-- Primitive types are NOT emitted (isPrimitiveLike filters them out)
-- ----------------------------------------------------------
-- Examples of types that would be suppressed:
--   void, boolean, byte, short, int, long, float, double, char,
--   String, Integer, Long, Double, Float, Short, Byte, Character,
--   List<String>, Set<Integer>, Map<String,String>  (all generic args are primitive)
--
-- A Feign method returning 'String' or 'List<UserDto>' (non-primitive inner)
-- would still be emitted because UserDto is not primitive.

-- ----------------------------------------------------------
-- spring_edges — USES_DTO
-- ----------------------------------------------------------
-- One USES_DTO edge per dto node, sourceId = feign method id, kind='USES_DTO'
-- id = sha256(sourceId | dto.id | role | "USES_DTO").slice(0,32)
INSERT INTO spring_edges (source_id, target_id, kind, metadata, confidence, created_at)
VALUES
  -- request DTO edge
  ('method-create', '<dto:hash-of-createUserRequest>', 'USES_DTO', '{"role":"request"}', 0.9, 1740000000000),
  -- response DTO edge
  ('method-create', '<dto:hash-of-userDto>',           'USES_DTO', '{"role":"response"}', 0.9, 1740000000000);

-- ----------------------------------------------------------
-- Summary of verifiable fixture outcomes
-- ----------------------------------------------------------
-- Request DTO sourced from:
--   the single parameter with @RequestBody decorator
--   that has a non-null metadata.typeNodeId
--   whose typeName is not primitive-like (isPrimitiveLike check)
--
-- Response DTO sourced from:
--   method.returnType + metadata.returnTypeNodeId
--   when typeName is not primitive-like
--
-- DTO nodes are named by typeName (e.g. 'CreateUserRequest', 'UserDto')
-- and carry codegraphNodeId of the underlying type node.
--
-- symbolsAdded == 2 (1 request + 1 response dto) in the single-method fixture
-- edgesAdded  == 2 (1 USES_DTO per dto)
-- byKind.dto  == 2
