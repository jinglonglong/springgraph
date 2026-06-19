-- ============================================================
-- T41 — FeignProviderBridge
-- Source: packages/springkg-semantic/__tests__/feign-provider-bridge.test.ts (2 tests passed)
-- ============================================================
-- NOTE: springkg.db is not yet provisioned by Team A. This is a
-- fixture-derived SQL sketch for the TARGETS_ENDPOINT edges the
-- bridge produces when Team A persistence lands.

-- spring_edges (kind = 'TARGETS_ENDPOINT') — same-monorepo exact (confidence 1.0)
-- Fixture:
--   feign_method id=feign-method-1, metadata.feignPath='/users/{id}', httpMethod=GET, targetServiceName='user-svc'
--   endpoint    id=endpoint-1,    name='GET /users/{id}',          httpMethod=GET, serviceHint='user-svc'
INSERT INTO spring_edges (source_id, target_id, kind, metadata, confidence)
VALUES
  (
    'feign-method-1', 'endpoint-1', 'TARGETS_ENDPOINT',
    json_object('matchRule','same-monorepo-exact'),
    1.0
  );

-- spring_edges (kind = 'TARGETS_ENDPOINT') — cross-service name (confidence 0.5)
-- Fixture:
--   feign_method id=feign-method-2, metadata.feignPath='/orders', httpMethod=POST, targetServiceName='order-svc'
--   endpoint    id=endpoint-2,     name='GET /orders',              httpMethod=GET, serviceHint='inventory-svc'
--   (POST vs GET mismatch prevents same-monorepo-exact; path-only match -> cross-service-name)
INSERT INTO spring_edges (source_id, target_id, kind, metadata, confidence)
VALUES
  (
    'feign-method-2', 'endpoint-2', 'TARGETS_ENDPOINT',
    json_object('matchRule','cross-service-name','targetServiceName','order-svc'),
    0.5
  );

-- Expected behavior:
--   same-monorepo-exact -> 1 edge, confidence 1.0
--   cross-service-name -> 1 edge, confidence 0.5, includes targetServiceName
--   bridge emits ZERO spring_symbols rows (symbolsAdded == 0)