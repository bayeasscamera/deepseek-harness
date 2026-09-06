# @deepseek-ai/dsh-design-artboard

[English](README.md) | 中文

UI 设计画板扩展：在将代码正式合并前，在 `.dsh/artboards/` 中创建、管理和预览交互式 HTML/Tailwind 组件预览。注册 `/design` 斜杠命令与 `design_create_artboard` 模型工具。

## 配置

```yaml
- id: design-artboard
  name: '@deepseek-ai/dsh-design-artboard'
```

无插件级配置项。画板存储目录固定为项目根目录下的 `.dsh/artboards/`。

## 行为

- `/design list` — 列出 `.dsh/artboards/` 中所有保存的画板 HTML 文件。
- `/design new <name> [html]` — 创建新画板文件，支持内联 HTML 内容，并自动包裹 Tailwind 暗色预览外壳。
- `/design show <name>` — 显示保存的画板文件前 1000 字符及绝对路径。
- `design_create_artboard` 工具 — 保存画板并返回绝对路径，便于模型进行后续操作。

## 模型体验

### 画板创建工具结果

#### 模型所见

`design_create_artboard` 工具接收 `name`、可选 `title` 和 `content`（HTML/Tailwind）。成功时返回 `{ success: true, filePath }`，指向生成的预览文件。生成的 [`design_create_artboard` schema](../../../docs/tool-catalog.md#deepseek-aidsh-design-artboard) 载有精确的参数集。

#### Token 影响

可忽略 — 工具输出为包含两个字段的紧凑 JSON 对象。

#### KV Cache 影响

画板创建不注入持久上下文。文件路径可在后续消息中直接引用。

### Design 命令列表

#### 模型所见

`/design list` 返回画板名称与文件路径的 Markdown 列表，未找到画板时返回使用提示。

#### Token 影响

与保存的画板数量成正比，每项占用约 60–120 字符。

#### KV Cache 影响

命令输出追加到会话历史，后续轮次复用之前的缓存前缀。

## 已知局限与后续工作

- **依赖 CDN** — 画板 HTML 默认通过 CDN 加载 Tailwind；离线环境需本地构建支持。
- **无热重载** — 画板文件为静态快照，内容变更需重新执行创建命令。
- **输出目录固定** — `.dsh/artboards/` 目录路径目前不可配置。
