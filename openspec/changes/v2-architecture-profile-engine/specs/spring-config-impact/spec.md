## ADDED Requirements

### Requirement: @Value config binding
The Spring configuration impact resolver SHALL parse `@Value("${key}")` bindings and MUST emit a config-edge from the annotated field to the matching key found in indexed `application.yml`, `application.yaml`, or `application.properties` files so configuration-driven behavior becomes visible in graph-based impact results.

#### Scenario: @Value matches YAML key
- **WHEN** a field is annotated with `@Value("${service.timeout}")` and `application.yml` declares `service.timeout`
- **THEN** the resolver MUST emit a config-edge linking that field to the `service.timeout` config key

#### Scenario: @Value matches properties key
- **WHEN** a field is annotated with `@Value("${service.timeout}")` and `application.properties` declares `service.timeout`
- **THEN** the resolver MUST emit a config-edge linking that field to the `service.timeout` config key

### Requirement: @ConfigurationProperties config binding
For classes annotated with `@ConfigurationProperties(prefix="...")`, the resolver MUST emit config-edges from each declared field to the corresponding `prefix.field` property key derived from the bound prefix and field name so impact analysis can traverse between bound configuration models and application config files.

#### Scenario: Simple field binds under prefix
- **WHEN** a class declares `@ConfigurationProperties(prefix="demo.client")` and contains a field named `timeout`
- **THEN** the resolver MUST emit a config-edge from that field to the `demo.client.timeout` key

#### Scenario: Multiple declared fields each bind separately
- **WHEN** a `@ConfigurationProperties` class declares multiple fields under the same prefix
- **THEN** the resolver MUST emit a distinct config-edge for each declared field to its corresponding `prefix.field` key

### Requirement: Out of scope for v1
Version 1 of Spring configuration impact SHALL be limited to application-local configuration files and standard `@Value` and `@ConfigurationProperties` binding, and it MUST NOT implement Spring Cloud Config, Nacos, Apollo, Consul, external `@PropertySource`, or multi-profile config merge behavior in this version so unsupported sources are explicitly excluded rather than implied.

#### Scenario: External config source is excluded
- **WHEN** configuration values originate from Spring Cloud Config, Nacos, Apollo, Consul, or an external `@PropertySource`
- **THEN** v1 MUST NOT attempt to resolve those values as supported config-edge sources

#### Scenario: Multi-profile merge is excluded
- **WHEN** effective configuration depends on merging multiple active Spring profiles
- **THEN** v1 MUST NOT implement multi-profile config merge semantics and MUST treat that behavior as out of scope

### Requirement: Unknown key gracefully reported
When an `@Value("${unknown}")` binding does not resolve to any indexed application configuration key, the impact response MUST surface the missing key as a warning and MUST NOT throw, fail indexing, or return that unresolved binding as a hard error.

#### Scenario: Missing key becomes warning
- **WHEN** a field is annotated with `@Value("${unknown.key}")` and no indexed application config file defines `unknown.key`
- **THEN** the impact response MUST report `unknown.key` as a warning

#### Scenario: Missing key does not abort processing
- **WHEN** one unresolved `@Value` key is encountered during indexing or impact analysis
- **THEN** the system MUST continue processing remaining bindings without throwing for the missing key
