-- ============================================================
-- T42 — FeignRequestResponseType (Feign DTO binding)
-- Source: packages/springkg-semantic/__tests__/feign-dto.test.ts (1 test passed)
-- ============================================================
-- NOTE: springkg.db is not yet provisioned by Team A. This is a
-- fixture-derived SQL sketch for the dto rows + USES_DTO edges the
-- resolver produces when Team A persistence lands.

-- Fixture:
--   interface UserClient (@FeignClient(name="user-service"))
--   method    create  @PostMapping("/users")  returnType='UserDto'  metadata.returnTypeNodeId='dto-user'
--   parameter req     @RequestBody              metadata.typeName='CreateUserRequest' metadata.typeNodeId='dto-create-user-request'

-- spring_symbols (kind = 'dto'): request DTO
INSERT INTO spring_symbols (kind, codegraph_node_id, name, qualified_name, metadata, confidence)
VALUES
  (
    'dto', 'dto-create-user-request', 'CreateUserRequest', 'CreateUserRequest',
    json_object('fromFeignMethodId','method-create','role','request','typeName','CreateUserRequest'),
    0.9
  );

-- spring_symbols (kind = 'dto'): response DTO
INSERT INTO spring_symbols (kind, codegraph_node_id, name, qualified_name, metadata, confidence)
VALUES
  (
    'dto', 'dto-user', 'UserDto', 'UserDto',
    json_object('fromFeignMethodId','method-create','role','response','typeName','UserDto'),
    0.9
  );

-- spring_edges (kind = 'USES_DTO'): feign method -> dto
INSERT INTO spring_edges (source_id, target_id, kind, metadata, confidence)
VALUES
  ('method-create', '<sha-dto-CreateUserRequest>', 'USES_DTO', json_object('role','request'),  0.9),
  ('method-create', '<sha-dto-UserDto>',           'USES_DTO', json_object('role','response'), 0.9);

-- Expected behavior:
--   symbolsAdded == 2 (1 request + 1 response dto)
--   edgesAdded   == 2 (1 USES_DTO per dto)
--   byKind.dto   == 2
-- Primitive types (void, int, String, List<String>, etc.) are skipped via isPrimitiveLike filter.