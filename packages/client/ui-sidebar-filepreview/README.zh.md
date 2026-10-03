---
description: "dsh Web 客户端右侧 Sidebar 的富预览 tab 类型：按字节窗口读取工作区的图片、PDF、HTML 页面、分隔符表格，以及 Word、Excel 与 PowerPoint 文档，位于文本查看器兜底认领之上。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar-filepreview

[English](README.md) | 中文

## 概述

右侧 Sidebar 的富预览：一个工作区文件，按窗口逐段读取字节，然后要么发布为一个 object URL（交给浏览器自行绘制），要么转换成渲染器需要的东西：分隔符文本与工作簿变成行，Word 文档变成静态 HTML，演示文稿变成每页的文本。图片、PDF 与 HTML 页面由浏览器绘制；表格与转换出的文档由本包绘制。它在 `builtin` 档认领 basename 带有所支持扩展名的文件地址，位于文本查看器对每个文件地址的 `fallback` 认领之上，于是只有它能绘制的格式离开文本查看器，其余一切原样落在那里。与所有在 `ui-sidebar-right` 之外交付的 tab 类型一样：来自 Sidebar 的每个 import 都是类型，文件的元数据来自共享的 `file` 资源，字节是类型自己的事，类型的控件住在自己的体里。

## 目录

- [注册了什么](#what-it-registers)
- [地址](#addresses)
- [怎么读](#how-it-reads)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="what-it-registers"></a>
## 注册了什么

- **类型** —— `ctx.sidebarRightTabs.register(...)`，id 为 `@deepseek-ai/dsh-client-ui-sidebar-filepreview`（这个实现在 tab 系统里的唯一键，也是其体注册所用的 key），kind `preview`，每个可绘制的扩展名一个 pattern（`*.png`、`*.jpg`、`*.jpeg`、`*.gif`、`*.webp`、`*.avif`、`*.bmp`、`*.ico`、`*.svg`、`*.html`、`*.htm`、`*.pdf`、`*.csv`、`*.tsv`、`*.xlsx`、`*.docx`、`*.pptx`），档位 `builtin`。不认领任何更宽的东西：扩展名列表没有列出的文件仍归文本查看器。整个地址就是内容身份，所以不同目录下同名的两个文件、或同一路径在两个会话之下，是两个 tab；解码后的 basename 是 tab 标题。
- **体** —— keyed 坑位 `sidebar.right.pane.tab`，键为类型的 id。它的头部行显示 Host 的绝对路径（元数据到达前显示请求路径），并在提示中保留完整值，末端是类型唯一的控件：重新载入按钮。Sidebar 的 tab 条不承载这个类型的任何控件。体占满 pane 体的全部高度：头部行不动，绘制的文件填满其余空间——图片按比例居中留边，PDF 与 HTML 页面填满 pane 并自己负责滚动。
- **一个 store 与一个 face**，会话作用域，按 tab id 分桶。store 保存字节发布所用的 object URL、总字节数、路径解析出的格式，以及进行中的载入或它的失败。face（`load`、`reload`）执行读取、构建 Blob 及其 URL，并通过 store 的动作写入。当属主的 `signal` 中止（即 tab 记录消失）时，桶被遗忘、URL 被吊销。

<a id="addresses"></a>
## 地址

tab 的地址是 `dsh-resource://file/session/<sessionId>/<相对该会话工作区根的路径>` 或 `dsh-resource://file/absolute/<去掉前导斜杠的绝对路径>`，由 `@deepseek-ai/dsh-util-workspace-path` 的 `fileAddressFor` 构建、`parseFileAddress` 读回；`rpc.ts` 的 `hostFileOf` 把它变成端点接收的会话与路径。`session` 地址在它指名的会话下读取；`absolute` 地址在坑位挂载的会话下读取，且仍受 Host 的工作区限制。畸形的地址会抛错，因为注册表只会把与该类型 pattern 匹配过的地址送进来，而调用方构建地址时应当使用辅助函数。

<a id="how-it-reads"></a>
## 怎么读

体通过 `useTabInfo().tab` 读取自己的记录；绘制所用的媒体类型来自文件扩展名（`media.ts` 的 `previewFormatOf`，不区分大小写）。内容来自 Host：

- `useResource<'file'>(tab.contentId)`，来自 `@deepseek-ai/dsh-client-resources` 的标准 hook，通过 `@deepseek-ai/dsh-api-workspace-files` 的 `file` 提供者给出 `{ absolutePath, version, bytes, changed }`；这里只读取 `absolutePath` 用于头部。
- 字节来自 `remote.workspaceFiles.readBytes(sessionId, path, { offset }, signal)`，在 `rpc.ts` 绑定、由 face 调用。每次调用只请求位置、绝不请求长度，于是窗口大小是 Host 配置的上限，也不会因请求超出而被拒。窗口一直读到 Host 报告文件结束，拼接后按格式的媒体类型发布为一个 Blob 及其 object URL。`file-preview/too-large` 失败表示文件超出查看器自身的总量上限（32 MiB，`MAX_PREVIEW_BYTES`）；既没有字节也没有文件结束的窗口以 `file-preview/unreadable` 失败，而不是死循环。
- **绘制** —— 图片用 `<img>`；HTML 页面用 `<iframe sandbox="allow-scripts">`，页面保留脚本，同时处于不透明源，无法触及本应用、打开弹窗或提交表单；PDF 用 `<embed type="application/pdf">`，交给浏览器自带的查看器。PDF 元素需要桌面构建启用 Chromium 的 PDF 查看器；见下文限制。
- **转换** —— `.csv` 与 `.tsv` 解析成行（`delimited.ts`）；`.xlsx`、`.docx`、`.pptx` 按它们本来的样子打开——装着 XML 分部的 ZIP（`ooxml.ts`）——再由承载内容的分部读出：工作簿的共享字符串与工作表变成一张张行表，文档正文变成段落、标题、强调与表格（HTML），演示文稿的每张幻灯片变成若干段落。转换出的文档用 `<iframe sandbox="">` 绘制——完全不允许脚本——因为它的 HTML 是本包自己的输出。无法按扩展名读取的字节以 `file-preview/malformed` 失败，而不是什么都不画。转换在 face 中每次载入执行一次，作用于整个文件。
- **重新载入** —— 头部控件吊销该 tab 已发布的 URL，丢弃载入结果，再从第一个字节读起。重新载入会作废仍在途的读取：face 为每个 tab 记一个载入代次，来自旧代次的落地不写入任何东西。失败的载入按代码各给一句话（`workspace-file/not-found`、`outside-workspace`、`not-regular-file`、`too-large` 表示 Host 窗口超出其上限；`file-preview/unsupported`、`too-large`、`unreadable` 是这个查看器自己的拒绝），其余交给传输层自己的消息，并提供重试（即重新载入）。

文案来自 `sidebarFilepreview` locale 命名空间。

<a id="model-experience"></a>
## 模型体验

无：本预览是纯浏览器查看器，不注册任何工具、提示词 section 或会话事件。

#### KV Cache 影响

没有直接影响；读者在这里看到的内容从不进入模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **整个文件都放在内存里。** 构建 Blob 或执行转换前会拼接所有窗口，因此预览存活期间的开销约为文件大小，超过 32 MiB 一律拒绝；没有流式读取，也没有跳转。
- **HTML 预览中的相对资源不会解析。** frame 的 base 是 object URL，所以引用同级文件的页面会缺图缺样式；这个预览服务的是自包含页面（内联样式与脚本）。
- **媒体类型只看扩展名。** Host 传字节时不带 content type，查看器也不做嗅探，所以名不副实的文件会按错误的类型绘制，表现为坏图或空 frame。
- **桌面应用中的 PDF 需要 Chromium 的 PDF 查看器。** 桌面构建为此启用了插件开关；尚未在打包构建上验证。
- **Office 预览保留的是文本，不是版式。** 转换出的文档会丢掉编号、样式、图片、脚注与定位；演示文稿只给出幻灯片文本，没有形状与主题；工作簿里的日期保持单元格存储的序列号，因为解释它们的数字格式不会被读取。每张工作表最多 500 行、40 列，分隔符文件同样如此，超出的部分会在表格下方说明。
- **除重新载入外没有别的控件。** 没有缩放、旋转、翻页或下载入口；PDF 的查看器外观由浏览器自带。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文 —— 点击展开</summary>

无。

</details>

**Runtime invariant:** 不发布伴随包。本类型唯一的运行时状态是每个 tab 一个 Slot store，由拥有它的 face 写入，并在 tab 的中止信号上被遗忘；不存在可供比对的第二份观察。
