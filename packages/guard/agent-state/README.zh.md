# @deepseek-ai/dsh-agent-state

[English](README.md) | 中文

智能体状态持久化与动作后果推理。该 guard 为每个工作区维护一份跨会话的工具调用记录，并让模型在每次动作前后对其后果进行推理。

## 功能

**每个步骤之前**（`agent/pre-step`）：当存储中某个工具已有至少三次已结算调用时，guard 会前置一条召回上下文，列出各工具的成功率与本工作区已经付出过的教训。模型在规划下一个动作时能看到自己的历史。

**每次变更动作之前**（`tools/pre-execute`）：对调用进行分类（`read-only`、`reversible`、`irreversible`），并从工具名与参数推导预测后果——写入的文件、派生的进程、破坏性命令模式（`rm -r`、`git reset`、`git clean`、删表、卸载包）。开启 `denyIrreversible` 后，预测为不可逆的调用会被直接拒绝，理由即预测内容。

**每次动作之后**（`tools/post-execute`）：将已结算结果与预测进行比对，并把一句教训归入该工具的持久统计。只有"意外"才作为附加上下文返回给模型——失败，或与预测不符的结果。比对一致的成功的留在统计中，不注入任何消息，因此不会有消息伴随每次调用产生。

## 持久化

每个工作区一个 JSON 存储于 `$DSH_HOME/agent-state/<workspace-hash>/state.jsonl`（或 `storeDir`），每次结算后原子替换（先写入同目录 `.tmp`，再重命名）——与 dsh-memory 相同的派生文件模式。会话日志仍是模型可见事件的事实来源；存储承担召回索引与滚动统计：

- 每个工具：已结算的成功/失败次数与最多 `maxLessonsPerTool` 条保留教训；
- 最近 `maxObservations` 条观察。

## 数据契约

该服务的公开 API 传递两个纯记录（声明于 `src/types.ts`）：

**`ActionPrediction`** — 一次工具调用的预测概览，在调用运行前存储：

- `risk` — 检查工具与参数后的分类：`read-only`、`reversible` 或 `irreversible`；
- `consequences` — 预测影响，按重要性从高到低排列，每项是一个 `effect` 标签（如 `writes-file`、`spawns-process`）加一行 `detail`；只读调用为空；
- `targets` — 该动作可能修改的文件路径与命令，保留用于之后与实际结果比对；
- `reversibleByConvention` — 工具自身约定是否使撤销不可能（`rm -f`、截断）。

**`ActionObservation`** — 一次已结算结果与其预测的比对；即存储折叠的持久行：

- `id` — 稳定 id，也是合并键；
- `tool` — 运行的工具名；
- `outcome` — `success` 或 `failure`；
- `matchedPrediction` — 已结算结果是否与预测的风险类别一致；
- `unexpected` — 值得记住的意外影响，没有则为空；
- `lesson` — 保留进该工具持久统计的一行教训；
- `at` — 自纪元起的毫秒墙钟时间。

## 配置

| 键 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `storeDir` | string | `$DSH_HOME/agent-state` | 存储目录（或精确的 `.jsonl` 文件路径）。 |
| `denyIrreversible` | boolean | `false` | 直接拒绝预测为不可逆的调用，而非预测后放行。 |
| `maxObservations` | number | `200` | 存储中保留的滚动观察条数。 |
| `maxLessonsPerTool` | number | `8` | 每个工具行保留的独立教训条数。 |

## 模型体验

### 步骤前历史召回

#### 模型所见

当持久化存储中某个可用工具至少有 3 次已结算调用时，agent 在规划下一步之前会收到召回通知。该消息以插件通知形式来源（`form: notice`，摘要 `durable tool history`）；格式由 spec 固定。每个召回的工具一条，列出最近三条独立教训；少于三次已结算调用的工具会被省略，没有任何工具达标时整条消息缺省。

##### 召回通知

```markdown
Durable tool history for this workspace:
- bash: 85% success over 20 settled calls; lessons: avoid interactive prompts without flags
```

#### Token 影响

当没有工具达到 3 次调用门槛时为零 Token；触发时为每个召回的工具增加简洁的一行。

#### KV Cache 影响

在工具执行前作为步骤上下文前置，不影响静态系统提示词的缓存。

## 已知局限与后续工作

- **启发式预测** — 预测依赖工具名与参数形态，不读取文件内容或远程环境。
- **直接执行透传** — 无 active agent 上下文的直接 `ctx.tools.execute` 调用对 guard 透明。
- **单写入者** — 存储没有跨进程加锁；同一工作区的两个 `dsh` 进程各自读-改-写全量重写，最后写入者获胜，另一方的观察被静默丢弃。
- **工作区键控** — 存储键是插件构造时的进程 cwd；多工作区 daemon 的各会话共享同一份存储。
