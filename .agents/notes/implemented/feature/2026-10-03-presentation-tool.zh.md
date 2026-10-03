# Agent Note: A presentation tool over the binary write

Status: implemented

[English](2026-10-03-presentation-tool.md) | 中文

## Problem

这个 harness 能描述文件、编辑文件、读取任何文件，却无法产出非文本的产物：文件系统 seam 只能写字符串，而这一版要求集成式的、基于预定义版式的 PowerPoint 生成。让工具去调用 Python 库算不上集成；把 base64 交给模型，则等于让模型搬运它根本不会读的字节。

## Decision

`packages/office/tool-slides` 提供 `write_presentation`。这个包拥有两半。`src/pptx.ts` 是纯写出器：输入一份由标题、可选副标题与内容幻灯片构成的演示，输出完整 OOXML 包的字节——`[Content_Types].xml`、包关系、列出母版与每张幻灯片的 `ppt/presentation.xml`、一个带版式列表/颜色映射/文本样式的母版、三个版式（`title`、`secHead`、`obj`）、一个承载演示模板的主题、文档属性，以及每张幻灯片一个分部及其关系，各自指向该幻灯片选用的版式。模板（`default`、`dark`、`print`）同时是配色、字体对与背景：主题承载这些值，母版以配色中的浅色槽绘制背景，因此模板无需触碰任何一张幻灯片就能改变整份演示，而分隔标题使用模板的第一个强调色。文本在写入时转义，压缩包的修改时间由调用方给出的时刻决定，因此同一份演示产生同样的字节。`src/index.ts` 是模型契约：模型填写的 schema、解析与写入路径，以及拒绝标记。

工具解析目标的方式与文件系统工具完全一致——调用携带沙箱策略时用策略的工作区根，否则用调用会话的工作区（规范化后）——并经由上一阶段加入的二进制变更 `ctx.fs.writeBytes` 写入。这正是它让产物成为一等工作区文件的原因：写入意图防护、按目标加锁、原子发布与沙箱围栏全都生效，策略拒绝会以共享的 `[sandbox: file access denied under <mode> mode]` 标记到达模型，而不是被当作换个方式重试的理由。写入不带意图，因为在同一路径重新生成演示是常态。

**工具自己的测试发现了围栏缺口，这次改动把它补上。** `SandboxedFileSystem` 围住了 `writeText` 与 `editText`，却从基类继承了 `writeBytes`：在 `read-only` 下，二进制写入竟然落盘。后端现在用同样的 `checkedTarget` 围栏覆写 `writeBytes`，其测试套件在文本用例旁边覆盖了拒绝、工作区内允许与全权放行三种情形。

包名取 `tool-slides` 而非 `tool-presentation`，因为本仓库已把那个词用于另一件事：`@deepseek-ai/dsh-agent-tool-presentation` 决定 agent 是以原生、PTC 绑定还是两者兼有的方式看到工具，而 cordis preset 已经占用了插件 id `tool-presentation`。面向模型的工具保留更清晰的名字 `write_presentation`，与既有的拆分一致：`tool-web` 提供 `web_search` 与 `web_fetch`。

## Alternatives considered

**用 pptxgenjs 作为写出器。** 这个维护良好的库能产出保真度远高于这里三个版式的演示，并且能删掉整段分部图代码。它输在体积与契合度：解包后 2.6 MB、带四个传递依赖（其中 `jszip` 正是本仓库在为会话日志导出选择 `fflate` 时已经权衡并否决过的），却要为一个人设就是「模板与预定义版式」的工具装进每一次安装。为查看器选择自研解析器而非 mammoth 与 SheetJS 的同一套理由，在这里反向成立。

**给现有的 `write` 工具加一个 base64 参数。** 不需要新工具、新包，模型也已经熟悉 `write`。它输在让模型成为传输通道：演示的字节会以 base64 穿过模型上下文，为它从不阅读的内容付 token，而且参数一旦被截断就会产出损坏的文件而不是一个错误。

**用一个 skill 调外部命令产出演示。** 仓库里已经有驱动用户环境中 `python-pptx` 或 `pptxgenjs` 的 PowerPoint skill。它输在「集成」二字：这一版要求产品内置的生成能力，而 skill 取决于用户机器上恰好装了什么，既没有沙箱策略的集成，也没有持久的产结果元数据。

**把包命名为 `tool-presentation`。** 最直觉的名字，也是第一次尝试用的名字。它输在这个 id 在 preset 命名空间里与 `agent-tool-presentation` 冲突，并让每个读者都要停下来分辨同一个词的两个无关含义。

## Consequences

agent 现在可以在会话工作区内产出 PowerPoint 产物，并享有与其他任何写入相同的隔离；产出的文件会出现在该轮的 deliverables 行里，因为客户端的变更词汇表学会了新的工具名。代价是自有代码面：写出器是本仓库的代码，其保真度就是这三个版式与三个模板所提供的——没有调用方自己的企业模板、没有图片、没有演讲者备注、没有逐张定位。验证是结构化的（分部、关系、XML 良构性、字节确定性），加上在测试套件之外运行的两个独立读取器：`python-pptx` 能打开生成的演示并读出其幻灯片，macOS Quick Look 导入器能渲染它；本环境尚未在 Microsoft PowerPoint 中打开过，包 README 把这一点记为限制。名单快照与 SDK 的 expected-tools 断言在同一次改动中更新，因为新增工具是模型可见的变化。
