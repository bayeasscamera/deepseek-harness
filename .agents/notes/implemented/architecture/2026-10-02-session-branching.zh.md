# Agent Note: 从某条消息分支出一个会话

Status: implemented

[English](2026-10-02-session-branching.md) | 中文

## 问题

产品需要 **分支（Branch）** 操作：从任意一条消息出发开启一个并行会话，把文件、指令以及直到该消息为止的全部历史带过去，同时**原始会话保持严格不变**。

在设计任何东西之前先读代码，结果发现核心原语已经存在：`ctx.sessions.fork` 能把一个会话的事件前缀复制成新会话，RPC 已把它暴露为 `session.fork`，已完成轮次的最后一条消息也已经能触发它。真正要做的是它之上的产品语义——从用户消息分支时的草稿交接、血脉展示、分支计数与文件隔离——而不是复制引擎、新 schema 或迁移。

### 会话与消息存放在哪里

- 会话是**只追加的事件日志**，不是"一行一条消息"的表。`@deepseek-ai/dsh-session-persistence`（`packages/session/session-persistence/README.md:12`）暴露 `ctx.sessionPersistence`，提供 `create`/`open`/`stat`/`list`；`create`/`open` 返回 `SessionHandle`，它拥有全部读取、追加、flush 以及单写入者声明。
- 随包发布的实现是**每个会话一个 `.jsonl.zstd` 文件**（`packages/session/session-persistence-jsonl`），由 `@deepseek-ai/dsh-session-format`（`packages/session/session-format/README.md:12`）定义物理分帧，已发布 v0→v1→v2 相邻迁移（`session-format-v0-to-v1`、`-v1-to-v2`），由 `session-format-catalog` 组装。
- 不可重放元数据单独存放在 **`SessionHeader`**（`packages/core/session/src/types.ts:91`）：`version`、`id`、`createdAt`、`cwd`、`parentSession`、`isSeeded`、`origin`、`delegationDepth`、`agentPreset`；子会话继承的前缀长度作为 `inheritedEventCount` 存放在它旁边。不存在与事件并行的"已存储消息"类型。
- 事件带每会话单调递增的 **`seq`**；事件词汇表由生成的 `KNOWN_SESSION_EVENT_TYPES`（`packages/core/session/src/known-event-types.ts:22`）定义：`user/message`、`assistant/message`、`assistant/attempt`、`tool/call`、`tool/result`、`turn/start`、`turn/end`、`step/start`、`step/end`、`session/title`、`compaction/*`、`request/header`、`request/context`、`model/selection`、`agent-preset/selected`、`permission/preset`、`plan/mode`、`sandbox/mode`、`goal/change`、`todo/write`，以及标记种子边界的 `session/end-seed`。
- 工具调用与其结果是**两个事件，通过 call id 关联**（`tool/call` / `tool/result`）；读取路径在恢复时已经会修补悬空配对：没有持久化调用的助手请求变成 `TOOL_NOT_STARTED`，没有结果的持久化调用变成 `TOOL_OUTCOME_UNKNOWN`（`packages/session/session-persistence/README.md:132`）。

### 分支携带什么

- 指令、模型、preset、权限与工作区由插件围绕会话组合；可持久化的部分作为事件记录（`agent-preset/selected`、`model/selection`、`permission/preset`、`plan/mode`、`sandbox/mode`、`request/context`、`request/header`），因此它们**就在事件前缀里**。
- 压缩状态同样是事件（`compaction/start`、`compaction/summary`、`compaction/end`、`compaction/prune`），因此包含压缩事件的前缀自然带着对应摘要。
- 引擎不需要应用每轮回传历史：agent-loop 持久化每个已发布事件，并通过读取已存日志、为中断轮次追加合成收尾事件来**恢复**（`packages/session/session-persistence/README.md:61`）。

### 分支复用了什么

| 部件 | 位置 | 状态 |
|---|---|---|
| 带边界的 fork | `packages/core/session/src/index.ts:1170` — `fork(source, boundary?, childSessionId?)` 用源事件播种子会话，写入 `parentSession`、`isSeeded: true`、`cwd` 与 `inheritedEventCount` | 原样复用 |
| 边界安全 | `_forkSeed` 拒绝不存在的边界，并要求切片**不得停在未结束的轮次内部** | 原样复用 |
| Host RPC | `packages/api/session-controller/src/commands.ts:194` — `fork(request)`；当没有可分支的已完成轮次时返回 `session/fork-unavailable` | 复用，新增分支选项 |
| 客户端 RPC | `packages/api/session-controller/src/client/contract/sessions.ts:103` — `fork({ sessionId, atSeq?, increaseTitle?, isolateFiles? })` | 复用，新增分支选项 |
| 工作区挂载 | `commands.ts:527` — `forkWorkspace` 复用源会话（或 subagent 祖先）的工作区 | 复用；子会话的 `cwd` 由隔离步骤给出 |
| 标题编号 | `increasedForkTitle`（`client/sessions/service.ts:161`）— `<标题> (1)`，随后 `(2)`、`(3)`……；中文标题使用全角 `（n）` | 复用 |

## 决策

`ctx.sessions.fork` 仍是唯一的创建路径；分支是这次 fork 加上五个已发布的行为。

**裁切点规划。** `planBranchCutoff`（`packages/api/session-controller/src/branch-cutoff.ts`）把锚点读作使用者的意图：锚在 `user/message` 上时该消息**不进入**子会话，而是作为 `draftText` 返回；锚在其他事件上时复制到该轮次结束；锚点若会落在未结束的轮次内部，则回退到最后一个已完成轮次，使被复制的 `tool/call` 绝不丢失结果。没有任何已完成轮次的会话以 `session/fork-unavailable` 拒绝。

**动作。** 每条用户消息与每个已定稿的轮次尾部都提供 Branch（`packages/client/ui-chat/src/client/chat/MessageItem.tsx`）；当同一索引轮次内还有后续 steering 消息、工具调用或中断的步骤时，轮次尾部仍以 `message.branchUnavailable` 置灰。

**草稿交接。** 子会话打开之前，其输入框先收到锚点文本，于是被排除在复制历史之外的那条消息成为第二条路径的第一个可编辑轮次（`packages/client/ui-chat/src/client/apply.ts`）。锚点不是用户消息时不返回草稿，输入框保持为空。

**血脉。** 子会话在转写内容上方渲染 "Branched from `<源标题>`"，并通过会话列表行读取源会话，因此源会话改名后显示的是当前标题（`packages/client/ui-chat/src/client/chat/ChatView.tsx`）。工作区列表中源会话行带本地化的分支计数：`indexBranchDescendants` 统计记录了父会话且 origin 不是 subagent 的直接子会话，分支的分支计入它自己的父会话（`packages/client/ui-workspace/src/client/subagent-lineage.ts`）。

**文件隔离。** `fork({ isolateFiles: true })` 给子会话独立的工作副本，而不是共享源目录：源目录位于 Git 仓库内时创建以子会话命名的 Git worktree，否则创建跳过依赖、历史与构建残留的复制。隔离在任何子会话存在之前**失败关闭**，后续步骤失败时会删除已创建的复制（`packages/api/session-controller/src/branch-workspace.ts`）。

**没有新 schema，也没有迁移。** 分支点就是子会话继承的前缀长度；`parentSession` + `isSeeded` 已经在头部与客户端线上数据中承载血脉（`packages/api/session-controller/src/types.ts:411`）；附件是以持久引用形式经 `ctx.attachments` 接纳的，因此复制前缀不复制任何字节，删除分支也不可能删除源会话的文件。

## 待办

- **源消息上的逐消息分支标记。** 裁切点不在客户端线上数据里——头部携带的是 `parentSession`/`isSeeded`，而不是分支点——因此该标记要么需要新增按会话的分支点投影（会话列表"不携带逐会话统计"的策略拒绝这种做法），要么需要惰性读取每个子会话的头部。源会话行的分支计数已经回答了"这段对话产生了多少分支"。
- **会话列表中的父级分组。** 分支以独立行加分支计数徽标呈现；嵌套未实现。
- **`isolateFiles` 的界面入口。** 该标志已在客户端 fork 契约上并由测试覆盖，但还没有任何界面提供它，因此默认的分支与源会话编辑同一目录。

## 测试

- Host 侧：`packages/api/session-controller/tests/session-fork.host.spec.ts` 固定裁切规则与草稿返回；`tests/branch-workspace.spec.ts` 证明 worktree/复制两种隔离、失败关闭路径，以及源目录从未被移动或修改。
- 客户端：`packages/client/ui-chat/tests/apply-inject.client.spec.tsx` 证明草稿注入（以及非用户锚点时输入框为空），`tests/chat-view.client.spec.tsx` 证明 fork 目标与血脉行，`tests/chat-branch-tails.client.spec.tsx` 证明动作的可用性规则；`packages/client/ui-workspace/tests/subagent-lineage.client.spec.ts` 与 `tests/rows.client.spec.tsx` 证明分支计数。

## 考虑过的替代方案

**用引用共享前缀，而不是复制事件。** 子会话将依赖源会话的活动日志：源会话之后的编辑、重新生成、清理或崩溃修复都会改变分支，而且必须共享它的单写入者声明。需求要求的是源会话保持不变、分支是独立快照。

**复制 JSONL 产物再做裁剪。** 写入更省事，但绕过了格式目录的校验与头部转换，会让种子元数据不正确，还要重新实现 `_forkSeed` 已经强制执行的尾部裁剪规则。

**复用源会话 id，在引擎侧分支。** 两个写入者会共用一份日志，而持久化 seam 每个会话只允许一个写入者，第二个写入者会被设计拒绝。

**在 `fork` 之外新增一个分支服务。** 第二条创建路径会重复边界校验、血脉头部字段，以及 `fork` 与 `forkWorkspace` 已经拥有的工作区挂载。

**新增 `branched_from_message_id` 与 `branch_created_at`。** 本技术栈没有消息 id，也没有关系型会话表：分支点已经作为子会话的继承前缀长度存在，`parentSession` + `isSeeded` 已经承载了血脉。同一事实的第二份拷贝需要每个写入者保持同步。

## 后果

- 源会话永不写入。子会话是拥有自己的 id、自己的日志与一份复制前缀的普通会话，因此"源会话逐字节不变"的保证来自结构本身，而不是靠某条回滚路径。
- 分支历史中绝不会出现孤立的 `tool/call` 或 `tool/result`，因为裁切点规划器要么拒绝，要么收进最后一个已完成轮次。
- 携带附件的成本为零，也不可能通过分支销毁它们。
- 代价：隔离是选择加入的，因此默认分支与源会话编辑同一批文件；分支点无法从客户端寻址，这正是逐消息标记被推迟的原因；子会话标题派生复用既有的 `(n)` 后缀，而不是分支专用措辞。
