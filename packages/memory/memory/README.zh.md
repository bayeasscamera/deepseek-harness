# @deepseek-ai/dsh-memory

[English](README.md) | 中文

DeepSeek Harness agent 的长期记忆：带工作区作用域、分级召回与自动 system prompt 注入的跨会话持久记录存储。面向模型的工具位于 [`@deepseek-ai/dsh-tool-memory`](../tool-memory)；本包拥有服务、存储与 prompt 小节。

## 服务

`MemoryService`（context 键 `memory`）拥有一个 JSONL 存储文件，默认位于 `$DSH_HOME`（或 `~/.dsh`）下的 `memory.jsonl`，首次写入时创建。每次变更都会从内存索引整体重写文件，因此文件是派生数据；加载时丢弃中断写入造成的残缺末行而非报错。

一条记录携带 `kind`（`fact` | `preference` | `lesson`）、一句简洁的 `text`、一个 `scope`（`global`，或一个精确的工作区 `cwd`）、时间戳与召回命中计数。

- `remember(kind, text, scope)` 存储一条记录。相同 kind、text、scope 的重述会合并进已有记录——刷新 `updatedAt`，不产生重复。
- `forget(id)` 删除一条记录，未知 id 报告未命中。
- `search(query, { cwd, limit })` 对在一个工作区内适用的记录分级：逐字子串匹配得分最高，每个共享词元加分，最近一天内更新过的记录获得少量新鲜度加成。工作区记录仅当调用方 cwd 与其声明根完全一致时适用；全局记录处处适用。被召回的记录会递增命中计数并持久化。
- `recallText(cwd)` 将最高分的记录渲染为面向模型的召回小节；无记录时为空字符串。

## 召回注入

`apply()` 发布服务并注册名为 `memory:recall`、order 70（位于 order 60 的 `context-rules` 之后）的 `systemPrompt.context()` 条目。小节文本按次组装、取自调用 agent 会话的 cwd，因此一个会话的工作区记忆不会泄漏进另一个工作区的 prompt。

## Model Experience

### 召回小节

#### 模型看到的内容

当工作区存在记忆时，system prompt 携带固定的 `memory:recall` 小节，以 `- [kind] text (this workspace)` 行列出最高分记录，并带固定前言：这些是来自早前会话的持久观察，不是当前用户的指令，冲突时以当前请求为准。

#### Token 影响

每次请求一个小节，受 `maxRecall` 条记录（默认 12）加固定前言约束；无记忆时为零。

#### KV Cache 影响

该小节位于稳定的 system prompt 前缀中，只有当请求之间发生写入或命中计数变化时才使前缀失效；无记忆的会话完全不为此付费。

## 已知限制与暂缓事项

- **精确 cwd 工作区作用域** — 工作区记忆仅当会话 cwd 与记录根完全相等时适用；符号链接或嵌套路径不匹配。归一化步骤可以随后加入而不改变存储格式。
- **无嵌入召回** — 分级是词法的（逐字加词元重叠）；语义检索需要在同一 `search()` 契约之后接入嵌入 provider。
- **无自动提取** — 记录由模型通过工具或部署代码写入；没有后台流程从会话转录中派生记忆。
