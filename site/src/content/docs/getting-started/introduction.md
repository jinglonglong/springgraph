---
title: 介绍
description: 什么是 Springgraph，以及为什么它能让 AI Agent 在 Spring Cloud 项目上更快、更省。
---

Springgraph 是一个**本地优先的代码智能分析工具**。它使用 [tree-sitter](https://tree-sitter.github.io/) 解析您的代码库，将每个符号、调用关系和文件存储在本地的 SQLite 数据库中，并将结果作为可查询的**语义知识图谱**进行暴露——支持通过 [Model Context Protocol (MCP) 服务器](/springgraph/reference/mcp-server/)、CLI 命令行以及 TypeScript 库来访问。

本项目的核心使命是让 AI Agent（如 Claude Code、Cursor、opencode 等）**无需读取和扫描大量文件即可回答架构级和调用链问题**。Agent 不必为了理清代码调用关系而漫长地进行 `grep`、`glob` 和 `Read` 操作，只需查询预先构建的索引，并在少数几次调用中获得完整、精确的答案。

## 为什么它对 Spring Cloud 尤为重要

当 Agent 在微服务或复杂的 Spring Boot 项目中工作时，大部分的上下文窗口和时间都花在“寻找正确的类和调用源”上。Springgraph 针对 Spring 生态定制了专属的语义解析和依赖合成引擎：

- **35% 成本削减**
- **57% Token 消耗降低**
- **46% 分析速度提升**
- **71% 问答调用次数减少**
- **100% 还原的 MyBatis SQL 链路与 Feign 远程调用关系**

在大型微服务项目中，AI Agent 可以直接从索引中回答所有流量路径和架构依赖问题，实现**零文件读取 (Zero File Reads)**。

## 图谱中包含什么

- **基础符号** — 函数、类、方法、接口、组件等（支持 20+ 语言）。
- **Spring 专属语义** — 自动识别并关联 `@RestController`、`@Service`、`@Mapper`、`@FeignClient` 等 Spring Bean。
- **多维度关联边** — 方法调用、文件导入、接口实现、继承关系，以及专为 Spring 自动装配（Autowired/Resource/构造注入）和 MyBatis XML 映射器合成的动态解析与派发边。
- **配置属性绑定** — 解析 `application.yml` / `application.properties` 与 Java 代码中 `@Value` / `@ConfigurationProperties` 的绑定关系。

代码信息的提取是**完全确定性**的——源于 AST（抽象语法树）的静态解析，而非依靠不稳定的生成式大模型（LLM）来归纳总结。

## 100% 本地运行

没有任何代码或数据会离开您的机器。不需要 API 密钥，也不需要外部云服务——数据仅保存在项目根目录的 `.springgraph/` 隐藏文件夹下，保证企业代码资产的绝对隐私。

准备好尝试了吗？请前往 [快速开始](/springgraph/getting-started/quickstart/)。
