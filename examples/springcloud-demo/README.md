# SpringCloud Demo

A Spring Boot demonstration project for validating SpringKg MCP tools. The demo exercises the full Spring Cloud stack: REST controllers, service layers, MyBatis data access, OpenFeign client-to-client calls, and Nacos service discovery.

## Project Structure

```
src/main/java/com/example/
  DemoApplication.java          -- @SpringBootApplication entry point
  user/
    UserController.java         -- @RestController with @GetMapping /api/users, @PostMapping /api/users
    UserService.java           -- @Service with @Transactional findAll(), create()
    UserMapper.java            -- @Mapper with @Select annotation SQL
    UserEntity.java            -- JPA entity with id, name, email
    dto/
      UserCreateRequest.java   -- record for POST body
      UserDTO.java            -- response DTO
  order/
    OrderController.java        -- @RestController @RequestMapping /api/orders, @GetMapping /summary, @Scheduled cleanup
    OrderService.java          -- @Service with @Transactional getOrderSummary(), cleanupExpired()
    OrderMapper.java           -- @Mapper with @Select annotation SQL
    OrderDTO.java             -- Feign response DTO
    OrderClient.java          -- @FeignClient(name="order-service")
  config/
    UserCacheJob.java          -- @Scheduled cache cleanup job
src/main/resources/
  application.yml             -- spring.application.name, datasource, redis, nacos discovery/config
  bootstrap.yml                -- bootstrap with nacos
  mapper/
    UserMapper.xml             -- <select id="findAll">, <insert id="insertUser">, <update id="updateUser">
    OrderMapper.xml            -- <delete id="deleteExpired">
```

## MCP Tool Coverage Matrix

| Tool | Demo Trigger | Expected Result |
|------|-------------|----------------|
| `spring_find_entry` | `UserController.list()` | Returns `GET /api/users` endpoint with `UserController` handler |
| `spring_find_entry` | `OrderController.summary()` | Returns `GET /api/orders/summary` endpoint with `OrderController` handler |
| `spring_find_feign` | `OrderClient.summary()` | Returns Feign client `order-service` targeting `/api/orders/summary` |
| `spring_assets_overview` | All annotated classes | Returns inventory of 2 controllers, 2 services, 2 mappers, 1 Feign client |
| `spring_trace_flow` | `GET /api/users` depth 5 | Traces `UserController.list()` -> `UserService.findAll()` -> `UserMapper.findAll()` -> SQL |
| `spring_trace_flow` | `GET /api/orders/summary` depth 5 | Traces `OrderController.summary()` -> `OrderService.getOrderSummary()` -> `OrderMapper.countByUser()` -> SQL |
| `spring_find_mapper` | `UserMapper.findAll()` | Returns `com.example.user.UserMapper` with XML SQL `findAll` |
| `spring_find_mapper` | `OrderMapper.countByUser()` | Returns `com.example.order.OrderMapper` with annotation SQL `countByUser` |
| `spring_find_config` | `spring.application.name` | Returns `springcloud-demo` from `application.yml:2` |
| `spring_find_config` | `spring.datasource.password` | Returns masked value from `application.yml:3` (sensitive) |
| `spring_nacos_overview` | `application.yml` | Returns Nacos discovery addr `127.0.0.1:8848`, config addr, namespace |
| `spring_gateway_route` | `application.yml` | Returns gateway route definitions if configured |
| `spring_search_feature` | `order` | Returns `order-management` community with `OrderController`, `OrderService`, `OrderMapper` |
| `spring_method_impact` | `UserService.create()` | Returns methods that call `create()` including the mapper insert |
| `spring_field_impact` | `UserEntity.name` | Returns fields that reference `name` in mapper XML and service layer |

## V1 Acceptance Criteria Mapping

| Criterion | Demo Coverage | Demo File / Location |
|-----------|-------------|----------------------|
| V1 §1: Endpoint traces reach MyBatis SQL layer | `spring_trace_flow` traces `GET /api/users` through `UserService` to `UserMapper.findAll()` SQL | `UserController.java:13` -> `UserService.java:11` -> `UserMapper.xml:2` |
| V1 §2: FeignClient resolves to provider endpoint | `spring_find_feign` resolves `OrderClient` to `order-service` with `/api/orders/summary` | `OrderClient.java:7-10` -> `OrderController.java:15` |
| V1 §3: MapStruct / entity field impact analysis | `spring_method_impact` traces `UserService.create()` to mapper insert | `UserService.java:12` -> `UserMapper.java:16` |
| V1 §4: MQ producer and consumer resolution | No MQ artifacts in demo | N/A |
| V1 §5: @Scheduled task entry point extraction | `spring_assets_overview` surfaces `OrderController.cleanup()` with `@Scheduled` | `OrderController.java:20-21` |
| V1 §7: ConfigProperty usage reverse lookup | `spring_find_config` finds `spring.application.name` and `spring.datasource.*` | `application.yml:2-3` |
| V1 §8: Feature community search for order management | `spring_search_feature` with query `order` returns `order-management` community | `OrderController.java`, `OrderService.java`, `OrderMapper.java` |
| V1 §9: Method impact returns 4+ analysis sections | `spring_method_impact` on `UserMapper.findAll()` returns mapper -> service -> controller -> endpoint sections | `UserMapper.xml:2` -> `UserService.java:11` -> `UserController.java:13` |
| V1 §10: Field impact returns 2+ analysis sections | `spring_field_impact` on `UserEntity.email` returns entity -> mapper select -> service usage | `UserEntity.java` -> `UserMapper.xml:2` |

## Running the Demo

```bash
# Initialize and index
springkg init --project-path examples/springcloud-demo
springkg index --project-path examples/springcloud-demo

# List endpoints
springkg query --kind endpoint

# Find Feign clients
springkg query --kind feign_client

# Trace a flow
springkg trace --url /api/users --depth 5
```

## Key Annotations Exercised

| Annotation | Location |
|------------|----------|
| `@SpringBootApplication` | `DemoApplication.java` |
| `@RestController` | `UserController.java`, `OrderController.java` |
| `@GetMapping`, `@PostMapping`, `@RequestMapping` | `UserController.java`, `OrderController.java` |
| `@Service` | `UserService.java`, `OrderService.java` |
| `@Transactional` | `UserService.java:12`, `OrderService.java:16` |
| `@Mapper` | `UserMapper.java`, `OrderMapper.java` |
| `@Select` (MyBatis annotation) | `UserMapper.java:11`, `OrderMapper.java:10` |
| `@FeignClient` | `OrderClient.java:7` |
| `@Scheduled` | `OrderController.java:20` |
