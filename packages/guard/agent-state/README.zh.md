# @deepseek-ai/dsh-agent-state

[English](README.md) | 中文

智能体状态持久化与动作后果推理。该 guard 为每个工作区维护一份跨会话的工具调用记录，并让模型在每次动作前后对其后果进行推理。

## 功能

**每个步骤之前**（`agent/pre-step`）：当存储中某个工具已有至少三次已结算调用时，guard 会前置一条召回上下文，列出各工具的成功率与本工作区已经付出过的教训。模型在规划下一个动作时能看到自己的历史。

**每次变更动作之前**（`tools/pre-execute`）：对调用进行分类（`read-only`、`reversible`、`irreversible`），并从工具名与参数推导预测后果——写入的文件、派生的进程、破坏性命令模式（`rm -r`、`git reset`、`git clean`、删表、卸载包）。开启 `denyIrreversible` 后，预测为不可逆的调用会被直接拒绝，理由即预测内容。

**每次动作之后**（`tools/post-execute`）：将已结算结果与预测进行比对；比对以附加上下文返回给模型（`[tool] settled success — the outcome matched the predicted effect`），并把一句教训归入该工具的持久统计。

## 持久化

每个工作区一个 JSON 存储于 `$DSH_HOME/agent-state/<workspace-hash>/state.jsonl`（或 `storeDir`），每次结算后原子重写——与 dsh-memory 相同的派生文件模式。会话日志仍是模型可见事件的事实来源；存储承担召回索引与滚动统计：

- 每个工具：已结算的成功/失败次数与最多 8 条保留教训；
- 最近 200 条观察。

## 配置

| 键 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `storeDir` | string | `$DSH_HOME/agent-state` | 存储目录（或精确的 `.jsonl` 文件路径）。 |
| `denyIrreversible` | boolean | `false` | 直接拒绝预测为不可逆的调用，而非预测后放行。 |

## 限制

预测为启发式（工具名加参数形态）；从不检查文件内容。无 agent 的直接 `ctx.tools.execute` 调用对 guard 透明。
