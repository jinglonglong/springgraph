# Team G Learnings

## Task T3 — Spring/MyBatis Framework Resolvers Documentation

### Key findings

**File organization is not what documentation implies.** The `spring.ts` and `mybatis.ts` framework files do not exist. Spring support lives entirely in `src/resolution/frameworks/java.ts`. MyBatis support is in `src/extraction/mybatis-extractor.ts` (an extractor, not a framework resolver).

**The mybatis synthesizer is referenced but not implemented.** The comments in `mybatis-extractor.ts` (line 17) reference `src/resolution/frameworks/mybatis.ts` as the synthesizer that would link Java mapper interface methods to their XML statement counterparts. This file does not exist. The `qualifiedName` mismatch between the Java interface (`com.example.UserMapper.findAll`) and the XML statement (`com.example.UserMapper::findAll`) means flows through MyBatis mappers break at the interface.

**Spring route extraction uses regex on comment-stripped source, not tree-sitter.** The `springResolver.extract()` function works by matching regex patterns against the raw file content after `stripCommentsForRegex` is applied. It does not use the AST.

**Spring `@Configuration` + `@Bean` extraction is a real gap.** Bean definitions produced by `@Bean` methods are not synthesized as injectable symbols.

**Spring `@FeignClient` has no support at all.** Flows through declarative HTTP client interfaces will not show the actual HTTP call resolution.

### What was documented

- §3 of `docs/codegraph-source-analysis.md` covers the Spring framework resolver in full detail, including all supported annotations, detection logic, routing extraction, and config binding.
- All three missing annotation categories (`@FeignClient`, `@Mapper` interface binding, `@Configuration` + `@Bean`) are explicitly documented as not currently extracted.
- The MyBatis XML extraction methodology is documented with the statement regex, node shape, qualified name scheme, and the current limitation around the missing synthesizer.
- A summary table maps each framework feature to its implementation location and support status.
