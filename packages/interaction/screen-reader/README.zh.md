# @deepseek-ai/dsh-screen-reader

[English](README.md) | 中文

无障碍可访问性插件：将会话事件格式化为面向 VoiceOver、盲文点字显示器等辅助技术的清晰、线性、语义化纯文本流——无 ANSI 转义码、无动画加载指示、无多栏组件。提供 `/screenreader` 命令在运行时切换模式与详细度。

## 配置

```yaml
- id: screen-reader
  name: '@deepseek-ai/dsh-screen-reader'
```

无插件级配置项。无障碍模式默认处于关闭状态，通过 `/screenreader on` 手动开启。

## 行为

- `/screenreader on` — 为当前会话开启线性无障碍输出。
- `/screenreader off` — 关闭该模式，恢复标准渲染。
- `/screenreader verbose | standard | concise` — 设置播报详细度（默认 `standard`）。
- `/screenreader`（无参数） — 查看当前状态与详细度。
- `stripAnsiAndDecorations(text)` — 导出工具函数，过滤字符串中的 ANSI 代码与 Unicode 制表符。
- `formatLinearEvent(type, content, verbosity)` — 纯函数格式化轮次事件（`user`、`agent`、`tool`、`error`）：`concise` 压缩为单行带标签摘要，`standard` 播报标签后输出完整内容，`verbose` 追加显式的事件结束标记。标签为英文。

## 模型体验

### 无障碍模式事件格式化

#### 模型所见

通过 `formatLinearEvent` 传递的事件以带前缀标签的纯文本块呈现（如 `[User message]`、`[Assistant response]`），去除所有 ANSI 干扰。模型获得语义一致、线性规范化的内容。

#### Token 影响

变化极小 — 剥离 ANSI 码，保留内容。详细模式下每个事件增加一行结束标记。

#### KV Cache 影响

内容结构保持稳定，无障碍模式的开关不破坏轮次间的缓存复用。

## 已知局限与后续工作

- **仅限命令切换** — 状态仅在当前会话生效，跨会话不持久化，需每次会话重新开启。
- **未直连终端渲染器** — 插件提供格式化器与切换命令，但尚无渲染器消费；将 `formatLinearEvent` 接入终端输出管线属于后续工作。
