# @deepseek-ai/dsh-code-review

[English](README.md) | 中文

多级别自适应代码审查扩展：提供五档审查深度（`low`、`medium`、`high`、`extra-high`、`ultra`），平衡分析速度、Token 成本与深层安全漏洞挖掘需求。注册 `/review` 斜杠命令与 `code_review_audit` 模型工具。

## 配置

```yaml
- id: code-review-plugin
  name: '@deepseek-ai/dsh-code-review'
```

无插件级配置项。每次调用时通过命令或工具参数指定审查深度。

## 行为

- `/review [low|medium|high|extra-high|ultra] [path]` — 为选定级别和可选的目标文件/目录生成结构化审查提示词。
- `code_review_audit` 工具 — 返回结构化 JSON（`level`、`guidelines`、`aspects`），引导模型聚焦对应审查维度。
- 未提供级别或指定未知级别时，默认采用 `medium` 级别。

## 模型体验

### Review 命令输出

#### 模型所见

包含审查级别标签、分析范围（指定路径或当前修改）与评估维度的结构化 Markdown 块，并附带供模型执行的评估提示词。

#### Token 影响

每次 `/review` 调用开销很小，生成的提示词块约为 10–30 个 Token。

#### KV Cache 影响

每次 `/review` 调用追加新上下文，后续轮次复用之前的缓存前缀。

### code_review_audit 工具结果

#### 模型所见

工具返回 `{ level, guidelines, aspects }` 结构化 JSON。模型读取 `guidelines` 和 `aspects` 校准审查深度与聚焦点。生成的 [`code_review_audit` schema](../../../docs/tool-catalog.md#deepseek-aidsh-code-review) 载有精确的级别枚举与输出字段。

#### Token 影响

可忽略 — 工具输出为包含三个字段的紧凑 JSON 对象。

#### KV Cache 影响

工具输出追加到轮次的 assistant 消息中；后续轮次直接复用前缀缓存。

## 已知局限与后续工作

- **仅提供提示词指引** — 扩展仅生成审查指导提示词，不直接执行 AST 解析或静态测试。
- **无差异直接感知** — 工具本身不读取 git diff，需模型自行检索并分析目标文件。
- **固定分级标准** — 五档分级体系固定，自定义粒度需修改插件源码。
