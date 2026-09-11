# Agent Note: task-surface 的 client 入口由 tsc 平面提供

Status: implemented

[English](2026-09-11-task-surface-client-entry-tsc-plane.md) | 中文

## 问题

`@deepseek-ai/dsh-task-surface` 在 8e199f6d12 中发布时，`exports["./client"]` 指向 `./lib/client.js`，`files` 也列出了该文件——但没有任何构建步骤会产出这个路径。宿主 tsdown 通道只把 `lib/types/{index,invariant,startup}.js` 打包进 `lib/`，client tsdown 通道只为声明了浏览器 bundle 的包构建；task-surface 并未声明。从构建产物解析 `@deepseek-ai/dsh-task-surface/client` 的 export-map 消费者找不到文件，源码平面也没有任何 `tsconfig.base.json` 别名映射该子路径。

## 决策

`exports["./client"]` 指向 `./lib/types/client.js`，并经由既有的 `lib/types/**/*.js` files 通配发布——这正是每个同族领域包（`dsh-schedule`、`dsh-plan-mode`、`dsh-token-meter`、`dsh-tool-todo`、`dsh-session-title`、`dsh-subagent`）的布局。领域 client 命名空间是对浏览器安全词汇的源码 re-export barrel；它没有浏览器 bundle，也没有需要打包的 Node 入口。这是领域包模式，而非 `packages/client/*` 插件布局——后者声明浏览器 bundle，`exports["./client"]` 指向 tsdown 产出的 `lib/client.js`（该模式由[GUI Web client architecture](2026-07-19-gui-web-client-architecture.zh.md) 拥有）。

`src/invariant.ts` 通过相对文件（`./parser.ts`、`./runtime.ts`）导入 `parseTaskSurfacePresentationMeta` 与 `TASK_SURFACE_PRESENTATION_META_KIND`，与同族 companion 插件一致；`src/client.ts` 以 `jscpd:ignore` 标记承载 barrel 子集，因为它刻意重导出根 barrel 语句的子集，查重门否则会拒绝这段重叠。

`tsconfig.base.json` 新增手写别名 `@deepseek-ai/dsh-task-surface/client`。`gen-tsconfig-paths` 只生成裸名与 `/invariant` 说明符，因此仓库中每个 `/client` 子路径别名都是手写的；新条目加入该集合。

包 README（英文与中文）在"导出形态"下记录入口划分：浏览器安全词汇在 `./client`，宿主专属的投影定义在根入口，invariant companion 在 `./invariant`。`packages/task-surface/` 组 README 三件套注册该组，`verify-subsystem-pages` 带有对应的豁免条目。包版本进入工作区发布线（`0.1.3-alpha.2`）。

## 考虑过的替代方案

**让 `./client` 指向 tsdown bundle。** 工作区 tsdown 的入口集合对每个宿主包就是 `{index,invariant,startup}`。领域 client 命名空间是纯重导出、没有 Node 消费者，打包只会产出无人加载的构建产物，而每个同族领域包早已从 `lib/types/` 提供服务。

**照搬 `packages/client/*` 插件布局。** 该布局属于声明浏览器 bundle 的包；client tsdown 通道只为它们产出 `lib/client.js`。task-surface 未声明，照搬出的入口悬空——即原始缺陷。

**通过包裸名导入 invariant 的值。** 在 `src/` 内自引用裸名会让 companion 耦合到 export map，并经别名解析到整个根 barrel，把投影模块拉进 companion 的模块图。同族 companion 都用相对文件导入。

**依赖 workspace 符号链接做源码平面解析。** 没有 `paths` 别名时，TypeScript 会经包的已构建 `lib/` exports 解析该子路径——这正是 `gen-tsconfig-paths` 要防止的产物平面泄漏；生成器的未覆盖包检查只报告裸说明符，因此手写别名是必需的。

## 后果

`@deepseek-ai/dsh-task-surface/client` 在发布包与源码平面都解析到真实文件。未来每个 `/client` 子路径都需要手写 `tsconfig.base.json` 别名；没有生成器代劳。重导出根 barrel 子集的领域 client 命名空间 barrel 保留 `jscpd:ignore` 标记。目前没有消费者导入该入口；Stage 2 task-surface 服务及其客户端是预期导入者，`./client` 入口是它们的浏览器安全接缝。

## 测试

包内 spec（`tests/invariant.spec.ts`、`tests/parser.spec.ts`、`tests/projection.spec.ts`、`tests/validator.spec.ts`）经源码平面导入检验领域逻辑；`pnpm run publint`、`pnpm run gen-tsconfig-paths -- --check` 与 `pnpm run verify-translation-pairing` 分别覆盖 export map、别名集合与双语 README 配对。
