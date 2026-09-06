# Screen Reader

English | [中文](screen-reader.zh.md)

The screen-reader accessibility mode is owned by [dsh-screen-reader](../../packages/interaction/screen-reader) (`ctx.screenReader`, `ScreenReaderService`): the `/screenreader` command toggles a per-session mode under which turn events are transcribed as a linear, semantic text stream for assistive technology — no ANSI escape sequences, no spinners, no multi-column widgets. The mode is presentation-only: it registers no model-facing schema and no session events of its own.

Source: [`packages/interaction/screen-reader/src/index.ts`](../../packages/interaction/screen-reader/src/index.ts)

## The service

`ctx.screenReader` owns the per-context mode state (`enabled`, `verbosity`) that `/screenreader on | off | verbose | standard | concise` drives. Reporters read `state` and render through the pure `formatLinearEvent(type, content, verbosity)` formatter: `concise` collapses an event to one labelled line, `standard` announces the label then the full content, and `verbose` adds an explicit end-of-event marker. `Verbosity` is the closed union `'concise' | 'standard' | 'verbose'` (default `standard`); event categories are `user`, `agent`, `tool`, and `error`. No terminal renderer consumes the formatter yet (see the [package README](../../packages/interaction/screen-reader/README.md#known-limitations-and-deferred-work)).

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
