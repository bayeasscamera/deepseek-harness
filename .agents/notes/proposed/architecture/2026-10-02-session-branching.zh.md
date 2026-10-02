# Agent Note: 从某条消息分支出一个会话

Status: proposed

[English](2026-10-02-session-branching.md) | 中文

## 问题

产品需要 **分支（Branch）** 操作：从任意一条消息出发开启一个并行会话，把文件、指令以及直到该消息为止的全部历史带过去，同时**原始会话保持严格不变**。在设计任何东西之前，必须先读代码弄清仓库里已有什么。

**发现结果：核心原语已经存在。** fork 已经能把一个会话的事件前缀复制成一个新会话，已经通过 RPC 暴露为 `session.fork`，并且已经能在聊天界面上从"已完成轮次的最后一条消息"触发。缺的不是复制引擎，而是它之上的产品语义。

### 会话与消息存放在哪里

- 会话是**只追加的事件日志**，不是"一行一条消息"的表。`@deepseek-ai/dsh-session-persistence`（`packages/session/session-persistence/README.md:12`）暴露 `ctx.sessionPersistence`，提供 `create`/`open`/`stat`/`list`；`create`/`open` 返回 `SessionHandle`，它拥有全部读取、追加、flush 以及单写入者声明。
- 随包发布的实现是**每个会话一个 `.jsonl.zstd` 文件**（`packages/session/session-persistence-jsonl`），由 `@deepseek-ai/dsh-session-format`（`packages/session/session-format/README.md:12`）定义物理分帧，已发布 v0→v1→v2 相邻迁移（`session-format-v0-to-v1`、`-v1-to-v2`），由 `session-format-catalog` 组装。
- 不可重放元数据单独存放在 **`SessionHeader`**（`packages/core/session/src/types.ts:91`）：`version`、`id`、`createdAt`、`cwd`、`parentSession`、`isSeeded`、`origin`、`delegationDepth`、`agentPreset`。不存在与事件并行的"已存储消息"类型。
- 事件带每会话单调递增的 **`seq`**；事件词汇表由生成的 `KNOWN_SESSION_EVENT_TYPES`（`packages/core/session/src/known-event-types.ts:22`）定义：`user/message`、`assistant/message`、`assistant/attempt`、`tool/call`、`tool/result`、`turn/start`、`turn/end`、`step/start`、`step/end`、`session/title`、`compaction/*`、`request/header`、`request/context`、`model/selection`、`agent-preset/selected`、`permission/preset`、`plan/mode`、`sandbox/mode`、`goal/change`、`todo/write`，以及标记种子边界的 `session/end-seed`。
- 工具调用与其结果是**两个事件，通过 call id 关联**（`tool/call` / `tool/result`）；读取路径在恢复时已经会修补悬空配对：没有持久化调用的助手请求变成 `TOOL_NOT_STARTED`，没有结果的持久化调用变成 `TOOL_OUTCOME_UNKNOWN`（`packages/session/session-persistence/README.md:132`）。

### 会话上下文的构成

- 指令、模型、preset、权限与工作区由插件围绕会话组合；可持久化的部分作为事件记录（`agent-preset/selected`、`model/selection`、`permission/preset`、`plan/mode`、`sandbox/mode`、`request/context`、`request/header`），因此它们**就在事件前缀里**。
- `cwd` 是头部元数据；客户端线上头部携带血脉字段 `parentSession`、`isSeeded`、`origin`、`delegationDepth`（`packages/api/session-controller/src/types.ts:392`）。
- 压缩状态同样是事件（`compaction/start`、`compaction/summary`、`compaction/end`、`compaction/prune`），因此包含压缩事件的前缀自然带着对应摘要。
- 引擎不需要应用每轮回传历史：agent-loop 持久化每个已发布事件，并通过读取已存日志、为中断轮次追加合成收尾事件来**恢复**（`packages/session/session-persistence/README.md:61`）。

### 已经可以复用的部分

| 部件 | 位置 | 状态 |
|---|---|---|
| 带边界的 fork | `packages/core/session/src/index.ts:1170` — `fork(source, boundary?, childSessionId?)` 用源事件播种子会话，写入 `parentSession`、`isSeeded: true`、`cwd` 与 `inheritedEventCount` | 可直接复用 |
| 边界安全 | `_forkSeed` 拒绝不存在的边界，并要求切片**不得停在未结束的轮次内部** | 可直接复用（这正是 §3.3 的保证） |
| Host RPC | `packages/api/session-controller/src/commands.ts:194` — `fork(request)`；当没有可分支的已完成轮次时返回 `session/fork-unavailable` | 可复用，需要新增选项 |
| 客户端 RPC | `packages/api/session-controller/src/client/contract/sessions.ts:97` — `fork({ sessionId, atSeq?, increaseTitle? }): Promise<SessionId>` | 可复用，需要新增选项 |
| 聊天动作 | `packages/client/ui-chat/src/client/chat/TurnTailNodeView.tsx:48` — `onBranch={() => forkAt(closing.finalNode.seq)}`，非最后一个已完成轮次时通过 `branchUnavailable` 置灰；由 `MessageIconActions.tsx:91` 渲染，标签为 `message.branch` | 仅存在于**轮次尾部** |
| 会话列表中的 fork | `packages/client/ui-workspace/src/client/index.ts:113` — `forkSession` → `sessions.fork({ sessionId, increaseTitle: true })` | 已存在 |
| 标题编号 | 客户端契约上的 `increaseTitle`（派生子会话标题） | 已存在 |
| 工作区挂载 | `commands.ts:527` — `forkWorkspace` 复用源会话（或 subagent 祖先）的工作区 | 可复用；**没有隔离选项** |
| fork 测试 | `packages/core/session/tests/fork.spec.ts`、`ui-chat/tests/chat-view.client.spec.tsx:1290,2435`（校验 `forkAt` 收到的 seq） | 已存在 |

### 与目标产品的差距

| 需求 | 现状 |
|---|---|
| 在**每条消息**上可用 | 部分：只在已完成轮次的最后一条助手消息上；用户消息虽然渲染 `MessageIconActions`，但只有复制 |
| 标题 `<原标题> (branche)` / `(branche N)` | 以 `increaseTitle` 形式存在；具体措辞待核对 |
| 从**用户**消息分支时把文本放入输入框 | 缺失：`SessionForkRequest` 是 `{ sessionId, atSeq? }`，`SessionForkValue` 是 `{ sessionId }`，既不返回也不暂存文本 |
| 子会话顶部可见的 **"Branch of `<parent>`"** 链接 | 缺失 |
| 源消息上的 **"N 个分支"** 标记 | 缺失（可由 `parentSession` 计数，但分支点不在线上数据里） |
| 会话列表中父会话下的缩进/图标 | 部分：工作区浏览器会列出 fork，但没有父级分组 |
| **隔离选项**（`git worktree` 或复制） | 缺失：子会话复用源会话的工作区 |
| 删除父会话后子会话脱钩 | 不适用：持久化层**没有删除 API**（`session-persistence/README.md:152`），清理属于带外维护 |
| 原子创建 / 无残留 | 核心 `fork` 在边界校验后一步创建子会话；RPC 包住工作区挂载，并在挂载失败时清理子会话（`commands.ts:281`） |

### 与本技术栈的适配

- **身份是事件 `seq`，不是消息 id。** 此设计里消息没有持久化 id；分支点就是 seq，正是 `atSeq` 已接受的参数。因此需求中的 `branched_from_message_id` 对应"子会话前缀结束处的源 seq"，而子会话已经用继承前缀长度记录了它。
- **复制本身不需要新 schema、也不需要迁移。** 子会话就是一个普通会话，其事件是复制来的前缀；`parentSession` + `isSeeded` 已经描述了血脉。只有当某个事实无法推导时（例如显式的隔离标记）才值得新增字段，而那意味着 `SessionHeader`/线上格式变更以及相邻迁移规则。
- **附件是引用而非副本。** 提示附件以持久引用形式经 `ctx.attachments` 接纳（`packages/api/session-controller/src/commands.ts:557`），内容由 `packages/attachment/` 下的附件存储按内容寻址，因此复制前缀携带的是同一批引用，不复制任何字节。删除分支因此不可能删除源会话的文件。
- **引擎不需要 fork id。** 子会话有自己的新会话 id 与自己的日志；源会话的 id 永不被复用。

## Proposal

在既有 fork 之上补齐产品语义，分阶段进行：

1. **服务端**：扩展 fork 契约为"分支意图"——裁切点沿用 `atSeq`，新增可选 `isolateFiles`，并在裁切点为用户消息时返回 `draftText`。`fork` 仍是唯一原语，不新增重复实现。
2. **客户端动作**：在任何能寻址到持久事件的消息上暴露 Branch（含用户消息），保留既有的 `branchUnavailable` 门控。
3. **草稿交接**：当裁切消息是用户的，把它的文本放入输入框作为可编辑草稿，便于改写并探索另一条路径。
4. **血脉体验**：子会话顶部的 "Branch of `<父标题>`" 链接、源消息上的 "N 个分支" 标记、会话列表中的父级分组。
5. **隔离**：显式选择加入，创建独立工作副本；无法创建时**失败关闭**（不创建分支）。

## Acceptance criteria

- 从任意可分支消息创建分支后，子会话被打开，源会话逐字节不变（消息、顺序、标题、头部）。
- 分支历史中绝无孤立的 `tool/call` 或 `tool/result`；落在未结束轮次内的裁切点被修复或被拒绝，绝不原样复制。
- 创建是原子的：失败后不残留任何半个会话、文件或工作区。
- 子会话显示父链接；源会话显示从它切出的分支数量。
- 从用户消息分支会填充输入框；从助手消息分支则输入框保持为空。
- 每个新增的可见字符串在所有已发布语言中都存在。

## 考虑过的替代方案

**用引用共享前缀，而不是复制事件。** 子会话将依赖源会话的活动日志：源会话之后的编辑、重新生成、清理或崩溃修复都会改变分支，而且必须共享它的单写入者声明。需求要求的是源会话保持不变、分支是独立快照。

**复制 JSONL 产物再做裁剪。** 写入更省事，但绕过了格式目录的校验与头部转换，会让种子元数据不正确，还要重新实现 `_forkSeed` 已经强制执行的尾部裁剪规则。

**复用源会话 id，在引擎侧分支。** 两个写入者会共用一份日志，而持久化 seam 每个会话只允许一个写入者，第二个写入者会被设计拒绝。

**在 `fork` 之外新增一个分支服务。** 第二条创建路径会重复边界校验、血脉头部字段，以及 `fork` 与 `forkWorkspace` 已经拥有的工作区挂载。

**新增 `branched_from_message_id` 与 `branch_created_at`。** 本技术栈没有消息 id，也没有关系型会话表：分支点已经作为子会话的继承前缀长度存在，`parentSession` + `isSeeded` 已经承载了血脉。同一事实的第二份拷贝需要每个写入者保持同步。

## Risks

- **未提交的改动与语言文件重叠。** `packages/client/locale-fr/src/client/dicts-chat.ts` 与若干 `ui-chat` 文件在工作区中已修改；新增字符串时不能把这些改动一并卷进阶段提交。
- **`increaseTitle` 的措辞**可能不等于需求要求的 `(branche)` / `(branche N)`；子会话标题派生由客户端拥有，改动前必须先读。
- **隔离是唯一真正的新机制**（worktree 或目录复制），也是唯一可能在失败后留下残留的地方；它必须失败关闭并由测试证明。
- **落在未结束轮次内的裁切点**目前会让 fork 不可用（"已完成轮次"规则），而不是裁到最后一个安全边界；需求要求的做法是把裁切点扩展或拒绝，这会把既有的拒绝变成修复。该决定改变用户可见行为，应先确认。
