-- ============================================================
-- T41 — FeignProviderBridge: TARGETS_ENDPOINT edges
-- ============================================================
-- Evidence derived from package-local verified fixtures:
--   packages/springkg-semantic/__tests__/feign-provider-bridge.test.ts
--   packages/springkg-semantic/src/feign-provider-bridge.ts
--
-- NOTE: No live springkg.db exists yet (Team A persistence not landed).
--       This is a fixture-grounded SQL-style snapshot for illustration.
-- ============================================================

-- FeignProviderBridge emits ZERO spring_symbols rows — it only produces edges.
-- symbolsAdded is always 0; edgesAdded reflects TARGETS_ENDPOINT count.

-- ----------------------------------------------------------
-- spring_edges — TARGETS_ENDPOINT
-- Columns: id, source_id, target_id, kind, metadata (JSON),
--          confidence, created_at
-- ----------------------------------------------------------

-- Rule 1: same-monorepo-exact
--   Conditions: same normalized path AND same httpMethod
--               AND endpoint.serviceHint == feignMethod.targetServiceName (or 'same-monorepo')
--   confidence: 1.0
--   metadata.matchRule: 'same-monorepo-exact'
--
-- Input fixtures:
--   feign_method: id=feign-method-1, metadata.feignPath='/users/{id}',
--                 metadata.httpMethod='GET', metadata.targetServiceName='user-svc'
--   endpoint:     id=endpoint-1,     name='GET /users/{id}',
--                 metadata.httpMethod='GET', metadata.serviceHint='user-svc'
INSERT INTO spring_edges (source_id, target_id, kind, metadata, confidence, created_at)
VALUES (
  'feign-method-1',
  'endpoint-1',
  'TARGETS_ENDPOINT',
  '{"matchRule":"same-monorepo-exact"}',
  1.0,
  1740000000000
);

-- Rule 2: cross-service-name (fallback when same-monorepo-exact does not apply)
--   Conditions: same normalized path (httpMethod and serviceHint may differ)
--   confidence: 0.5
--   metadata.matchRule: 'cross-service-name'
--   metadata.targetServiceName: feignMethod.targetServiceName
--
-- Input fixtures:
--   feign_method: id=feign-method-2, metadata.feignPath='/orders',
--                 metadata.httpMethod='POST', metadata.targetServiceName='order-svc'
--   endpoint:     id=endpoint-2,     name='GET /orders',
--                 metadata.httpMethod='GET', metadata.serviceHint='inventory-svc'
--   Note: POST vs GET httpMethod mismatch prevents same-monorepo-exact
--         but path '/orders' matches -> cross-service-name at 0.5
INSERT INTO spring_edges (source_id, target_id, kind, metadata, confidence, created_at)
VALUES (
  'feign-method-2',
  'endpoint-2',
  'TARGETS_ENDPOINT',
  '{"matchRule":"cross-service-name","targetServiceName":"order-svc"}',
  0.5,
  1740000000000
);

-- ----------------------------------------------------------
-- Same-monorepo-exact: serviceHint='same-monorepo' also satisfies the rule
-- ----------------------------------------------------------
-- Input: feign_method.targetServiceName='user-svc', endpoint.serviceHint='same-monorepo'
--   path=/users/{id}, httpMethod=GET on both -> same-monorepo-exact at 1.0
INSERT INTO spring_edges (source_id, target_id, kind, metadata, confidence, created_at)
VALUES (
  'feign-method-1',
  'endpoint-samemono',
  'TARGETS_ENDPOINT',
  '{"matchRule":"same-monorepo-exact"}',
  1.0,
  1740000000000
);

-- ----------------------------------------------------------
-- Summary of verifiable fixture outcomes
-- ----------------------------------------------------------
-- same-monorepo-exact match (confidence 1.0):
--   feignMethod.normalizedPath == endpoint.normalizedPath
--   feignMethod.httpMethod == endpoint.httpMethod
--   endpoint.serviceHint == feignMethod.targetServiceName (or 'same-monorepo')
--
-- cross-service-name fallback (confidence 0.5):
--   triggered when same-monorepo-exact conditions are not all met
--   only requires normalizedPath match between feign method and endpoint
--
-- symbolsAdded == 0 in all cases (no spring_symbols rows emitted)
-- edgesAdded == count of TARGETS_ENDPOINT edges produced
-- nodes == [] in all cases (no SpringKgNode output)
