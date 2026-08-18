# @deepseek-ai/dsh-prompt-budget

[English](README.md) | 中文

DeepSeek Harness agent 的 prompt 预算可观测性：用 token-meter 的固定密度启发式为每次组装的 system prompt 计价，并发出按部分拆分的 breakdown 事件，使部署在调整各组件预算之前就能看到请求 token 的去向。纯观测——绝不裁剪、重排或拒绝任何组装。

## 观察者

`apply()` 监听 `system-prompt/assemble` waterfall，先委托，再用 `priceAssembly()` 为解析后的组装计价，发出 `prompt-budget/breakdown`，并原样返回组装。breakdown 监听器失败会被吞掉，因此可观测性绝不阻塞模型请求。

breakdown 以与 `@deepseek-ai/dsh-token-meter` 相同的每 4 字符一 token 密度为组装的每一部分计价——sections、动态 contexts、工具 schema 与已定义变量——外加固定的每部分结构开销，并汇总为 `total`。

## Model Experience

无，因为观察者不贡献任何 prompt、工具或会话事件；它只发出面向 host 的 breakdown 事件。

#### KV Cache 影响

无直接影响。观察者从不改变组装后的 prompt，因此不会使任何请求前缀失效。

## 已知限制与暂缓事项

- **启发式计价** — 估算是固定密度近似而非精确 tokenizer 计数；与 token meter 一致，但各模型的分词可能不同。
- **不做强制** — 插件只报告；需要硬性上限的部署应将此 breakdown 与各组件预算（`maxRules`、`maxRecall`、`maxBytes`、`tools.restrict()`）组合使用。
