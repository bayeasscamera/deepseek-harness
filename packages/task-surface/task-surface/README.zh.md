# @deepseek-ai/dsh-task-surface

[English](README.md) | 中文

面向交互式任务表面（task surface）的浏览器安全领域包：由 `tool/result` presentation meta 携带的表面模型、严格的提交校验与模型可见格式化，以及基于会话日志的活跃表面投影。

## 它做什么

工具通过在其成功的 `tool/result` 上附加 `dsh/task-surface` presentation meta —— 一个 `surfaceId` 和解析后的 `TaskSurfaceModelV1` —— 来打开任务表面。模型以 JSON 声明表面：由只读块（`markdown`、`metrics`、`table`、`diff`、`notice`）组成的 section，加上至多 `maxFields` 个输入字段（`text`、`choice`、`multi-choice`、`toggle`、`order`）和一个提交标签。Stage 1 不拥有 open/submit/dismiss 服务；它是 Stage 2 服务及其客户端赖以构建的领域。

## 解析与限额

`parseTaskSurfaceModel` / `parseTaskSurfacePresentationMeta` 拒绝未知键、重复 id、未知字段种类，以及超过 `DEFAULT_TASK_SURFACE_LIMITS`（64 KiB 模型、64 个块、32 个字段、200 表格行）的模型；每次解析都按声明字段顺序返回规范化模型，因此相同输入序列化结果完全一致。`recognizeTaskSurfacePresentationMeta` 是宽容的投影级读取：对任何缺失、未标记或畸形的有效载荷返回 `undefined`，把响亮失败的拒绝留给写入侧和包不变量。相关提交的消息源携带 `TaskSurfaceCorrelation`（`submissionId`、`callId`、`surfaceId`、`values`），由 `parseTaskSurfaceCorrelation` 解析。

## 提交校验与格式化

`validateTaskSurfaceSubmission` 返回全部问题而不是抛出：按声明顺序逐字段（缺失值回退到声明的 `initial`；既缺失又无 initial 记为 `missing-required`；`required` 是校验器从不读取的 UI 提示），然后是按 id 排序的未知键，最后是 32 KiB 提交预算 `too-large`。`formatTaskSurfaceSubmission` 把被接受的提交渲染为模型可见的转录文本 —— 标题、每个字段一行 `label: value`、去空白的备注位于空行之后 —— 且永不抛出。渲染形式：toggle 为 `on`/`off`，order 字段以 ` → ` 连接，multi-choice 以 `, ` 连接。

## 投影

`taskSurfaceProjectionDefinition` 注册 `taskSurface` 投影单元（`stateVersion` 0；在此并入 `SessionProjectionMap`）：携带可识别 presentation meta 的 `tool/result` 打开 `active`（`callId` + `surfaceId`），source kind 为 `user` 的 `user/message` 关闭它 —— 普通用户消息与相关提交一视同仁 —— `task-surface/dismissed` 也关闭它。插件注入的消息不会关闭活跃表面。

## 包不变量

`./invariant` 注册 `task-surface-invariant` 伴生插件：每个标记为 `dsh/task-surface` 的 `tool/result` meta —— 无论回放还是新派发 —— 都必须严格解析，否则不变量响亮失败。

## 导出形态

纯领域桶导出，无默认导出，Stage 1 无 Cordis 插件；`./invariant` 是本包唯一的 Cordis 表面。

## 模型体验

### Presentation meta

#### 模型看到什么

meta 本身不带来任何内容：开场回合的模型可见内容是工具自己的结果文本，而 meta 描述客户端如何渲染表面。

#### Token 效应

meta 本身无。

#### KV Cache 效应

无。

### 提交转录文本

#### 模型看到什么

`formatTaskSurfaceSubmission` 的文本成为相关提交的模型可见内容，以用户消息送达（相关性注册在 Stage 3）。

#### Token 效应

随被接受的提交增长：每个声明字段一行加备注，受 32 KiB 预算约束。

#### KV Cache 效应

只追加；转录文本位于可复用前缀之后。

## 已知限制与延期工作

- **无 Stage 2 服务** —— open/submit/dismiss（以及此处类型化的 `TaskSurfaceService` 方法）延期到 Stage 2 task-surface 服务；Stage 1 只交付领域。
- **尚无相关提交不变量** —— 针对活跃表面校验 `taskSurface` 消息源相关性，随 Stage 3 apiproxy 相关性注册一并延期。
- **无客户端渲染** —— 绘制模型并收集提交的 UI 位于本包之外。
