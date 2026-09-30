---
description: "ctx.web 的 Tavily 搜索提供方：部署方如何挂载厂商原生 web 搜索，获得 LLM 答案与可移植 snippet。"
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-tavily

[English](README.md) | 中文

## 概述

有了 `dsh-web-search-tavily`，harness 可以通过 Tavily 搜索 web，获得厂商原生 LLM 答案与带可移植 snippet 的可引用来源。当部署持有 Tavily API 密钥、并希望使用 Tavily 按相关性排序的结果与可选生成答案时选择它。答案成为 `content`；每项结果把 `content` 映射为 `snippet`、`published_date` 映射为 `publishedAt`。面向模型的 `web_search` 工具位于 `dsh-tool-web`，在原生、`ptc` 与 `both` 工具呈现下行为一致，因为 PTC 传输由工具注册表拥有。

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

在已加载 web 服务的组合中挂载本提供方；它以 `tavily` 搜索提供方身份注册，因此当它是唯一可用的搜索后端时，`ctx.web.search()` 会自动解析到它——也可以用 `searchProvider: tavily` 固定。

### 何时选择

当部署持有 Tavily API 密钥、并希望使用按相关性排序的结果与可选 LLM 答案时选择此后端。密钥为空或端点基址无法解析时，提供方不可用——每次搜索调用都会以结构化错误失败。

### 最小配置

加载 web 服务与本提供方；API 密钥回退到启动环境中的 `$TAVILY_API_KEY`，其余设置都有安全默认值。把 `apiKey` 留空、由你自己导出密钥——在你提供密钥之前，提供方保持不可用。

```yaml
- name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: tavily
- name: '@deepseek-ai/dsh-web-search-tavily'
  config:
    apiKey: !!js process.env.TAVILY_API_KEY
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `apiKey` | `$TAVILY_API_KEY` | Tavily API 密钥；为空或缺失时提供方不可用 |
| `baseURL` | `https://api.tavily.com` | 端点基址；追加 `/search`。无法解析时提供方不可用 |
| `numResults` | （未设置） | 请求不含 `maxResults` 时使用的默认结果数；必须是正整数 |
| `searchDepth` | `basic` | 以 Tavily `search_depth` 发送的检索深度：`basic`、`advanced`、`fast` 或 `ultra-fast` |
| `topic` | （未设置） | 可选主题，以 Tavily `topic` 发送：`general`、`news` 或 `finance` |
| `includeAnswer` | `true` | 是否请求 Tavily 的 LLM 生成答案作为 `content` |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-web-search-tavily)是每个受支持字段及其 JSDoc 的穷尽式真源。

### 搜索返回什么

每项 Tavily 结果映射为 `WebSearchSource`：`url`、`title`、以结果 `content` 作为 `snippet`、`published_date` 作为 `publishedAt`；空白字段会被省略，因此纯来源可以只有 URL。请求的 `maxResults` 优先于已配置的默认 `numResults`，并以 `max_results` 发送给 Tavily——最终上限由服务强制执行：截断并标记。LLM 生成的 `answer` 非空时成为 `content`。

### 失败与恢复

提供方失败——HTTP 错误、网络失败、响应体无法解析或结构不符——以 `WebError` `WEB_PROVIDER_ERROR` 呈现；中止请求以 `WEB_ABORTED` 呈现。HTTP 重定向会在访问 `Location` 指向的目标之前被拒绝，并以 `WEB_PROVIDER_ERROR` 呈现。调用方按 code 路由；面向模型的 `web_search` 工具会在自己的错误包装层内把失败呈现给模型。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释提供方背后的设计决策；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

该提供方是 Tavily API 之上的薄适配器，遵循一条刻意的规则：

- **不虚构答案。** `content` 只来自 Tavily 的 `answer`；为空时省略该字段，而不是编造模型可能信任的提供方文本。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置 schema、环境变量回退、提供方注册 |
| [`src/provider.ts`](src/provider.ts) | `TavilySearchProvider`：请求分发、中止分类、结果映射 |
| [`src/types.ts`](src/types.ts) | Tavily 协议类型：`TavilySearchResponse`、`TavilyResult`、`TavilyError` |
| — | 不发布运行时不变式伴生入口；约定在服务处强制执行。 |

### 请求与映射流程

`search()` 以 `redirect: 'error'` 把查询、`max_results`、`include_answer`、`search_depth` 与可选 `topic` POST 到 `{baseURL}/search`（密钥同时放在请求体的 `api_key` 字段与 `Bearer` 请求头），因此重定向会在不接触目标的情况下使请求失败。解析后的 `results[]` 逐项映射，服务在返回路径上应用最终的 `maxResults` 上限。中止——名为 `AbortError` 的 `DOMException`——变为 `WEB_ABORTED`；其余情况变为 `WEB_PROVIDER_ERROR`。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从共享词汇逐步进入服务、面向模型的工具与设计依据。

- [web 子系统](../../../docs/subsystems/web.zh.md)——穷尽式的搜索请求／结果词汇与错误码。
- [web 包映射](../README.zh.md)——家族与各角色。
- [dsh-web](../web/README.zh.md)——本提供方注册进入的 web 服务。
- [dsh-tool-web](../tool-web/README.zh.md)——渲染本提供方来源的面向模型 `web_search` 工具（原生与 PTC 模式一致）。
- [生成配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-web-search-tavily)——每个受支持配置字段及其源声明。
- [web 能力 seam 决策](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.zh.md)——搜索与抓取为何共用一项提供方选择服务。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过 `dsh-tool-web`：该工具保留本提供方经 `maxResults` 限制的答案、URL、标题、内容与发布日期，或将确切的错误消息 `Tavily search aborted`、`Tavily search request failed: <error>` 和 `Tavily returned an unprocessable response body: <error>` 保留在消费方的错误包装层内。

#### KV Cache 影响

不会直接导致 KV Cache 失效；请求前缀变更由上述消费方负责。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明提供方在哪些情况下不合适。它们是当前包约束。

- **没有跨批量原生搜索计数器**——工具的 `searchMaxQueries` 约束的是 `ctx.web.search` 调用次数，而 Tavily 每次调用内部自行检索；由于服务不知道提供方内部单元，部署方通过消费方与提供方两套设置控制成本。
- **只公开 `numResults`／`searchDepth`／`topic`／`includeAnswer`**——Tavily 的其他控制项（时间范围、日期界限、域名包含／排除、全文内容、图片、favicon）等待提供方无关的服务字段（见 [seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.zh.md)）。
- **按错误形状分类中止**——只有名为 `AbortError` 的 `DOMException` 才映射为 `WEB_ABORTED`；携带自定义原因的中止（例如 `dsh-timeout` 的 `TimeoutReason`）呈现为 `WEB_PROVIDER_ERROR`。

### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 未发布伴随包。本提供方只向 web 服务注册一个搜索来源，没有独立的事件序列或可变数据关系，其职责由所属 seam 上的契约约束。
