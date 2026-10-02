---
description: "Web GUI 的法语语言包：fr locale 与每个客户端命名空间的完整法语词典，面向希望使用法语界面的用户。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-locale-fr

[English](README.md) | 中文

## 概述

`dsh-client-locale-fr` 为 web GUI 增加法语：注册 `fr` locale（回退到英语，绝不回退到其他语言），并为每个客户端命名空间提供一份完整的法语词典；在“设置 → 常规”中选择 Français 后，整个界面以法语渲染。面向法语用户部署时保留它；法语浏览器会在已存偏好到达之前临时选用它。本包只负责界面文案：agent 的回复遵循 agent preset 的人设，与本包无关。

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

web-app bundle 已在 `dsh-client-locale` 旁边挂载本包，无需配置。打开“设置 → 常规”并选择 Français。选择立即生效，并以 `locale.preference` 持久化到用户设置文档。

### 何时选择

面向法语用户时保留本包挂载。移除该行会把 Français 从语言选择器中隐藏，正在使用法语的会话回到浏览器／默认 locale；其他一切不变。

### 本包注册什么

一个 `fr` 语言定义（`Français`，回退 `en`）与 35 份法语词典，覆盖全部客户端命名空间：`common`、`settings`、`settings.locale`、`settings.theme`、`settings.models`、`settings.plugins`、`settings.pluginInventory`、`settings.agentPreset`、`settings.permission`、`permission.access`、`chat`、`conversation`、`trajectory`、`skill`、`subagent`、`model`、`question`、`feedback`、`sidebar`、`sidebarFiles`、`sidebarRight`、`sidebarTextpreview`、`workspace`、`reference`、`directory-browser`、`open-in-app`、`approval`、`plan`、`goal`、`job`、`schedule.catalog`、`workflowRun`、`deliverables`、`command` 与 `slash.menu`。

### 失败与恢复

法语表中缺失的键在查找时经英语回退解析；未知键按原样显示键名。注册是事务性的：若某份词典遇到竞争归属，已安装的全部回滚，激活明确报错，不会留下半份法语。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释本包背后的设计决策；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

本包遵循 locale 服务文档化的语言包扩展点，并坚持两条刻意的规则：

- **英语回退，绝不回退到其他语言。** `fr` 定义声明 `en` 为回退，回退链终止于英语，因此未翻译的键读作英语——最不可能读其他已发布语言的读者。
- **要么整体，要么没有。** 定义与全部 35 份词典安装在同一个 effect 内并可回滚：失败的激活不会占据半份法语。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | Node 半侧：空 apply，使插件出现在宿主组装中 |
| [`src/client/index.ts`](src/client/index.ts) | 浏览器半侧：`fr` 定义加每个命名空间一次 `register` |
| [`src/client/dicts-core.ts`](src/client/dicts-core.ts) | 外壳与设置命名空间的法语表 |
| [`src/client/dicts-chat.ts`](src/client/dicts-chat.ts) | 会话命名空间的法语表 |
| [`src/client/dicts-shell.ts`](src/client/dicts-shell.ts) | 侧栏、工作区与工具外壳命名空间的法语表 |
| — | 不发布运行时不变式伴生入口；约定在服务处强制执行。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从 locale 约定逐步进入客户端栈与本地化决策。

- [dsh-client-locale](../locale/README.zh.md)——本包扩展的 locale 服务：偏好、浏览器回退与语言包扩展点。
- [Client 组映射](../README.zh.md)——本包所属的浏览器半侧。
- [Locale 归属的客户端 UI 文案](../../../.agents/notes/implemented/architecture/2026-08-23-locale-owned-client-ui-copy.zh.md)——产品文本为何经带类型的词典传递。
- [用法语回答](../../../docs/user/guide/french.zh.md)——配套的 agent 侧语言设置：法语 preset 让回复跟随界面。

-----

<a id="model-experience"></a>
## 模型体验

无。法语语言包属于浏览器侧 UI 插件层，不注册任何面向模型的内容。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明法语包在哪些方面不完整。它们是当前包约束。

- **Agent 回复是另一个层面**——本包翻译界面；模型写什么遵循 agent preset 的人设。请配合[法语 preset 指南](../../../docs/user/guide/french.zh.md)使用。
- **没有法语复数规则或双向布局**——注册表提供选择、持久化、浏览器匹配、键回退与 `<html lang>`；词典之外的语言行为属于更丰富的包。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 未发布伴随包。法语定义与其 35 个词典没有独立的事件序列或可变数据关系；注册释放与键回退由行为规格断言。
