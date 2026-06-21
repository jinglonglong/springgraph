## ADDED Requirements

### Requirement: Interface -> implementation synthesis
The resolver SHALL synthesize `overrides` edges from an interface method definition to each matching implementation method definition when Java interface dispatch can be established, and each synthesized edge MUST carry `metadata.synthesizedBy` with the stable value `java-interface-impl-dispatch` so downstream trace and impact consumers can distinguish inferred dispatch from directly parsed relationships.

#### Scenario: Single implementation method is matched
- **WHEN** an interface method has exactly one implementation method with a compatible signature in the indexed project
- **THEN** the resolver MUST emit an `overrides` edge from the interface method node to the implementation method node with `metadata.synthesizedBy` set to `java-interface-impl-dispatch`

#### Scenario: Multiple implementation classes exist
- **WHEN** an interface method is implemented by more than one indexed class
- **THEN** the resolver MUST emit an `overrides` edge to each matching implementation method and preserve the `java-interface-impl-dispatch` synthesizer marker on every emitted edge

### Requirement: Overloaded and generic methods
Generic interfaces and overloaded interface methods MUST be resolved by method name plus arity rather than by simple name alone, and the synthesized dispatch result SHALL report a confidence value for each candidate match so callers can distinguish strong matches from weak or partial matches.

#### Scenario: Overload is disambiguated by arity
- **WHEN** an interface declares overloaded methods with the same name but different parameter counts
- **THEN** the resolver MUST only link an implementation method whose name and arity match the interface method and MUST report confidence for that match

#### Scenario: Generic interface method is matched
- **WHEN** a generic interface method is implemented with compatible erased signature and matching arity
- **THEN** the resolver MUST synthesize the dispatch match by name plus arity and MUST include a confidence value on the result

### Requirement: Multi-implementation ambiguity
When more than one implementation method matches an interface method and no additional qualifier is available to narrow dispatch to a single implementation, the resolver MUST mark the dispatch result as `ambiguous`, and default trace behavior MUST skip traversing that ambiguous branch unless the caller explicitly opts into ambiguous dispatch exploration.

#### Scenario: Ambiguous match is reported
- **WHEN** two or more implementation methods satisfy the same interface method by name and arity without any stronger qualifier
- **THEN** the synthesized dispatch result MUST be flagged `ambiguous`

#### Scenario: Default trace skips ambiguous branch
- **WHEN** a default architecture trace encounters an interface dispatch result flagged `ambiguous`
- **THEN** the trace MUST skip traversing that dispatch branch by default rather than presenting one implementation as if it were definitive

### Requirement: Confidence scoring
Confidence scoring SHALL remain stable and machine-consumable for interface dispatch synthesis: a single-implementation match MUST have confidence greater than or equal to `0.9`, and a multi-implementation match MUST have confidence less than or equal to `0.5` and MUST also be flagged `ambiguous`.

#### Scenario: Single implementation receives high confidence
- **WHEN** exactly one implementation method matches an interface method by the resolver rules
- **THEN** the emitted dispatch result MUST report confidence greater than or equal to `0.9`

#### Scenario: Multiple implementations receive low confidence
- **WHEN** more than one implementation method matches the same interface method without a narrowing qualifier
- **THEN** each emitted dispatch result MUST report confidence less than or equal to `0.5` and MUST be flagged `ambiguous`
