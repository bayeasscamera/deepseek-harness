---
description: "循环卫生 guard：当输出上限截断一轮回答时自动续写同一轮次，供选择、配置或排查此插件的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-auto-continue

[English](README.md) | 中文

## 概述

输出预算很小的模型——输出上限只有几千 token 的免费路由模型、把上限全部花在思考上的推理模型——可能在回答中途、甚至工具调用中途就到达输出 token 上限。没有帮助时，轮次就停在那里：回答被截断、代码编辑被丢弃，完成工作需要手动发送「continue」，而且往往要反复多次直到模型恰好放得下。`dsh-auto-continue` 在轮次的停止边界 steer 一条续写提示，让模型在同一轮次内从原处恢复——已积累的部分输出保留、被截断的工具调用完整重发、会话上下文原样延续。连续续写上限保证永不完成的模型不会无限烧请求，新的用户消息会重置计数。它随 `dsh` base 组合默认启用，最多连续续写 8 次。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当被截断的回答应当自己完成、而不是等待用户时，挂载此插件。无需学习或接线：`dsh` base 组合已经运行它，默认上限适用于大多数会话——当你的模型需要更多空间或应当更早放弃时，在下面调高或调低它。

### 何时选择

当模型经由输出上限小于任务所需回答规模的 provider 回答时选择它，长回答会可靠地拆分到多次续写。当每次截断都必须以停止的形式暴露给用户时避免使用它——把 `maxConsecutive` 设为 `1` 即只做一次自动重试，或移除插件以仅手动停止。

### 设置上限

想增减自动续写次数时，用配置挂载插件：

```yaml
- name: '@deepseek-ai/dsh-auto-continue'
  config:
    maxConsecutive: 8   # automatic continuations before the turn closes truncated
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxConsecutive` | `8` | guard 收手、轮次以截断结束前所 steer 的连续续写次数 |

无效配置会在启动时以清晰错误失败——非整数或小于 1 的值——绝不会静默改变行为。生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-auto-continue)记录每个受支持的值。

### 你会得到什么

按默认值，到达输出上限的步骤会收到一条点名截断与上限的续写提示，归属于插件。模型在同一轮次的新步骤中从截断点恢复；后续每次截断都会再次续写，最多 8 次，然后轮次以其记录在案的 `max-tokens` ending 结束。中间的用户消息会重置计数器，因此全新指令总能获得全新预算。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释 guard 如何决定续写以及它 steer 了什么；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

guard 建立在四项承诺之上：

- **只续写，绝不改写。** guard 通过标准 inbox steer 一条续写提示；它绝不编辑历史或合成输出，如何恢复由模型自己决定。
- **从持久数据决策。** 轮次最近一次尝试是否真的以截断收尾，是从已提交的 `assistant/*` stream 里读出来的——`turn/end` 还不能持有停止中轮次的 ending，而粘性的轮次记录本身会让已经完成回答的轮次被再次续写。
- **统计连续续写。** 由 `maxConsecutive` 封顶的每 agent 计数器约束最坏情形——每次都把预算烧在推理上的模型——而正常的长回答可在上限内自由链式续写。
- **加载时快速失败。** `maxConsecutive` 在 `apply` 中校验并抛出错误，绝不回退到默认值。

### 决策：停止边界

guard 监听 `agent/turn-stopping`，循环只在最近一步闭合了模型应答义务时才会触发它——派发过工具调用的步骤会重新打开该义务，其结果先送达模型，guard 才有机会 steer。payload 携带轮次待提交的 ending；guard 在三个事实同时成立时 steer：

- 待提交的 ending 是 `max-tokens`；
- 从会话日志倒序读出的、轮次最近一次落定的尝试以 `max-tokens` finish 收尾——正是这一步保证粘性记录不会再次续写已完成的回答；
- 每 steer 递增一次的连续计数仍在 `maxConsecutive` 之内。

续写经由 `agent.steer(...)` 进入下一步获准的输入，成为一条带插件来源的 `user/message`——模型可见、带来源归属，且无需新会话事件即可从会话日志重建。任何获准批次里出现用户来源的消息都会删除计数器（一个始终委托的 `agent/pre-step` 重置钩子），因此跨插话的续写不算同一次运行。

### 按 agent 分键

计数器保存在 `WeakMap<Agent, number>` 中；一个 agent 的续写绝不干扰另一个 agent，对象生命周期限制弱引用条目的寿命，从持久化恢复的会话以全新计数开始——恢复后轮次的第一次截断重新获得完整预算。

### 聊天提示条共享同一判定

轮末提示条由 `dsh-client-ui-chat` 拥有，而非本插件，但它回答同一个问题：续写到正常收尾的轮次虽然记录了粘性的 `max-tokens` ending，却不显示提示条；只有确实以截断结束的轮次才显示。assistant 节点从每次尝试的持久 finish 记录发布该逐次判定，stream 未携带记录时回退到记录的 ending。`AssistantChatData` 上的 `truncated` 字段就是该判定。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config` schema、快速失败校验、停止边界与重置监听器 |
| [`src/truncation.ts`](src/truncation.ts) | 对停止中轮次持久日志的输出上限判定 |
| — | 不发布运行时不变式伴生入口；续写计数器私有于一个停止边界监听器，未暴露独立伴生入口可观察的包级事件或快照。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从停止边界逐步进入穷尽式配置与 guard 组映射。

- [架构——轮次流](../../../docs/architecture.zh.md#turn-flow)——`agent/turn-stopping` 何时触发、payload 携带什么。
- [生成配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-auto-continue)——每个受支持配置字段及其源声明。
- [guard 组映射](../README.zh.md)——同组的 guard 包与循环卫生家族。

-----

<a id="model-experience"></a>
## 模型体验

### 续写上下文消息

#### 模型看到什么

到达输出上限的步骤之后，下一步的输入中会出现下面的续写提示。不会添加工具 schema 或正常轮次文本。

##### 续写提示

```markdown
Your previous response was cut off at the model output-token limit before it finished. Continue that response from exactly where it stopped: do not repeat or rephrase content the conversation already holds. If a tool call was cut off before it completed, issue the complete tool call again.
```

#### Token 影响

续写会作为该 agent 的历史记录保留，每次 steer 约 60 token，且每次续写请求都会重新发送累积的对话记录。

#### KV Cache 影响

仅追加；新出现的内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明 guard 何时不合适。它们是当前包约束，不是任务积压。

- **上限统计的是 steer 次数，不是进展**——真实推进中被截断的模型与只烧推理的模型触顶时机相同；用户消息重置是释放压力的阀门。
- **没有 provider 专属恢复协议**——续写是一条普通提示；提供原生续写 token 或 prefill 的 provider 没有被特判。
- **仅驻留内存**——计数器不跨会话重载存活；恢复后的轮次获得全新预算，重启后可再次推动触顶的模型。
- **截断的推理被保留**——部分推理块留在对话记录中并作为 reasoning content 回放，模型得以从思考中途恢复；拒绝回放部分推理的 provider 会独立于本 guard 拒绝该请求。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：开放问题与尚未决定的探索方向。它明确不具权威性——已交付的行为、限制与既定理由以上文、包代码和相关 Agent Note 为准。

auto-continue Agent Note 记录了观测到的失败（免费路由模型在手动「continue」后于第 1 步截断）以及停止边界 seam 上被否决的备选方案，包括粘性 `max-tokens` 记录不驱动 steer 决策的原因。

</details>
