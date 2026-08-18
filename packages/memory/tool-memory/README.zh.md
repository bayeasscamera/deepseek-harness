# @deepseek-ai/dsh-tool-memory

[English](README.md) | 中文

基于 [`@deepseek-ai/dsh-memory`](../memory) 的面向模型长期记忆工具：`memory_write` 存储持久记录，`memory_search` 分级检索已记住的内容，`memory_forget` 删除一条。每次调用都是被记录的工具调用；记忆服务拥有持久化与召回 prompt 小节。

## 工具

- `memory_write(kind, text, scope?)` — 一条持久记忆。`kind` 为 `fact`、`preference` 或 `lesson`；除非部署固定 `defaultScope: 'global'`，`scope` 默认 `workspace`（调用会话的 cwd；无 cwd 时为 `global`）。重述已有记忆会刷新它而非重复。
- `memory_search(query, limit?)` — 调用工作区内的分级召回；空查询列出最新记录。
- `memory_forget(id)` — 按 id 删除一条记录；更正事实应优先写入新记录而非删除，因为重述不替换旧文本。

## Model Experience

### 工具 schema 与结果

#### 模型看到的内容

模型看到生成的 [`memory_write`](../../../docs/tool-catalog.md#deepseek-aidsh-tool-memory)、[`memory_search`](../../../docs/tool-catalog.md#deepseek-aidsh-tool-memory)、[`memory_forget`](../../../docs/tool-catalog.md#deepseek-aidsh-tool-memory) schema，固定描述说明何时写入（稳定事实、明确偏好、值得数周后召回的教训——绝不是临时任务状态）以及召回如何进入 prompt。结果每条记录渲染一行：`id [kind] (scope) text`。

#### Token 影响

每次请求三行 schema，加上每次写入、搜索命中或删除的简短结果行；召回小节本身由 `@deepseek-ai/dsh-memory` 拥有。

#### KV Cache 影响

schema 位于稳定的工具 schema 前缀中；调用结果是逐轮输出，不会使前缀失效。

## 已知限制与暂缓事项

- **无批量写入** — 每次 `memory_write` 一条记忆，使合并与日志一一对应；批量形式可以随后通过循环同一合并逻辑加入。
- **无工具侧列表 UI** — 搜索结果是纯文本行；更丰富的呈现方法可以随后沿工具呈现缝加入而不触碰存储。
