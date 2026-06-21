## ADDED Requirements

### Requirement: Direct field access and getter/setter impact
The Java field impact resolver SHALL emit `references` edges for both direct field access and accessor-mediated field usage, and every such edge MUST carry `fieldRef: true` so field-aware impact consumers can distinguish field relationships from ordinary symbol references while preserving the existing `EdgeKind` vocabulary.

#### Scenario: Direct field access emits field reference
- **WHEN** Java code reads from or writes to a field directly
- **THEN** the resolver MUST emit a `references` edge for that usage with `fieldRef: true`

#### Scenario: Getter or setter emits field reference
- **WHEN** Java code uses a getter or setter that resolves to a backing field
- **THEN** the resolver MUST emit a `references` edge tied to the backing field with `fieldRef: true`

### Requirement: Lombok-generated accessors do not materialize nodes
For Lombok annotations such as `@Data`, `@Getter`, and `@Setter`, the system MUST record accessor-related facts as `AnnotationFact` data only and MUST NOT auto-materialize synthetic `method` nodes for generated accessors, so the graph remains faithful to parsed source while still exposing enough metadata for field-impact reasoning.

#### Scenario: Lombok class records annotation facts
- **WHEN** a Java class is annotated with `@Data`, `@Getter`, or `@Setter`
- **THEN** the system MUST capture accessor-related Lombok information as `AnnotationFact` data

#### Scenario: Lombok accessors do not become method nodes
- **WHEN** the index is built for a Lombok-annotated class without explicit getter or setter source methods
- **THEN** the graph MUST NOT create synthetic `method` nodes for those generated accessors

### Requirement: MapStruct source/target field impact
MapStruct mappings declared with `@Mapping(source=..., target=...)` SHALL emit field-impact edges between the resolved source field and target field so cross-DTO and entity transformation paths remain visible to impact analysis even when the assignment is generated rather than written out in Java source.

#### Scenario: Explicit MapStruct mapping connects fields
- **WHEN** a mapper method declares `@Mapping(source="sourceName", target="targetName")`
- **THEN** the resolver MUST emit a field-impact edge from the resolved source field to the resolved target field

#### Scenario: Multiple MapStruct mappings are preserved separately
- **WHEN** a mapper method declares multiple `@Mapping` annotations for different field pairs
- **THEN** the resolver MUST emit distinct field-impact edges for each resolved source and target pair

### Requirement: MyBatis XML column impact
MyBatis XML column references MUST participate in Java field impact analysis by emitting field-impact edges to the matching Entity field whenever XML column usage can be linked through explicit annotation metadata or stable naming-based resolution.

#### Scenario: XML column links to annotated entity field
- **WHEN** a MyBatis XML column reference matches an Entity field through explicit mapping metadata
- **THEN** the resolver MUST emit a field-impact edge from the XML column reference to that Entity field

#### Scenario: XML column links through naming convention
- **WHEN** a MyBatis XML column reference matches an Entity field only through naming-based resolution
- **THEN** the resolver MUST emit a field-impact edge to that matched Entity field

### Requirement: @JsonProperty field linking
When a field is annotated with `@JsonProperty(value="x")`, the resolver SHALL link that field to the logical property name `x` so cross-DTO impact lookups can traverse serialized field names as well as source-level Java identifiers.

#### Scenario: Annotated field exposes logical property name
- **WHEN** a field carries `@JsonProperty(value="external_name")`
- **THEN** the resolver MUST link that field to the logical property name `external_name`

#### Scenario: Cross-DTO lookup uses logical property name
- **WHEN** an impact query targets a serialized property name declared through `@JsonProperty`
- **THEN** the system MUST be able to include the annotated field in the cross-DTO field impact results
