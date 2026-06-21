## ADDED Requirements

### Requirement: XML mapper and statement nodes
The MyBatis XML extractor SHALL treat mapper XML as first-class graph input: each `<mapper namespace="...">` document MUST produce a mapper file node associated with that namespace, and each `<select>`, `<insert>`, `<update>`, or `<delete>` element with an `id` attribute MUST produce a statement node so XML-defined data access behavior participates in trace and impact workflows.

#### Scenario: Mapper namespace is indexed
- **WHEN** the extractor reads a MyBatis XML file containing `<mapper namespace="com.example.UserMapper">`
- **THEN** it MUST produce a mapper file node representing that mapper namespace

#### Scenario: Statement element is indexed
- **WHEN** the extractor reads a MyBatis XML mapper containing a `<select>`, `<insert>`, `<update>`, or `<delete>` element with an `id`
- **THEN** it MUST produce a statement node for that XML statement

### Requirement: Java method <-> XML statement edges
Each Java Mapper method SHALL be linked to the corresponding XML statement by method name within the mapped namespace, and the resolver MUST create a navigable relationship between the Java method node and the XML statement node so architecture trace and impact can cross the Java and XML boundary without requiring manual file inspection.

#### Scenario: Mapper method links to select statement
- **WHEN** a Java Mapper interface method name matches an XML statement `id` within the same mapper namespace
- **THEN** the resolver MUST create a link between that Java method node and the XML statement node

#### Scenario: Mapper method without matching statement stays unlinked
- **WHEN** a Java Mapper interface method has no XML statement with the same name in the mapped namespace
- **THEN** the resolver MUST NOT create a false Java-to-XML statement link for that method

### Requirement: XML SQL -> table/column hints
The extractor MUST derive lightweight table and column reference hints from the SQL text inside each MyBatis XML statement and SHALL expose those references as metadata on the statement so impact and architecture views can surface likely database touchpoints without requiring a full SQL semantic engine.

#### Scenario: Table hint is extracted from SQL
- **WHEN** an XML statement contains SQL that references a table such as `from user_account`
- **THEN** the statement metadata MUST expose `user_account` as a table hint

#### Scenario: Column hints are extracted from SQL
- **WHEN** an XML statement contains SQL that references columns such as `id`, `user_name`, or `status`
- **THEN** the statement metadata MUST expose those referenced columns as lightweight column hints

### Requirement: Entity field <-> XML column linking
Entity fields SHALL be linked to MyBatis XML column usage through `@TableField` metadata when present and through naming-based matching when explicit mapping metadata is absent, and the resolver MUST create those links only when the best available field-to-column match can be determined from indexed entity and mapper information.

#### Scenario: @TableField drives explicit column match
- **WHEN** an entity field declares `@TableField("user_name")` and an XML statement references the column `user_name`
- **THEN** the resolver MUST link that entity field to the XML column reference

#### Scenario: Naming convention drives fallback column match
- **WHEN** an entity field has no `@TableField` annotation and its normalized name matches an XML column reference by naming convention
- **THEN** the resolver MUST create a naming-based link between that entity field and the XML column reference
