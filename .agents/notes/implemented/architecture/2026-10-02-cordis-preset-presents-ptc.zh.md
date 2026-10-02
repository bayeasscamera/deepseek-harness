# Agent Note: cordis preset 现在以 PTC 模式呈现

Status: implemented

[English](2026-10-02-cordis-preset-presents-ptc.md) | 中文

## 问题

随包发布的 `cordis` preset——那个能读写自身运行时的编码 agent——直接挂载面向模型的工具注册表，而随包发布的 `ptc` preset 把同一注册表放在呈现层之后，后者把它变成由 `run_code` 驱动生成的 SDK。因此两个 preset 对"agent 可以调用什么"给出的答案不同，而读者无法判断这种差异是不是有意为之。

## 决策

`packages/preset/agent-presets/presets/cordis/agent.cordis.yml` 组合与 PTC preset 相同的呈现行：`mode: ptc` 的 `tool-presentation`。该行等待宿主的 `codeRuntime`：若部署没有组合 TypeScript 运行时，preset 会在挂载时失败并指名该行，而不是在第一次请求时才失败。

由于 PTC 让 `run_code` 成为唯一的模型自建编排接口，preset 中通用的 `workflow` 工具行也随之禁用。`workflow-worker-thread` 与 `tool-ralph` 保持启用：Ralph 的固定新代理循环消费这个引擎，却不会发布第二种编排语言——与归档的 [PTC preset 省略通用 workflow 工具](../../archived/simplification/2026-09-01-ptc-omits-workflow-tool.md) 为 `ptc` 记录的理由相同。

因此省略规则由呈现面定义，而不是由 preset id 定义：**发布了 PTC 呈现的随包 preset 会省略通用 `workflow` 工具**，未发布呈现层的 preset 则保留它。preset 测试断言的正是这种形式，并同时校验它所依据的呈现行，于是下一个呈现 PTC 的 preset 会自动继承这条规则，测试无需再改第二次。

两个 PTC 呈现 preset 共享的行——结果截断上限、指令上限、可选 subagent 提供方、Ralph 轮次、搜索超时、glob 采样——作为同一套发布，因此无论加载哪一个，agent 的行为一致；`standard` 保留更小的截断上限和它的 `workflow` 工具。

## 考虑过的替代方案

**让 `cordis` 不带呈现层。** 那样读写自身运行时只能通过普通工具列表触及，PTC 模式也只是独立存在的另一个 preset，而这本该由组合本身解释的差异反而无处说明。

**让 `workflow` 与 `run_code` 并存。** 两种模型自建编排语言，执行语义不同；上面那篇归档笔记已经记录了对 `ptc` 的否定，而 `cordis` 一旦以 PTC 呈现，同样的理由同样成立。

**让测试按 preset id 匹配。** 它今天能通过，却会悄悄漏掉下一个呈现 PTC 的 preset——这条规则正是因此写了两遍。

## 后果

挂载 `cordis` preset 的部署现在需要宿主的 `codeRuntime`；没有它时 preset 拒绝挂载，而不是退化到第一次请求才出问题。`cordis` 与 `ptc` 生成的 SDK 不包含 `workflow` 绑定，但保留 `ralph`。PTC 选择器的描述与随包 preset 测试仍然表明 `standard` 会发布 `workflow`，而任何把 `tool-presentation` 以 `mode: ptc` 挂载的自定义 preset 也应当禁用自己的 `workflow` 行。
