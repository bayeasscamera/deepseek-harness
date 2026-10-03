---
description: "面向模型的 write_presentation 工具：把描述好的演示大纲变成会话工作区里真实的 .pptx，字节经文件系统 seam 写入。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-slides

[English](README.md) | 中文

## 概述

`dsh-tool-slides` 给模型一个工具 —— `write_presentation` —— 把结构化大纲变成 PowerPoint 包：由演示标题与副标题构成的标题页，随后每个条目一张幻灯片，由该条目指名的版式绘制，并使用调用选定的模板。包经 `ctx.fs.writeBytes` 写入，因此路径解析、写入意图防护、按目标加锁与沙箱围栏都与文本写入完全一致。工具负责模型契约与写入；OOXML 分部图由本包自己的写出器负责。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在模型需要产出演示文稿的组态里挂载本插件。它需要工具注册表与文件系统后端（`ctx.fs`）；组态挂载了沙箱策略时，策略会按每次调用读取。

### 何时调用

用户要幻灯片、演示稿或 PPT 时，模型调用 `write_presentation`。演示以标题页开场，随后每个条目一张幻灯片：版式 `bullets` 绘制标题加要点行，版式 `section` 绘制分隔标题。模板决定演示的配色、字体对与背景：`default`（中性浅色）、`dark`（深色背景、浅色文字）、`print`（白底黑字、衬线，适合讲义）；省略时按 `default` 生成。

```json
{
  "file_path": "reports/weekly.pptx",
  "title": "Rapport hebdomadaire",
  "subtitle": "Semaine 40",
  "template": "dark",
  "slides": [
    { "layout": "section", "title": "Chiffres clés" },
    { "layout": "bullets", "title": "Ventes", "bullets": ["+12% vs S39", "Pic le mardi"] }
  ]
}
```

### 模型得到什么

规范值给出文件路径、写入是新建还是替换、包的大小，以及演示共有多少张幻灯片。渲染出的文本沿用文件系统工具同样的 `<path>`/`<type>`/`<content>` 形状，于是模型在任何地方都以同一种方式读取产出的产物。

```json
{ "path": "/work/project/reports/weekly.pptx", "operation": "create", "bytes": 9834, "slides": 3 }
```

### 调用失败时

后端拒绝的路径（目录、工作区之外的目标、沙箱拒绝）会成为模型在工具结果里看到的错误。策略拒绝带有共享的 `[sandbox: file access denied under <mode> mode]` 标记，因为拒绝是要如实报告的裁决，而不是要绕过的缺陷。路径上已存在的文件会被替换，且没有先读后写的先决条件：生成的演示是本工具自己拥有的产物，不是模型正在编辑的文件。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 —— 点击展开</summary>

可观察行为见[使用本包](#use-this-package)；本节说明写出器与写入路径。

### 源码地图

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 工具注册：`write_presentation` schema、解析与写入路径、拒绝标记、调用视图 |
| [`src/pptx.ts`](src/pptx.ts) | OOXML 写出器：内容类型、关系、presentation、母版、三个版式、主题、文档属性、每张幻灯片一个分部 |
| — | 不发布运行时不变式伴随包；工具唯一的状态是它写出的包，而它写入所用的 seam 拥有该变更的生命周期。 |

### 写出的包

`.pptx` 是一个装着 XML 分部的 ZIP，写出器会产出读取方需要解析的整张图：`[Content_Types].xml` 声明每个分部的类型，`_rels/.rels` 指向 presentation 与文档属性，`ppt/presentation.xml` 列出母版与每张幻灯片，一个带版式列表、颜色映射与文本样式的母版，三个版式（`title`、`secHead`、`obj`），一个承载模板配色与字体的主题，以及每张幻灯片一个分部及其关系——各自指向该幻灯片选用的版式。母版以配色中的浅色槽绘制背景、以文字色绘制正文，这正是模板无需触碰任何一张幻灯片就能改变整份演示的原因；分隔标题使用模板的第一个强调色。文本在写入时转义，压缩包的修改时间由调用方给出的时刻固定，因此同一份演示产生同样的字节。

### 写入路径

当调用携带沙箱策略时，工具以策略的工作区根解析目标，否则使用调用会话的工作区（规范化后），并把解析出的策略传给 `ctx.fs.writeBytes`。这让生成的演示与其他任何变更处于同样的限制之下：`read-only` 拒绝它，`workspace-write` 只在会话工作区内允许它，而拒绝会以共享标记到达，而不是被换个方式重试。写入不带防护（没有 `createIfAbsent`/`replaceIfVersion` 意图），因为在同一路径重新生成演示是常态。

</details>

<a id="further-exploration"></a>
## 延伸阅读

- [工具目录](../../../docs/tool-catalog.zh.md) —— 每个随附工具的模型可见 schema。
- [文件系统子系统](../../../docs/subsystems/filesystem.zh.md) —— 本工具写入所用的 seam。
- [沙箱](../../../docs/subsystems/sandbox.zh.md) —— 决定一次写入是否被允许的策略。

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到什么

模型看到生成的 [`write_presentation` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-slides)，包括目标路径、演示标题与副标题、模板，以及每张幻灯片的版式、标题与要点行。

#### Token 影响

在工具可见的每个请求上都有固定的 schema 开销。

#### KV Cache 影响

在定义与可见性不变时前缀稳定。插件生命周期或作用域限制可能使来自该 schema 的复用失效。

### 工具调用历史与结果

#### 模型看到什么

模型的完整大纲留在助手的工具调用参数里。下一步看到渲染出的 `<path>`/`<type>`/`<content>` 块，给出文件路径、新建或替换、包大小与幻灯片数量。

#### Token 影响

参数是随数据变化的保留 token；结果无论演示多大都是固定的几行。

#### KV Cache 影响

只追加；新可见的内容接在可复用的请求前缀之后，不会使已有的 KV-cache 条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **三个预定义版式与三个模板** —— 一份演示是标题页加 `section` 与 `bullets` 幻灯片，基于 `default`、`dark` 或 `print` 构建；无法提供企业模板、调用方自己的母版、图片、演讲者备注或逐张定位。
- **只有文本，画布固定 16:9** —— 模板设定配色、字体对与背景；只设置标题与正文的字号，其余一律不设样式。
- **包是结构化验证的，而非由 PowerPoint 验证** —— 测试断言分部、关系与 XML，生成的演示能在独立读取器（`python-pptx`）与 macOS Quick Look 导入器中打开；本环境尚未在 Microsoft PowerPoint 中打开过。
- **演示只被替换，从不合并** —— 写入不带意图防护，因此在已存在的路径重新生成会直接覆盖，没有先读后写的先决条件。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文 —— 点击展开</summary>

包名取产物家族（`tool-slides`），工具名取动作（`write_presentation`），与既有的拆分一致：`tool-web` 提供 `web_search` 与 `web_fetch`。这个名字避开了仓库里已有的 `agent-tool-presentation` 插件——它讲的是工具如何呈现给模型，而不是演示文稿。

</details>
