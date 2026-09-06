<!-- 英文源文件的手写对侧：生成区域（cordis-surface）由 `pnpm run gen-cordis-catalog` 注入两侧且字节一致；
     更新手写内容后运行 `pnpm run verify-translation-pairing --write docs/subsystems/screen-reader.md` 重新记录配对。 -->

# 屏幕阅读器

[English](screen-reader.md) | 中文

屏幕阅读器无障碍模式由 [dsh-screen-reader](../../packages/interaction/screen-reader) 提供（`ctx.screenReader`、`ScreenReaderService`）：`/screenreader` 命令切换一个会话级模式，在该模式下轮次事件被转写为面向辅助技术的线性、语义化文本流——没有 ANSI 转义序列、没有旋转动画、没有多列组件。该模式只影响呈现：不注册任何面向模型的 schema，也不产生自己的会话事件。

来源：[`packages/interaction/screen-reader/src/index.ts`](../../packages/interaction/screen-reader/src/index.ts)

## 服务

`ctx.screenReader` 持有由 `/screenreader on | off | verbose | standard | concise` 驱动的每上下文模式状态（`enabled`、`verbosity`）。报告方读取 `state`，并通过纯函数 `formatLinearEvent(type, content, verbosity)` 渲染：`concise` 把事件折叠为一行带标签的文本，`standard` 先播报标签再输出完整内容，`verbose` 额外追加显式的事件结束标记。`Verbosity` 是封闭联合类型 `'concise' | 'standard' | 'verbose'`（默认 `standard`）；事件类别为 `user`、`agent`、`tool` 和 `error`。目前尚无终端渲染器接入该格式化器（见[包 README](../../packages/interaction/screen-reader/README.md#known-limitations-and-deferred-work)）。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxscreenreader--screenreaderservice"></a>

### `ctx.screenReader` — `ScreenReaderService`

The screen-reader service: owns the per-context accessibility-mode state the `/screenreader` command drives and reporters read.

```ts cordis-catalog
/**
 * Enable or disable linear accessibility output.
 * @param value - the new enabled state.
 */
setEnabled(value: boolean): void

/**
 * Set the narrative detail level.
 * @param value - the new verbosity level.
 */
setVerbosity(value: Verbosity): void
```

Source: [`packages/interaction/screen-reader/src/index.ts:94`](../../packages/interaction/screen-reader/src/index.ts)
<!-- END GENERATED cordis-surface -->
