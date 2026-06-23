# Spring Cloud 多层级模块与微服务边界识别设计方案

> 状态: 方案评审中 (Brainstorming Phase)
> 日期: 2026-06-23

## 1. 背景与问题描述

在大型 Spring Cloud 微服务项目中，Maven 多模块项目往往具有多级嵌套结构（例如 `parent -> common -> common-dto` 或 `parent -> services -> user-service`）。当前 `springgraph` 在解析此类项目时存在以下两个主要限制：

1. **多模块识别扁平且局限于顶层**：
   - 现有的 `mavenModuleFacet` 仅识别项目级是否为多模块（`isMultiModule`）并记录 `pomCount`，未真正构建模块树。
   - 文件与模块的映射关系不准确或缺失，只解析出顶级模块，无法准确建立多级子模块到文件的映射。
2. **无法区分“服务模块”与“通用依赖模块”**：
   - 目前缺少对“可独立部署运行的微服务（服务模块）”与“仅作为 jar 包被依赖的公共库（依赖/库模块）”的精确语义区分。
   - 对微服务的识别缺乏明确的充分条件判定（未结合 `spring-boot-maven-plugin`、`@SpringBootApplication` 和 `main` 方法进行判定）。

本项目标是引入基于数据库 Schema 级别的多模块树状建模，实现多级模块解析，并基于此提供清晰的微服务边界区分。

---

## 2. 方案选择：方案 B (基于 DB 关系表与外键映射)

选择 **方案 B**，在 SQLite 数据库中引入一等公民 `modules` 表，并与 `files` 建立外键关联。

**核心理由**：
1. **语义持久化与可查询性**：将模块结构落库，使 AI 能够通过 SQL 直接查询“某个类属于哪个微服务”、“这个服务依赖哪些库模块”等架构级问题，无需每次在内存中重建树。
2. **面向未来扩展**：随着微服务架构功能的演进（如网关路由、跨服务调用图），拥有关系型的 `modules` 实体是建立服务级依赖图的前提。
3. **性能友好**：在增量同步时，只需根据目录层级重新绑定受影响文件的 `module_id`，而无需频繁扫描或在内存中重算路径。

---

## 3. 详细设计

### 3.1 数据库 Schema 变更 (v8 迁移)

新增 `modules` 表记录模块层级和属性，并在 `files` 表中添加指向 `modules` 的外键 `module_id`。

```sql
-- migration: v8-modules.sql

CREATE TABLE modules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_root TEXT NOT NULL,
  path TEXT NOT NULL,              -- 相对项目根目录的相对路径，如 "services/user-service"
  name TEXT NOT NULL,              -- 模块名称 (artifactId)
  parent_path TEXT,                -- 父模块路径 (用于树形结构重建)，顶层为 NULL
  packaging TEXT NOT NULL,         -- 'jar' | 'pom' | 'war'
  is_service INTEGER DEFAULT 0,    -- 是否为服务模块 (1 = 是, 0 = 否)
  main_class_node_id INTEGER,      -- 关联的 SpringBootApplication 主类 Node ID
  port INTEGER,                    -- 服务的运行端口 (从 application.yml / bootstrap.yml 提取)
  pom_path TEXT NOT NULL,          -- pom.xml 的绝对路径
  UNIQUE(project_root, path)
);

CREATE INDEX idx_modules_parent ON modules(project_root, parent_path);
CREATE INDEX idx_modules_service ON modules(project_root, is_service);

-- 向 files 表追加 module_id 外键
ALTER TABLE files ADD COLUMN module_id INTEGER REFERENCES modules(id);
CREATE INDEX idx_files_module ON files(module_id);
```

### 3.2 模块树解析与服务模块判定

新引入 `mavenModuleTreeFacet` 替代/补充原有的扁平探测：

1. **多级模块拓扑构建**：
   - 从 `projectRoot` 开始，解析根 `pom.xml`。
   - 递归解析 `<modules>` 标签下的子模块，读取其 `pom.xml`，提取其 `artifactId`、`packaging` 及与父模块的相对路径关系。
   - 构建出完整的内存 `ModuleTree`（每个节点包含 `path`、`parentPath`、`artifactId`）。
2. **服务模块判定（充分条件 A）**：
   当且仅当一个模块满足以下所有条件时，判定其为 **服务模块 (is_service = 1)**：
   - 该模块的 `pom.xml` 中包含 `spring-boot-maven-plugin` 插件；
   - 该模块的 Java 源码中包含带 `@SpringBootApplication` 注解的类；
   - 该类包含入口方法 `public static void main(String[] args)`。
3. **通用依赖模块判定 (is_service = 0)**：
   - 凡不满足上述充分条件且 `packaging` 不为 `pom` 的模块，一律判定为 **通用依赖模块 (Library Module)**。
   - 仅用于管理聚合的父模块判定为 `parent-pom`。
4. **端口与服务名提取 (Best-Effort)**：
   - 扫描模块内的 `src/main/resources/application.{yml,yaml,properties}` / `bootstrap.{yml,yaml,properties}`。
   - 提取 `server.port`（如果配置为占位符或未配置，则存为 `NULL`）和 `spring.application.name`。

### 3.3 文件到模块的映射规则

- 解析完 `modules` 结构并写入 DB 后，遍历项目中的所有文件路径。
- 每个文件按**最长前缀匹配**（或最近祖先目录）归属到对应的模块：
  - 示例：文件 `D:/code/my-project/services/user-service/src/main/java/App.java`
  - 匹配模块 `services/user-service`，其 `module_id` 被写入该 file 行。
- 库文件、配置类或未划分到任何子模块的文件，默认归属到其最近的父模块。

### 3.4 API 与向后兼容性设计

#### Node 架构 Facet 字段扩展
```ts
interface NodeArchitectureFacet {
  layer?: ArchitectureLayer;
  role?: ArchitectureRole;
  // 变更：module 值从单一 leaf 名字（如 "user-service"）变更为全路径（如 "services/user-service"）
  module?: string;                 
  // 新增：区分是微服务、公共库还是父 POM
  moduleType?: 'service' | 'library' | 'parent-pom'; 
}
```
*注：虽然 `module` 字段返回的字符串语义变更为全路径，但其物理类型仍为 `string`，这保证了 MCP 和 CLI 的输出接口在 JSON 级别没有破坏性破坏。*

#### 架构快照 (ArchitectureSnapshot) 扩展
```ts
interface ArchitectureSnapshot {
  // ... 保留原有字段
  // 新增：结构化的模块树，方便 WebUI 直接渲染多级嵌套目录
  moduleTree?: ModuleNode[];
  // 新增：独立部署的微服务列表，方便一键过滤
  serviceModules?: ModuleNode[];
}

interface ModuleNode {
  id: number;
  path: string;
  name: string;
  parentPath: string | null;
  packaging: string;
  isService: boolean;
  mainClassNodeId?: number;
  port?: number;
  children: ModuleNode[];
}
```

---

## 4. 增量更新与失效策略

当发生文件改动时，`facet-cache.ts` 的失效处理如下：

1. **`pom.xml` 修改**：
   - 重新执行 `mavenModuleTreeFacet` 解析，更新 `modules` 表。
   - 检查模块边界是否发生变化。如果有，更新涉及目录下所有文件的 `files.module_id` 并使对应的 `NodeArchitectureFacet` 缓存失效。
2. **服务主类修改 / 注解修改**：
   - 如果包含 `@SpringBootApplication` 的主类被修改、删除或重命名，使该模块的 `is_service` 状态和 `main_class_node_id` 失效，触发重新判定。
3. **普通文件修改 / 删加**：
   - 无需重构模块树，仅在文件入库时，根据其目录继承最近祖先的 `module_id`，不影响其他文件。

---

## 5. 测试计划

1. **`__tests__/module-recognition.test.ts`**：
   - **Case 1 (多级嵌套模块验证)**：设计一个 parent -> common -> common-dto & services -> user-service 嵌套三层的 Mock 项目，验证 `moduleTree` 构建深度正确。
   - **Case 2 (服务模块判定判定)**：提供一个包含 `spring-boot-maven-plugin` 和主类的模块，验证 `is_service = 1`；提供一个仅包含 DTO 的普通 jar 模块，验证 `is_service = 0`。
   - **Case 3 (多入口主类容错)**：在一个模块内放置两个 main 函数类，验证按特定优先级（例如 `@SpringBootApplication` 优先）只绑定一个主类到 `main_class_node_id`。
   - **Case 4 (端口与服务名提取)**：解析复杂的 `application.yml`，验证 `server.port` 的提取精度。
   - **Case 5 (增量更新测试)**：修改 `pom.xml` 的 `artifactId` 或添加新子模块后，触发 `sync`，验证 DB 中的 `modules` 树和 `files` 映射实时更新。
