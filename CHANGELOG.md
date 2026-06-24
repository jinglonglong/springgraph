# 更新日志

这里记录了 Springgraph 的所有重要变更。每个版本也会以 `vX.Y.Z` 标签发布为 [GitHub Release](https://github.com/jinglonglong/springgraph/releases)，这是大多数用户查看的地方。

Springgraph 基于 [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph) 二次开发，面向 Spring Cloud 微服务场景增加了语义知识图谱与架构剖面能力。本日志中 `[Unreleased]` 与 `[1.0.1]` 为 Springgraph 新增内容；`[1.0.0]` 为首次以 Springgraph 名义同步上游变更的基线，已标注。

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/spec/v2.0.0.html)。

## [Unreleased]


## [1.0.3] - 2026-06-24

### 修复

- `springgraph init`、`springgraph index` 和 `springgraph sync` 在 Node 22+ 上不再重复打印 `(node:…) ExperimentalWarning: SQLite is an experimental feature` 警告。
- 进度输出在 Windows 终端、cmd、PowerShell 以及不支持 Unicode 的环境（包括 OEM 代码页）中不再显示为乱码或方块；如果默认输出仍有渲染问题，可设置 `NO_COLOR=1` 或 `SPRINGGRAPH_ASCII=1` 强制使用纯 ASCII 进度条。
- 大型 Spring Cloud 项目并行解析引用时，进度渲染不再阻塞主线程，减少了界面假死和行重复的概率。

## [1.0.2] - 2026-06-24

### 新功能

- Spring Cloud 项目现在拥有真正的 Maven 模块树：每个模块都会从 `pom.xml` 解析出来，文件会被映射到所属模块，服务模块也会与库模块、父 POM 模块区分开。`springgraph_explore`、架构快照和 Web UI 都会展示模块路径与服务边界，只需一次调用就能回答“这个类属于哪个微服务”。
- `springgraph init` 和 `springgraph index` 在大型项目上的速度大幅提升。在一个包含 10,000 个文件的合成 Spring Cloud 测试项目中，索引阶段本身比之前快约 4 倍；在未改动的代码树上重新运行几乎是瞬时的——内容未变化的文件会被跳过，不再重复解析或写入。跳过路径使用快速非加密哈希（xxhash，回退到 SHA-1）作为第一层校验，再用第二层 SHA-256 校验排除极罕见的误报。
- `springgraph init` 和 `springgraph index` 新增了 8 个可调参数，方便你根据机器配置调优：`--threads`（解析工作线程数，默认根据 CPU 数量推导）、`--ram`（总内存预算 MB，用于设置 SQLite 缓存和每个工作线程默认内存）、`--batch-size`（每个数据库事务包含的文件数）、`--batch-flush-ms`（按时间触发刷盘的阈值）、`--size-limit`（单个文件大小上限 MB，替代之前的 1 MB 硬限制）、`--worker-ram`（每个工作线程的 RSS 预算）、`--use-git` / `--no-git`（强制启用或禁用 git-native 文件枚举），以及 `--progress-interval-ms`（进度回调节流间隔）。每个参数都有对应的环境变量（例如 `SPRINGGRAPH_THREADS`、`SPRINGGRAPH_NO_PARALLEL_INIT=1`），便于在 CI 和容器环境使用。
- 为支持新的跳过路径，底层数据库 schema 已升级到 v7。现有索引在首次运行时会自动迁移。同时提供了两个环境变量用于回退到旧行为：`SPRINGGRAPH_NO_PARALLEL_INIT=1` 回退到单线程解析，`SPRINGGRAPH_NO_BATCH_WRITES=1` 回退到逐文件数据库事务。两者默认均为关闭（新路径是默认）。

### 维护

- `.opencode/` 目录（OpenSpec 本地开发工具）已从仓库中彻底移除：加入 `.gitignore` 并通过 `git filter-branch` 从全部历史提交中清除。新克隆的仓库不再包含此目录。

## [1.0.1] - 2026-06-13

### 新功能

- 新增 `springgraph daemon` 命令（别名 `daemons`）——一个交互式后台守护进程管理器。它会显示当前运行的守护进程（你当前项目的守护进程会排在最前面并默认选中），你可以用方向键选择一个并按回车停止，或选择“全部停止”。在此之前，关闭守护进程的唯一方式是手动查找 pid 并 `kill`。(#845)
- 查询已安装版本现在更加顺手：除了已有的 `springgraph --version`，`springgraph version`、`springgraph -v` 和 `springgraph -version` 都可以打印版本号。(#864)
- Springgraph MCP 服务器现在能在主线程卡死时自愈。一个轻量级看门狗会在进程无响应时将其终止，以便下次请求时启动全新进程——它不会再一直占用 100% CPU 而无法恢复。可通过 `SPRINGGRAPH_WATCHDOG_TIMEOUT_MS` 调整检测窗口，或用 `SPRINGGRAPH_NO_WATCHDOG=1` 完全关闭。(#850)

### 修复

- 项目中嵌套的 Git worktree（例如 Claude Code 创建的 `.claude/worktrees/`）不再被当作整个代码库的重复副本索引。Springgraph 仍会索引真正的嵌入式仓库（在你的仓库内部单独 checkout 的第二个项目），但 worktree 只是同一个仓库的另一个工作视图，之前每个 worktree 都会让所有符号翻倍——有用户报告文件数从约 1,850 暴涨到 24,000 以上，搜索和 `explore` 被大量陈旧重复项淹没。Springgraph 现在会识别 worktree 并跳过，同时仍索引真正的嵌入式仓库和子模块。感谢 @tphakala。(#848)
- 手动运行 `springgraph serve --mcp` 时不再只是静默挂起。这个命令其实是 AI 代理为自己启动的 MCP 服务器，不是用户直接运行的步骤；以前在终端里它会坐在那里等待永远不会到来的输入，看起来很像是坏了。现在它会识别出是人工运行，并提示应该使用什么命令（`springgraph status`、`springgraph daemon`），同时该命令已从命令列表中移除，避免看起来像是需要手动启动的步骤。
- 跨文件的静态方法调用（如 `ClassName.staticMethod()`）现在能正确解析。Springgraph 过去会把这种调用链接到类本身（并记录为构造），导致静态方法的 `callers` 和 `impact` 返回空——这对重度使用静态工具类的 TypeScript 和 JavaScript 代码库是个真实的盲点（Python 等具有相同调用形态的语言也同样受益）。现在调用会链接到方法本身。感谢 @contextFlow-lab。(#825)
- `springgraph affected` 现在接受 `./` 前缀和绝对路径，不再只接受裸的项目相对路径。当文件列表来自其他工具时，传入 `./src/x.ts` 或绝对路径很常见，以前会静默匹配不到并报告没有受影响的测试。感谢 @contextFlow-lab。(#825)
- Springgraph MCP 服务器在发生意外的内部错误后，不再存在卡死在 100% CPU 的风险。以前这种错误只会被记录，进程会留在损坏状态并可能无限占用一个 CPU 核心，只能手动杀死；现在服务器会记录错误并干净退出，下次请求时会启动新的进程。感谢 @songhlc。(#850)
- Springgraph 不再意外索引整个主目录。在主目录或文件系统根目录运行安装程序，或运行 `springgraph init` / `springgraph index` 时，会索引其下所有内容（缓存、`Library`、其他所有项目），产生数 GB 的索引并带来持续的文件监听开销。Springgraph 现在会拒绝这些根目录，并引导你指定具体项目；如果确实需要，可传入 `--force`。结合 1.0.0 中已修复的 macOS 文件描述符问题，这解决了用户报告的失控 watcher 耗尽系统文件限制的问题。感谢 @ligson。(#845)
- Java 和 Kotlin 中覆盖体内的 `super.method()` 调用现在会解析到继承自父类的实现，而不是重新指向子类覆盖。这修复了覆盖体委托给父类时缺失或自引用的 callee 链接。现有的 Java 和 Kotlin 索引建议重新索引（`springgraph index -f`）以获得完整收益。
- Java 和 Kotlin 通过 `extends` 实现的类继承现在和 `implements` 一样参与多态派发：在基类方法上调用 `springgraph_callers` 和 `springgraph_callees` 会聚合子类覆盖中的调用点，反之亦然。这补上了继承方法覆盖在影响和追踪方面的缺口。现有的 Java 和 Kotlin 索引建议重新索引（`springgraph index -f`）以获得完整收益。
- 通过 tree-sitter 提取的装饰器（例如 `@Service`、`@Component`、`@Route`、`@RestController`）现在会存入节点索引的 `decorators` 列，因此可以在搜索、`/api/decorators` 端点以及 `/api/search?decorator=` 过滤器中看到。以前只有 Kotlin 的 `@ExperimentalStdlibApi` 风格注解会填充这一列，其他语言会被静默丢弃。
- 同步新增类或接口节点后，架构切面缓存会重新检测项目画像，使这些节点立即按角色、层级和模块分类——而不再等到下次完整重建索引。
- `springgraph index` 现在会从头重建完整图谱，结果与全新的 `springgraph init` 一致，而不再报告“0 节点、0 边”像是在清空索引。以前，在未有变动的项目上重新运行 `index` 会跳过每个文件（内容没变），显示一个看起来为空的摘要；现在每次都会清空并重新索引，给出诚实且完整的重建。两次完整重建之间可使用 `springgraph sync` 进行快速增量更新。感谢 @Arc-univer。(#874)
- 自动同步图谱的文件 watcher 在不再可信时会干净失败，而不是看起来正常、索引却悄悄变旧。当操作系统耗尽文件监听资源，或其他进程长时间持有写锁远超正常保存时，Springgraph 现在会一次性禁用自动同步，并给出清晰提示，告诉你运行 `springgraph sync`（或依赖 git 同步钩子）来刷新；在自动同步禁用期间，Springgraph 的工具响应（以及 `springgraph status`）会明确说明这一点，因此你的 AI 代理知道应该直接读取文件，而不是信任一个冻结的索引。这对长时间运行的 MCP/daemon 会话尤为重要，否则它们可能继续提供陈旧结果却看起来一切正常。感谢 @thismilktea。(#876)
- 在 Linux 上，大型项目触及内核 inotify 监听上限时，不再静默导致半棵树未被监听。Springgraph 现在会一次性告诉你具体需要提升的设置（`fs.inotify.max_user_watches`，例如 `sudo sysctl fs.inotify.max_user_watches=1048576`），并继续监听已成功注册的目录，其余部分由 `springgraph sync`（或 git 同步钩子）覆盖。(#876)

### 维护

- 以下本地开发产物现在被 git 忽略：`.claude/`、`.cursor/`、`.omo/`、`资料/`、`openspec/`、`.playwright-mcp/`，以及旧的 `.springgraph_bak/` 备份。它们会保留在开发者磁盘上，但不再进入仓库。

### 新功能

- Java 和 Kotlin 项目现在获得 Spring 感知的关系合成：`@Autowired` / `@Resource` 字段注入、显式构造器注入以及 Lombok `@RequiredArgsConstructor` 都会被建模为从消费 bean 指向被注入 bean 的 `references` 边。接口方法派发也会通过 `overrides` 边桥接到具体实现，重载方法会按参数个数消歧。MyBatis XML mapper 会链接到对应的 Java Mapper 方法，SQL 表/列提示会被提取，XML 中的列引用会按命名约定连接到实体字段。`application.yml` / `application.properties` 的键会被索引为 `constant` 节点，并连接到 `@Value` 和 `@ConfigurationProperties` 绑定。所有这些边都是增量添加的，带有 `provenance:'heuristic'`，并会展示在 `springgraph_explore`、`springgraph_node`、`springgraph_callers` 和 `springgraph_impact` 中。
- TypeScript、JavaScript、Go、Python、Rust、Ruby、C、Java、C#、PHP、Scala、Kotlin、Swift、Dart 和 Pascal/Delphi 的影响与爆炸半径分析现在能够理解常量的读取者。当你修改文件级、包级、模块级或类级常量（配置对象、查找表、共享常量）时，同文件中读取它的其他符号现在会显示为受影响，而以前它们是不可见的（影响分析只跟踪调用、导入和继承，所以常量的消费者看起来是“没有任何东西依赖它”）。这让 `springgraph impact` 以及 `springgraph_explore` / `springgraph_node` 中的影响轨迹能够捕捉到“修改这个表、破坏它的读取者”这一类变更。默认开启，不会增加节点；打包/压缩文件和存在歧义的遮蔽名会被跳过以保持结果精确。设置 `SPRINGGRAPH_VALUE_REFS=0` 可关闭。
- C 语言的文件级常量和全局变量——`static const` 标量、指针/数组查找表以及共享可变全局变量——现在会作为独立符号被识别。它们之前根本不会被提取，因此不会出现在搜索中，也没有依赖者；现在它们会出现在 `springgraph search` 中并参与上述影响分析，所以修改一个 C 查找表会展示同文件中读取它的函数。
- Java 的 `static final` 常量、C# 的 `const` / `static readonly` 常量、Scala 的 `object` val，以及 Kotlin 顶层 / `object` / `companion object` 中的 `val` 现在会被归类为常量而非普通字段，因此参与上述常量读取者影响分析——修改 `public static final` 表、`const string`、Scala `object Config { val Timeout = … }` 或 Kotlin `companion object { const val … }`，读取它的方法都会显示为受影响。（每个对象实例的 Java `final` / C# `readonly` / Scala 和 Kotlin 类实例属性保持不变。）Kotlin 常量以前根本不会作为独立符号被索引，所以它们现在也会出现在 `springgraph search` 中。
- Swift 顶层 `let` 和 `static let` 常量（包括命名空间在 `enum`/`struct` 中的常见 Swift 写法）现在会被索引为常量并参与上述常量读取者影响分析——修改 `static let defaultRetryLimit` 或 `enum Constants { static let … }`，同文件中读取它的代码会显示为受影响。计算属性和每个实例的 `let` 不被视为常量。
- Dart 顶层 `const`/`final` 和类级 `static const`/`static final` 常量现在会被索引为常量并参与上述常量读取者影响分析。实例字段、`var` 和局部变量不被视为常量。（标准后缀为 `.g.dart`/`.freezed.dart`/`.pb.dart` 的生成 Dart 代码本来就会被跳过。）

### 新功能（springkg）

- SpringKg：新增 Spring Cloud 语义知识图谱层，使用 `springkg.db` 中的 SQLite schema 存储 Spring 符号、端点、Feign 客户端和配置属性。
- SpringKg：新增 4 个 MCP 工具（`spring_find_entry`、`spring_find_feign`、`spring_assets_overview`、`spring_trace_flow`），用于查询 Spring Boot 资产并追踪 controller、service 和数据访问层之间的请求流。
- SpringKg：`spring_trace_flow` 接受 `url` 和 `depth` 参数，可沿 controller、service、mapper 和 SQL 层追踪 HTTP 端点。
- SpringKg：`spring_assets_overview` 返回已索引的 controller、service、中间件和敏感配置属性清单。
- SpringKg：新增 Spring 注解（`@RestController`、`@Service`、`@Mapper`）、REST 端点和 OpenFeign 客户端解析的语义解析器。

## [1.0.0] - 2026-06-12

> 以下条目从上游 colbymchenry/codegraph 同步并翻译，已统一使用 Springgraph 品牌与命令名。

### 安全

- 修复路径遍历漏洞：索引项目内的符号链接如果指向项目根目录之外，可能让 Springgraph 把项目外文件（例如主目录下的文件）的内容提供给 AI 代理。Springgraph 现在会在校验文件访问时解析符号链接，并拒绝真实位置在项目根目录之外的任何读取请求；仍允许指向项目内部的符号链接。感谢 @sulthonzh。(#527)
- Springgraph 现在仅按 key 索引 Spring 配置文件（`application.properties` / `application.yml`），永远不会在 `springgraph_explore` 或 `springgraph_node` 输出中暴露它们的 value。以前，提交到这些文件中的秘密（数据库密码、API key、嵌入了凭据的连接字符串）可能通过 AI 代理询问附近代码时被泄露，即使代理从未打开该文件。配置 key 仍会被索引，因此引用和影响分析不受影响；真正需要 value 的代理会自行读取文件。Shopify Liquid 的 `{% schema %}` 块同样只按名称索引。(#383)

### 新功能

- **Springgraph 现在支持索引 R 语言**（`.R` / `.r`）——包括各种赋值形式的函数（`name <- function(...)`、`name = function(...)`、嵌套定义）、S4 / Reference / R6 类及其方法、`setGeneric`/`setMethod` 泛型、顶层变量和常量、`library()` / `require()` 导入、`source()` 文件引用以及调用边——包括 tidyverse 管道链中的调用。统计和研究类代码库现在可以享受完整的 explore / impact / callers 能力。(#828)（R）
- **包含多个 git 仓库的工作空间现在会作为一个整体索引。** 在包含多个独立 git 仓库的目录根目录运行 `springgraph init`——包括常见的“super-repo”布局，即父仓库的 `.gitignore` 隐藏子仓库以保持 `git status` 干净——现在会把每个嵌套项目索引到同一个图谱中，并尊重每个子仓库自己的 `.gitignore`。`springgraph sync` 和实时文件监听也能捕获嵌套仓库内的变更（以前变更检测只询问父仓库，所以子仓库中的编辑在完整重建索引前不可见）。`node_modules` 内部的 git 仓库（npm git 依赖）仍被排除。(#514)
- **`springgraph_explore` 现在会在流断掉时说明断点，而不是静默结束。** 当你询问的符号之间没有静态连接时——因为代码通过运行时机制派发，例如计算调用（`handlers[action.type](...)`）、Python 的 `getattr`、命令/中介总线（`sender.Send(new DeleteCommand(...))`）、反射或 `new Proxy`——explore 现在会指出静态路径停止的确切派发点（文件和行号），并在派发 key 在源码中可见时列出可能的运行时目标（例如直接把 MediatR 命令指向其 `Handler.Handle` 方法）。检测是确定性的，只在流无法连接时运行；完全连接的流不受影响，索引或图谱本身也没有任何变化。相关地，通过单一合成跳连接的自定义事件总线现在会明确展示这一跳（附带注册点）——以前因为连接“太短”导致流段落不渲染而被隐藏。(#687)
- **匿名使用遥测，字段逐项记录且容易关闭。** Springgraph 现在收集少量匿名使用统计——哪些命令和 MCP 工具被使用、哪些语言被索引、哪些代理连接——以便语言和代理支持工作投向真实使用场景。绝不包含代码、文件路径、文件或符号名、搜索查询或 IP 地址；使用量会先在本地汇总为每日总量再发送，摄取端点是公开、可审计的仓库代码，并强制执行记录的字段列表。安装程序会在首次安装时以默认开启的可见开关询问（且不会重复询问）；其他地方在首次发送前会打印一行提示。随时可通过 `springgraph telemetry off`、`SPRINGGRAPH_TELEMETRY=0` 或跨工具标准 `DO_NOT_TRACK=1` 禁用——关闭即关闭：不记录、不发送，已缓冲数据会被删除。详见 `TELEMETRY.md`。
- **子代理和非 MCP 代理现在也能使用 Springgraph。** 两个新 CLI 命令——`springgraph explore "<symbols or question>"` 和 `springgraph node <symbol-or-file>`——会打印对应 MCP 工具返回的内容（相关符号的源码 + 调用路径；单个符号的源码 + 调用者；带行号的文件读取），因此任何有 shell 的代理都能使用图谱。`springgraph install` 现在还会向每个代理的说明文件（`CLAUDE.md` / `AGENTS.md` / `GEMINI.md`）写入一小段带标记的 Springgraph 说明，指向这两种使用方式——子代理实际看到的是这些说明文件，而 MCP 服务器自身的指导只能到达主代理。在一个委托式代码探索任务中实测：子代理从几乎从不使用 Springgraph（约 9 次运行中 1 次）变为每次运行都使用，包括零 grep/文件读取回退的运行。这段说明很小，会保留你自己的内容，能从旧长块平滑升级，`springgraph uninstall` 会移除它。感谢 @liuyao37511。(#704)
- **MCP 工具列表现在默认精简为四个**——`springgraph_explore`、`springgraph_node`、`springgraph_search` 和 `springgraph_callers`。其余四个（`springgraph_callees`、`springgraph_impact`、`springgraph_files`、`springgraph_status`）仍然完全可用——CLI 和库 API 未变，`SPRINGGRAPH_MCP_TOOLS` 可重新启用任意一个——但默认不再列出给代理：实测代理行为显示它们几乎不被选择，且它们携带的信息已经通过代理实际使用的工具内联展示（explore 的爆炸半径段落、node 的依赖提示、符号自身 body 作为其 callee 列表）。更精简的列表每次会话都能节省上下文 token，并通过“存在即引导”帮助代理选择正确工具。
- **Springgraph 在未索引项目中现在安静下线，而不是大声报错。** 当 AI 代理的会话在尚未建立 Springgraph 索引的工作空间启动时，MCP 服务器现在会以简短提示声明自己处于非活动状态，并完全不列出工具——而不是展示完整工具集然后在每次调用时报错，这会让代理即使在 Springgraph 可用的地方也失去信任。查询另一个未索引项目时同样返回清晰指引（对该代码库使用你的常规工具；用户可以在那里运行 `springgraph init` 来启用 Springgraph），而不是报错；真正的内部错误现在会告诉代理重试一次，而不是彻底放弃 Springgraph。是否索引仍由你决定——代理被告诫不要自行运行索引。(#769)
- **Astro 项目现在会被索引。** 之前 `.astro` 文件完全不会被解析——在典型 Astro 站点上，这让大部分代码库对搜索、影响和 `springgraph_explore` 不可见。Springgraph 现在会提取 TypeScript frontmatter（函数、导入、`getStaticPaths`、…）和客户端 `<script>` 块，捕获模板标记中的函数调用和 `<Component>` 使用，使跨组件依赖端到端可追溯，将 `Astro` 全局和 `astro:*` 模块导入解析为框架提供，并把 `src/pages/` 下的基于文件的路由映射为 route 节点（`.astro` 页面和 `.ts` 端点，包括 `[param]` 和 `[...rest]` 动态段，下划线前缀文件会被正确排除）。已在两个真实 Astro 站点上验证，跨文件覆盖率达到 93%，每个页面都映射到了其路由。感谢 @xingwangzhe。(#768)（Astro）
- 单仓库中跨应用的同名符号不再被合并。在类似 NestJS 的工作空间中，每个应用都有一个 `UserService`，`springgraph_callers`、`springgraph_callees` 和 `springgraph_impact` 现在会**为每个不同的定义单独报告一节**——每个应用的调用者和爆炸半径都列在各自带文件标签的小节下——而不是合并成一个列表；并且接受 `file` 参数来精确聚焦你想要的定义（和 `springgraph_node` 一样）。影响分析尤其不再因合并无关同名类而夸大变更的爆炸半径。感谢 @Igorgro。(#764)
- 修复了跨包错误边的另一个来源：纯 `.ts` 文件中的 PascalCase **类型引用曾被解析为 React 组件**，可能把文件自己的类型别名链接到另一个包中任意同名的类（在一个大型单仓库中产生了超过一千条错误跨包引用边；现在 96% 已消失，剩余的是真正的共享模型导入）。组件解析现在只应用于支持 JSX 的文件中的引用，且在没有位置信号时不会在多个候选间猜测。**Svelte 和 Vue 组件解析器也有同样的任意选择缺陷**（Vue 会解析树中第一个同名的 `.vue` 文件），现在遵循相同规则：优先同目录，否则只有名称无歧义时才解析。重新索引项目以获得收益。(#764)（TypeScript、React、Svelte、Vue）
- TypeScript 和 JavaScript 的**类字段现在被报告为属性而不是方法**。普通字段如 `public fonts: Fonts;` 以前会被提取为方法，扭曲了类结构，还让同名函数调用解析到数据字段（一个名为 `isArray` 的布尔字段会吸走 `Array.isArray(...)` 调用边）。持有箭头函数或函数表达式的字段（`onClick = () => {…}`，包括包装形式如 `onScroll = throttle(() => {…})`）正确地保持为方法，其函数体仍会被分析。字段初始化器也会被分析，因此 `history = createHistory()` 会记录其调用——而且 JavaScript 类字段以前完全不会产生符号，现在也会出现在图谱中。重新索引项目以获得收益。(#808)（TypeScript、JavaScript）
- TypeScript 和 JavaScript 中通过 `this` 的回调注册现在精确解析：`window.addEventListener("online", this.onOfflineStatusToggle)` 或类似 `{ mutateElement: this.mutateElement }` 的 API 对象会产生指向**所在类自身方法**的引用边——永远不会指向无关类的同名方法，也不会指向数据字段。基于下面的回调注册支持。(#808)（TypeScript、JavaScript）
- 回调注册覆盖加深到四种更多形态：通过 `this.<成员>` 注册的方法如果位于**基类**，现在会通过继承链解析（子类中的 `bus.on("submit", this.handleSubmit)` 会链接到父类的 `handleSubmit`）；Java 和 Kotlin **指向其他类的方法引用**（`Handlers::onMessage`、`OtherClass::handle`）现在跨文件解析，`this::` 和 `super::` 限定在定义类，通过变量的引用被故意排除；Swift 裸回调名现在只匹配**所在类型**的方法（隐式 `self`），消除了参数如 `request` 链接到无关类型同名方法的一类错误边。（Java、Kotlin、Swift、TypeScript、JavaScript）
- PHP **字符串和数组 callable** 现在会被注册：传给接受 callable 的核心函数的字符串（`usort($items, 'cmp_items')`、`array_map('absint', …)`、`call_user_func`、`spl_autoload_register`、…）会链接到该函数——包括跨文件；数组形式 `[$this, 'method']` 和 `[Foo::class, 'method']` 会链接到命名方法（`$this` 形式会通过类及其父类解析）。传给任意函数的字符串被故意忽略：只信任已知的 callable 位置。在 WordPress 核心上验证（+556 条边，每条采样边都是真正的注册）。（PHP）
- Ruby **生命周期钩子符号** 现在会被注册：`before_action :authenticate`、`after_save :reindex`、`around_create`、`validate :check`、`rescue_from(…, with: :handler)` 等会把符号链接到它命名的方法——无论是在类本身还是从父类继承而来（控制器中的 `before_action :authenticate` 会解析到 `ApplicationController` 的方法）。`validates`（复数）被排除，因为它的符号命名的是属性而不是方法。在 rails/rails 上验证（+385 条边，每条采样边都是真正的注册）。（Ruby）
- 指向**无需导入**类型的方法引用现在可以解析：Java/Kotlin 同包引用（`.concatMapMaybe(Maybe::just, …)`）、**Kotlin 伴生对象成员**（`KtHandlers::handle`），以及跨文件 C++ 成员指针（`&TestSuite::RunSetUpTestSuite`）。解析始终锚定到命名类型，因此不同类的同名成员永远不会匹配。（Java、Kotlin、C++）
- Springgraph 现在能看到函数**被注册为回调**的位置，而不仅仅是被调用的地方。函数名作为参数传递（`signal(SIGINT, handler)`、`qsort(…, compare)`、`addEventListener(…, onBlur)`）、赋值给函数指针或字段（`ops->recv_cb = my_cb`、`OnClick := Handler`），或放在结构体初始化器或处理表（`{ .recv_cb = my_cb }`、`{ "get", getCommand }`）中，现在会产生从注册点到该函数的引用边——因此 `springgraph_callers` 和 `springgraph_impact` 能展示以前看起来像死代码的回调 wiring。支持所有语言，包括语言特定形式：C/C++ 的 `&fn`、Java 的 `Class::method`、Kotlin 的 `::fn`、Swift 的 `#selector`、Objective-C 的 `@selector`、Ruby 的 `method(:fn)`、Scala eta 展开，以及 Delphi/Pascal 的 `@Handler` 和 `OnClick := Handler` 事件绑定。callers 输出会标注这些为“via callback registration”。解析有意保守：歧义名称不产生边，而不是产生错误边。重新索引项目以获得收益。感谢 @zmcrazy。(#756)
- `springgraph_node` MCP 工具现在可以**像内置 Read 工具一样读取整个源文件——而且更快，因为来自索引**。传入没有符号的文件路径，它会返回该文件的当前源码并带行号（和 Read 一样的 `<n>⇥<line>` 格式，助理可以直接据此编辑），可通过 `offset`/`limit` 精确限定窗口，并附上一行说明哪些文件依赖它（文件的爆炸半径）。在你会对索引源文件使用 Read 的任何地方都可以用它。传入 `symbolsOnly: true` 只返回文件结构。配置/数据文件（`.yml` / `.properties`）只按 key 摘要，永远不会完整转储，因此其中的秘密不会被泄露。面向代理的指导也经过了重新调整，让助理在*实施*变更时也会想到 Springgraph（不仅仅是回答问题时），因为一次 Springgraph 调用返回的字节数和爆炸半径比重新读取文件更快。
- 新增 `springgraph upgrade` 命令，可原地更新 Springgraph 到最新版本——它会检测你的安装方式（独立 `install.sh` / `install.ps1` 包、npm 或 npx），并在 macOS、Linux 和 Windows 上为每种方式执行正确的更新。使用 `springgraph upgrade --check` 可在不安装的情况下查看是否有更新，或使用 `springgraph upgrade <version>` 切换到指定版本。更新后会提醒你重新索引项目，以应用新版引擎的改进。(#679)
- `springgraph status` 现在会在项目索引由旧版引擎构建时给出标记，并建议重新索引（也在 `springgraph status --json` 中展示），因此你能知道何时运行 `springgraph index -f` 或 `springgraph sync` 会获得新版引入的覆盖能力。
- 跨文件影响和爆炸半径覆盖现在覆盖**22 种语言和 14 种 Web 框架**，每种都在真实仓库上验证——详见 README 中的覆盖表。本版本交付了背后的跨文件解析能力，包括 Lua 和 Luau 的 `require`、Shopify OS 2.0 Liquid section templates、Delphi form code-behind、Rust 跨模块调用和 Rocket route macros、Swift Fluent 关系，以及 SvelteKit / Nuxt / Vapor / Axum 路由约定。剩余的缺口都是真正的静态分析边界（运行时派发、反射/DI、框架约定入口点），而非被隐藏的问题。
- C# 的 `record struct` 和 `readonly record struct` 声明现在会以正确的 `struct` 类型被索引，位置记录的一行记录（`public record struct Money(decimal Amount);`）在所有形式下都能可靠索引——以前无 body 的值类型记录可能被完全跳过，并可能中止同文件中后续声明的提取。(#831)（C#）
- C# 类型现在按命名空间限定名跟踪。不同命名空间中的同名类型——例如一个领域实体和一个都叫 `CatalogBrand` 的 DTO——现在会被区分开，而不是折叠成任意匹配，因此引用能解析到正确的一个，影响分析也不会再把它们混为一谈。（C#）
- ASP.NET Razor（`.cshtml`）和 Blazor（`.razor`）标记现在会被解析以发现代码关系。`@model` / `@inherits` / `@inject` 指令会把视图链接到它命名的 C# view-model、基类型或服务；Blazor 的 `<MyComponent/>` 标签（加上 `@typeof(...)` 和泛型 `TItem="..."` 参数）会链接到组件类；`@code { }` / `@functions { }` / `@{ }` 块内的 C# 也会被分析，因此组件逻辑中使用的服务和类型也会被链接。只在标记中引用的 view-model、组件或服务不再被报告为没有依赖者，编辑它时也会展示使用它的视图。(ASP.NET、Blazor)
- Razor/Blazor 类型引用现在会通过组件的 `@using` 命名空间解析——包括文件夹级级联的 `_Imports.razor`——因此存在于多个命名空间中的简单名称会落在正确的一个上。`@model` / `<MyComponent>` / `@code` 对 `CatalogBrand` 的引用会解析到被 `@using` 的 DTO（`BlazorShared.Models.CatalogBrand`），而不是同名的领域实体。(ASP.NET、Blazor)
- `springgraph status --json` 现在还会报告当前 CLI `version`、索引目录（`indexPath`）和 `lastIndexed` 时间戳（ISO-8601，尚未索引时为 null），因此 CI 和脚本可以用一条命令固定 CLI 版本并检查索引新鲜度。配套的 `Springgraph.getLastIndexedAt()` 库方法无需 shell 就能暴露同样的新鲜度检查。感谢 @12122J 和 @eddieran。(#329)
- TypeScript 中定义为泛型类型元组的 service/RPC 契约——例如 `type MyServiceList = [Service<'query_apply_record', …>, Service<'apply_confirm', …>]`——现在会把每个条目的字符串字面量名索引为可搜索符号。以前这些名字只作为类型参数存在，所以 `springgraph query query_apply_record` 什么都找不到，尽管这些名字是应用主要 API 表面。这种模式常见于类型化 RPC / BFF 客户端和 mock 服务器，类型是运行时代理对象的唯一真相来源。工具类型（`Pick`、`Omit`、`Record`）和路由路径被故意排除以避免噪音。感谢 @jiezhiyong。(#634)（TypeScript）
- 新增 `SPRINGGRAPH_DIR` 环境变量，用于设置每个项目的索引目录名（默认 `.springgraph`）。这让同一个工作树可以保存两个独立索引——最有用的场景是同时在 **Windows** 和 **WSL** 中打开同一个 checkout，它们无法安全共享同一个 `.springgraph/`：后台服务器锁和 SQLite 数据库与写入它们的 OS 绑定，而 SQLite 在 WSL2/Windows 文件系统边界上的锁并不可靠。在 Windows 侧设置 `SPRINGGRAPH_DIR=.springgraph-win`，WSL 保持默认，两者就在同一文件夹中各保留各的索引，互不覆盖。Springgraph 在索引和监听时也会跳过任何 `.springgraph-*` 同级目录，因此两个环境不会互相踩到对方的数据。感谢 @rrtt2323。(#636)

### 修复

- **Windows 上的 opencode 现在能找到 Springgraph。** 安装程序以前把 opencode 的全局 MCP 条目写到 `%APPDATA%\opencode\`，但 opencode 在所有平台上都从 `~/.config/opencode/` 读取配置（尊重 `XDG_CONFIG_HOME`），所以该条目对 opencode 不可见。现在安装会写到 opencode 实际查找的位置，`springgraph install` / `springgraph uninstall` 也会清理旧 `%APPDATA%` 位置中的陈旧 Springgraph 条目——文件中其他服务器和注释保持不动。感谢报告者 @fucknoobhanzo 和首批补丁作者 @WodenJay。(#535)
- `springgraph_search` 工具的 `kind: "type"` 过滤器——它自己的 schema 就宣传支持这个值——以前静默匹配不到任何内容；现在它能正确找到类型别名。`springgraph_explore` 工具的参数指引也不再建议先运行 `springgraph_search`，这和 explore 的“优先调用”设计相矛盾，会让代理多走一轮。
- Svelte 和 Vue 的 `<script>` 块中定义的符号被报告的位置比实际低一行——第 3 行的函数被报告在第 4 行——导致搜索、`springgraph_node` 和 explore 输出中脚本块符号的行号都偏移。现在行号与文件完全一致。重新索引项目以获得收益。（Svelte、Vue）
- 现在会为 export、const 赋值和带装饰器的声明捕获文档注释，并且符号携带的文档在所有支持的语言中都是干净的。以前 `export class X`、`export const fn = () => …`、普通 `const fn = () => …` 或带装饰器的 Python `def`/`class`（`@app.route(...)`、`@dataclass`）上方的注释会被完全丢弃——只有普通声明正上方的注释才会保留。Springgraph 现在会通过 `export` / `const` / 装饰器包装找到注释。各语言的注释标记清理也已补齐：Rust/Swift/Kotlin 文档行（`///`、`//!`）、Python/Ruby/shell 的 `#`、Lua/Luau（`--` 和 `--[[ ]]`）以及 Pascal（`{ }` 和 `(* *)`）不再在存储文本中留下杂散标记——在 19 种代码语言加上 Svelte/Vue `<script>` 块上端到端验证。感谢 @caleb-kaiser。(#780)
- Go 通过链式工厂函数的调用现在能解析到正确类型。像 `New().Method()` 这样的调用过去会丢失接收者类型，导致链式方法挂到无关类型的同名方法上，或无法解析。Springgraph 现在会捕获 Go 返回类型（指针 `*Foo` 解析为 `Foo`，多返回值 `(*Foo, error)` 解析为第一个结果），从工厂函数返回内容推断链式接收者类型，并在其上解析方法——包括内嵌结构体提升的方法——仅当类型或内嵌类型真正拥有该方法时才创建边。现有的 Go 索引建议重新索引（`springgraph index -f`）以获得收益。(#750)（Go）
- Scala 通过伴生对象工厂、流畅链或 case-class `apply` 的方法调用现在能解析到正确类型。像 `Foo.create().bar()` 或 `Builder(cfg).bar()` 这样的调用过去会丢失接收者类型，导致链式方法静默挂到无关类型的同名方法上——最常见的是把标准库 `Option` / `Iterator` 的 `.map` / `.flatMap` / `.foreach` 误归到你自己的同名类上。Springgraph 现在会捕获 Scala 返回类型（泛型 `List[Foo]` 解析为容器 `List`，限定 `pkg.Foo` 解析为 `Foo`），从内部调用返回或构造的内容推断链式接收者类型，并在其上解析方法——包括类型继承的 trait 中的方法——仅当该类型或其 trait 真正拥有该方法时才创建边（因此错误推断会产生无边而不是误导边）。现有的 Scala 索引建议重新索引（`springgraph index -f`）以获得收益。(#750)（Scala）
- Rust 通过链式关联函数的调用现在能解析到正确类型。像 `Foo::new().bar()` 或 `Foo::with(cfg).build()` 这样的调用过去会丢失接收者类型，导致链式方法静默挂到无关类型的同名方法上，或无法解析。Springgraph 现在会捕获 Rust 返回类型（`-> Self` 解析为实现类型），从关联函数返回内容推断链式接收者类型，并在其上解析方法——包括类型实现的 trait 提供的方法（通过新的 `impl Trait for Type` 关系）——仅当类型或其 trait 真正拥有该方法时才创建边。现有的 Rust 索引建议重新索引（`springgraph index -f`）以获得收益。(#750)（Rust）
- Dart 通过静态工厂、工厂或命名构造器、流畅链的方法调用现在能解析到正确类型。像 `Foo.create().bar()` 这样的调用过去会丢失接收者类型，导致链式方法静默挂到无关类型的同名方法上——最常见的是把标准库 `Option` / `Iterator` 的 `.map` / `.where` 误归到你自己的同名类上。Springgraph 现在会把 Dart **工厂和命名构造器**（`factory Foo.create()`、`Foo.named()`）作为一等成员索引以便调用解析，捕获 Dart 返回类型（泛型 `List<Foo>` 解析为容器 `List`），从内部调用返回或构造的内容推断链式接收者类型，并在其上解析方法——包括从超类或 mixin 继承的方法——仅当类型真正拥有该方法时才创建边。普通构造（`Foo(...)`）仍记录为实例化。现有的 Dart 索引建议重新索引（`springgraph index -f`）以获得收益。(#750)（Dart）
- Objective-C 通过链式消息发送的方法调用现在能解析到正确类。像 `[[Foo create] doIt]` 这样的调用过去会丢失接收者类型，导致 `doIt` 静默挂到无关类的同名方法上——通常是测试辅助类或标准库类。Springgraph 现在会捕获 Objective-C 方法返回类型，并从内部消息返回内容推断链式接收者类型。对于无处不在的 `[[X alloc] init]` 和单例模式（`[[X sharedInstance] …]`）——工厂返回 `instancetype`——接收者就是类 `X` 本身，因此链式方法会在 `X` 上解析（包括从超类继承的方法），仅当类真正拥有该方法时才创建边。现有的 Objective-C 索引建议重新索引（`springgraph index -f`）以获得收益。(#750)（Objective-C）
- Pascal/Delphi 通过链式工厂调用的方法调用现在能解析到正确类。像 `TFoo.GetInstance().DoIt()` 这样的调用过去会丢失接收者类型，导致 `DoIt` 静默挂到无关类的同名方法上。Springgraph 现在会捕获 Pascal 返回类型，并从工厂函数返回内容推断链式接收者类型——解析到声明类型（包括接口返回如 `IFoo`），对于构造器（`TFoo.Create().…`）或类型转换（`TFoo(x).…`）则解析到类 `TFoo` 本身，因为两者都产生一个 `TFoo`。仅当类型真正拥有该方法时才创建边（因此错误推断会产生无边）。现有的 Pascal/Delphi 索引建议重新索引（`springgraph index -f`）以获得收益。(#750)（Pascal/Delphi）
- Pascal/Delphi **无括号方法调用现在会被追踪**。Pascal 允许无参数方法或过程省略括号（`Obj.Free;`、`List.Clear;`、`TFoo.GetInstance.DoIt;`），以前这些完全不会被记录为调用——因此 callers、impact 和 trace 都遗漏了它们。Springgraph 现在会提取这些调用，并通过语句位置限定范围，确保字段或属性访问（看起来一模一样）不会被误认为是调用。在一个真实 Delphi 代码库上，这增加了约 1,100 条此前缺失的调用边且没有误报。现有的 Pascal/Delphi 索引建议重新索引（`springgraph index -f`）以获得收益。（Pascal/Delphi）
- Pascal/Delphi 中**独立过程或函数**（没有 `interface` 声明、只在 `implementation` 部分定义）内部的调用现在会被归因到该例程，而不是整个文件。以前这种例程没有自己的符号，因此它调用的所有内容都被汇总到单元下——`springgraph_callers` 返回的是文件，影响分析无法判断是哪个例程负责的。这些例程现在会被索引，其调用也会被正确归因。现有的 Pascal/Delphi 索引建议重新索引（`springgraph index -f`）以获得收益。（Pascal/Delphi）
- 当链式方法位于接收者类型符合的**超类或接口/协议**中时，链式方法调用现在能解析——例如对密封子类实例的调用（`Either.Right(x).combine(...)`）调用了父类型上定义的方法。以前这些链即使工厂类型已知也找不到 caller 边，因此调用对 callers、impact 和 trace 不可见。Springgraph 现在会遍历类型的超类型（`extends` / `implements` 关系）来查找方法，仅当超类型真正声明它时才创建边（因此错误推断仍会产生无边）。这让 Java、Kotlin 和 C# 的工厂与流畅链更加完整。现有索引建议重新索引（`springgraph index -f`）以获得收益。(#750)
- Swift 通过静态工厂、流畅链或构造器的方法调用现在能解析到正确类。像 `Foo.make().draw()` 或 `Foo().draw()` 这样的调用过去会丢失接收者类型，导致链式方法静默挂到无关类的同名方法上，或完全无法解析。Springgraph 现在会捕获 Swift 返回类型，并从内部调用返回（或构造类型）推断链式接收者类型，仅当类真正拥有该方法时才创建边（因此错误推断会产生无边而不是误导边）。现有的 Swift 索引建议重新索引（`springgraph index -f`）以获得收益。(#750)（Swift）
- C# 通过静态工厂或流畅链的方法调用现在能解析到正确类。像 `Foo.Create().Bar()` 或 `JObject.Parse(s).Property(...)` 这样的调用过去会丢失接收者类型，导致链式方法无法解析，调用对 callers/impact/trace 不可见。Springgraph 现在会捕获 C# 返回类型，并从内部调用返回内容推断链式接收者类型，仅当类真正拥有该方法时才创建边（因此错误推断会产生无边）。现有的 C# 索引建议重新索引（`springgraph index -f`）以获得收益。(#750)（C#）
- Kotlin 通过伴生对象工厂或流畅链的方法调用现在能解析到正确类。像 `Foo.getInstance().bar()` 或 `Config.create(opts).build()` 这样的调用过去会完全丢失接收者类型，导致链式方法静默挂到无关类的同名方法上，或完全无法解析——破坏 callers、impact 和 trace。Springgraph 现在会捕获 Kotlin 返回类型，并从内部调用返回内容推断链式接收者类型，仅当类真正拥有该方法时才创建边（因此错误推断会产生无边而不是误导边）。现有的 Kotlin 索引建议重新索引（`springgraph index -f`）以获得收益。(#750)（Kotlin）
- Java 通过静态工厂或流畅链的方法调用现在能解析到正确类。像 `Foo.getInstance().bar()` 或 `Config.create(opts).build()` 这样的调用过去会丢失接收者类型，因此当两个类有同名方法时，调用会静默挂到先被索引的那个上——或完全无法解析——破坏 callers、impact 和 trace。Springgraph 现在会捕获 Java 返回类型，并从内部调用返回内容推断链式接收者类型，仅当类真正拥有该方法时才创建边（因此错误推断会产生无边而不是误导边）。覆盖带参数的工厂和流畅构造器（`hashKeys().arrayListValues()`），包括返回嵌套类型的构造器。现有的 Java 索引建议重新索引（`springgraph index -f`）以获得收益。(#750)（Java）
- PHP：通过链式静态工厂调用的方法——例如 `Cls::for($x)->method(...)`，这是 Laravel 典型的按凭证/租户客户端用法——现在会记录 caller 边。以前接收者类型（`for()` 返回的内容）从未被恢复，因此 `springgraph_callers` 对该方法返回空，调用对 `springgraph_impact` 不可见。Springgraph 现在会捕获 PHP 返回类型——`: self` / `: static` 解析为声明类，`: SomeClass` 解析为该类——并在工厂结果上解析链式方法，仅当类确实拥有该方法时才创建边（因此错误推断会产生无边）。现有的 PHP 索引建议重新索引（`springgraph index -f`）以获得收益。感谢 @cvanderlinden。(#608)（PHP）
- 搜索相关性：查询中包含项目名（用户自然会写 `MyApp backend routes`）时，不再埋没查询真正关心的那部分代码。项目名在词法上匹配任何包含它的堆栈——例如 `MyAppFrontend/` 目录、`MyAppApp` 类——并且它被过加权了两种方式：单个 PascalCase 词会按子 token（`my` / `app` / `myapp`）多次计分，因此一个概念会把路径推高好几倍；而且项目名尽管命名的是整个仓库而非任何符号，却享有完整路径/消歧权重。现在路径相关性每个查询词只计一次，匹配项目名的词（从 `go.mod`、`package.json` 或仓库目录派生）会从路径计分和 `springgraph_explore` 的类型消歧偏好中剔除——除非它是唯一查询词，因此单独搜索项目名仍然有效。在混合技术栈仓库中，后端问题即使包含项目名也会优先展示后端。感谢 @MiNuo1。(#720)
- Go：只在匿名闭包内部被调用的函数——例如 cobra `RunE: func(…) {…}` 处理器、goroutine 字面量，或存储在包级 `var` 中的回调闭包——现在会显示其真正的调用者。以前调用会泄漏到文件节点，因此 `springgraph_callers` 和 `springgraph_impact` 报告这类函数没有有意义的调用者；现在调用会被归因到所在声明，因此编辑该函数会展示使用它的闭包。现有的 Go 索引建议重新索引（`springgraph index -f`）以获得收益。感谢 @Cyclone1070。(#693)（Go）
- 当 `.gitignore` 包含非 UTF-8 字节或无法解析的模式时，索引不再中止。企业环境中常见的由 DLP/终端安全软件原地透明加密的 `.gitignore`——或包含无法编译模式（如 `\[`，产生"Unterminated character class"）——以前会用满屏乱码崩溃整个 `sync` / `index`，且不指明问题文件，留下 `Files: 0 / Nodes: 0`。Springgraph 现在会整体跳过非 UTF-8 文本的 `.gitignore`，对文本文件则只丢弃单个无法解析的模式，并记录一条指明文件的警告——两种情况下索引都会继续。感谢 @zhanghang-9527。(#682)
- C++ 通过单例、工厂或链式 getter 调用的方法现在能解析到正确类。像 `Foo::instance().bar()`、`WidgetFactory::create().draw()`、`openSession()->run()`，或先存到 `auto` 局部变量再调用的情况，过去会丢失接收者类型——因此当两个类有同名方法时，调用会静默挂到先被索引的那个上（或完全无法解析），破坏 callers、impact 和 trace。Springgraph 现在会从内部调用返回内容推断接收者类型（首次捕获 C++ 返回类型），仅当类真正拥有该方法时才创建边，因此错误猜测会产生无边而不是误导边。覆盖单例和自返回访问器、返回不同类型的工厂、自由函数工厂、`make_unique` / `make_shared` / `new` / 直接构造，以及单级成员链。现有的 C/C++ 索引建议重新索引（`springgraph index -f`）以获得收益。感谢 @stabey。(#645)（C/C++）

[1.0.0]: https://github.com/jinglonglong/springgraph/releases/tag/v1.0.0
[1.0.1]: https://github.com/jinglonglong/springgraph/releases/tag/v1.0.1
[1.0.2]: https://github.com/jinglonglong/springgraph/releases/tag/v1.0.2
[1.0.3]: https://github.com/jinglonglong/springgraph/releases/tag/v1.0.3
