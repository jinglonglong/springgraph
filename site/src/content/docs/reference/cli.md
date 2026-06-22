---
title: CLI
description: Springgraph 的每条命令及其支持的参数。
---

```bash
springgraph                         # 运行交互式安装器
springgraph install                 # 运行安装器(显式调用)
springgraph uninstall               # 从你的 Agent 中移除 Springgraph(install 的逆操作)
springgraph init [path]             # 在项目中初始化(--index 同时建索引)
springgraph uninit [path]           # 从项目中移除 Springgraph(--force 跳过确认)
springgraph index [path]            # 全量索引(--force 重建索引,--quiet 减少输出)
springgraph sync [path]             # 增量更新
springgraph status [path]           # 显示统计信息
springgraph query <search>          # 搜索符号(--kind, --limit, --json)
springgraph files [path]            # 显示文件结构(--format, --filter, --max-depth, --json)
springgraph context <task>          # 为 AI 构建上下文(--format, --max-nodes)
springgraph callers <symbol>        # 查找调用了某函数/方法的位置(--limit, --json)
springgraph callees <symbol>        # 查找某函数/方法内部调用了哪些(--limit, --json)
springgraph impact <symbol>         # 分析改动一个符号会影响哪些代码(--depth, --json)
springgraph affected [files...]     # 查找受改动影响的测试文件
springgraph serve --mcp             # 启动 MCP 服务器
springgraph web [path]              # 启动 Web UI 可视化界面 (--port, --host, --no-open)
springgraph daemon                  # 列出或停止后台运行的 MCP 服务器
```

## 查询类命令

`query`、`callers`、`callees` 和 `impact` 都支持 `--json`,输出机器可读格式。

```bash
springgraph query UserService --kind class --limit 10
springgraph callers handleRequest --json
springgraph impact AuthMiddleware --depth 3
```

## affected

沿导入依赖传递地追踪,找出受改动的源文件影响的测试文件。可选参数与 CI 示例见 [CI 中的受影响测试](/springgraph/guides/affected-tests/)。
