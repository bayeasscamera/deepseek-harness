---
description: "浏览器安全的 task-surface 领域：surface 模型、提交校验以及覆盖会话日志的 active-surface 投影。"
kind: "package-reference"
---

# @deepseek-ai/dsh-task-surface

[English](README.md) | 中文

## 概述

交互式 task surface 的浏览器安全领域层：由 `tool/result` 呈现元数据携带的 surface 模型、严格的提交校验与模型可见格式化，以及覆盖会话日志的 active surface 投影。

## 目录

- [功能说明](#what-it-does)
- [解析与限制](#parsing-and-limits)
- [提交校验与格式化](#submission-validation-and-formatting)
- [投影](#projection)
- [包不变量](#package-invariant)
- [导出形态](#export-shape)
- [Model Experience](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="what-it-does"></a>
## 功能说明

工具通过在其成功的 `tool/result` 上附加 `dsh/task-surface` 呈现元数据（`surfaceId` 与解析后的 `TaskSurfaceModelV1`）来打开一个 task surface。模型以 JSON 声明 surface：只读块区域（`markdown`、`metrics`、`table`、`diff`、`notice`）外加最多 `maxFields` 个输入字段（`text`、`choice`、`multi-choice`、`toggle`、`order`）和提交标签。Stage 1 不包含打开/提交/关闭服务；它是 Stage 2 服务及其客户端构建的基础领域。

<a id="parsing-and-limits"></a>
## 解析与限制

`parseTaskSurfaceModel` / `parseTaskSurfacePresentationMeta` 拒绝未知键、重复 id、未知字段种类以及超出 `DEFAULT_TASK_SURFACE_LIMITS`（64 KiB 模型、64 个块、32 个字段、200 行表格）的模型；每次解析按声明字段顺序返回归一化模型，确保相同输入序列化完全一致。`recognizeTaskSurfacePresentationMeta` 是宽容的投影级读取：遇到缺失、未标记或畸形内容返回 `undefined`，将大声失败留给写端和包不变量。相关提交源携带 `TaskSurfaceCorrelation`（`submissionId`、`callId`、`surfaceId`、`values`），由 `parseTaskSurfaceCorrelation` 解析。

<a id="submission-validation-and-formatting"></a>
## 提交校验与格式化

`validateTaskSurfaceSubmission` 返回所有问题而不是抛出异常：按声明顺序检查每个字段（缺失值回退到声明的 `initial`；缺失且无 initial 为 `missing-required`；`required` 是校验器不读取的 UI 提示），接着按 id 排序检查未知键，最后检查 32 KiB 提交预算超限（`too-large`）。`formatTaskSurfaceSubmission` 将接受的提交渲染为模型可见的转录文本——标题、每个字段一行 `label: value`、空行后截断后的备注——且绝不抛出异常。渲染形态：toggle 为 `on`/`off`，order 字段用 ` → ` 连接，multi-choice 用 `, ` 连接。

<a id="projection"></a>
## 投影

`taskSurfaceProjectionDefinition` 注册 `taskSurface` 投影单元（`stateVersion` 0；合并入此处的 `SessionProjectionMap`）：携带可识别呈现元数据的 `tool/result` 打开 `active`（`callId` + `surfaceId`），来源为 `user` 的 `user/message` 关闭它——普通用户消息与相关提交一视同仁——`task-surface/dismissed` 也关闭它。插件注入的消息不关闭活跃表面。

<a id="package-invariant"></a>
## 包不变量

`./invariant` 注册 `task-surface-invariant` 伴随插件：每个标记为 `dsh/task-surface` 的 `tool/result` 元数据——无论是重放还是新派发——都必须严格通过解析，否则不变量将大声失败。

<a id="export-shape"></a>
## 导出形态

纯领域 barrel，Stage 1 中无默认导出，亦无 Cordis 插件；`./invariant` 是该包唯一的 Cordis 表面。浏览器安全词汇——类型、运行时常量、限额、解析器与校验器——由 `@deepseek-ai/dsh-task-surface/client` 入口提供给客户端代码，后者只从 client 命名空间导入；宿主专属的投影定义保留在根入口。

## Model Experience

### Presentation meta

#### What the model sees

Nothing from the meta itself: the opening turn's model-visible content is the tool's own result text, while the meta describes how clients render the surface.

#### Token effect

None from the meta itself.

#### KV Cache effect

The presentation meta attaches to the tool result payload and preserves the model request prefix.

### Submission transcript

#### What the model sees

The `formatTaskSurfaceSubmission` text becomes the correlated submission's model-visible content, delivered as a user message (correlation registration is Stage 3).

#### Token effect

Grows with the accepted submission: one line per declared field plus the note, bounded by the 32 KiB budget.

#### KV Cache effect

Append-only; the transcript follows the reusable prefix.

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **无 Stage 2 服务** —— open/submit/dismiss（以及此处类型化的 `TaskSurfaceService` 方法）延期到 Stage 2 task-surface 服务；Stage 1 只交付领域。
- **尚无相关提交不变量** —— 针对活跃表面校验 `taskSurface` 消息源相关性，随 Stage 3 apiproxy 相关性注册一并延期。
- **无客户端渲染** —— 绘制模型并收集提交的 UI 位于本包之外。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
