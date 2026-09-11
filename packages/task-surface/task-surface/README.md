---
description: "Browser-safe task-surface domain: surface models, submission validation, and active-surface projection over the session log."
kind: "package-reference"
---

# @deepseek-ai/dsh-task-surface

English | [中文](README.zh.md)

## Summary

Browser-safe domain for interactive task surfaces: the surface model carried by `tool/result` presentation meta, strict submission validation and model-visible formatting, and the active-surface projection over the session log.

## Table of Contents

- [What it does](#what-it-does)
- [Parsing and limits](#parsing-and-limits)
- [Submission validation and formatting](#submission-validation-and-formatting)
- [Projection](#projection)
- [Package invariant](#package-invariant)
- [Export shape](#export-shape)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="what-it-does"></a>
## What it does

A tool opens a task surface by attaching the `dsh/task-surface` presentation meta — a `surfaceId` and the parsed `TaskSurfaceModelV1` — to its successful `tool/result`. The model declares the surface as JSON: sections of read-only blocks (`markdown`, `metrics`, `table`, `diff`, `notice`) plus up to `maxFields` input fields (`text`, `choice`, `multi-choice`, `toggle`, `order`) and a submit label. Stage 1 owns no open/submit/dismiss service; it is the domain the Stage 2 service and its clients are built on.

<a id="parsing-and-limits"></a>
## Parsing and limits

`parseTaskSurfaceModel` / `parseTaskSurfacePresentationMeta` reject unknown keys, duplicate ids, unknown field kinds, and models exceeding `DEFAULT_TASK_SURFACE_LIMITS` (64 KiB model, 64 blocks, 32 fields, 200 table rows); every parse returns the normalized model in declared field order so equal inputs serialize identically. `recognizeTaskSurfacePresentationMeta` is the tolerant projection-grade read: it returns `undefined` for anything absent, untagged, or malformed, leaving fail-loud rejection to the write side and the package invariant. The correlated submission source carries `TaskSurfaceCorrelation` (`submissionId`, `callId`, `surfaceId`, `values`), parsed by `parseTaskSurfaceCorrelation`.

<a id="submission-validation-and-formatting"></a>
## Submission validation and formatting

`validateTaskSurfaceSubmission` returns every issue instead of throwing: per field in declared order (absent values fall back to the declared `initial`; absent with no initial is `missing-required`; `required` is a UI hint the validator never reads), then unknown keys sorted by id, then the 32 KiB submission budget as `too-large`. `formatTaskSurfaceSubmission` renders the accepted submission as the model-visible transcript — title, one `label: value` line per field, the trimmed note after a blank line — and never throws. Rendered forms: toggle `on`/`off`, order fields joined with ` → `, multi-choice with `, `.

<a id="projection"></a>
## Projection

`taskSurfaceProjectionDefinition` registers the `taskSurface` projection unit (`stateVersion` 0; merges into `SessionProjectionMap` here): `tool/result` carrying recognizable presentation meta opens `active` (`callId` + `surfaceId`), a `user/message` whose source kind is `user` closes it — ordinary user messages and correlated submissions alike — and `task-surface/dismissed` closes it. Plugin-injected messages do not close an active surface.

<a id="package-invariant"></a>
## Package invariant

`./invariant` registers the `task-surface-invariant` companion: every `tool/result` meta tagged `dsh/task-surface` — replayed or freshly dispatched — must parse strictly, or the invariant fails loud.

<a id="export-shape"></a>
## Export shape

A pure domain barrel with no default export and no Cordis plugin in Stage 1; `./invariant` is the package's only Cordis surface. The browser-safe vocabulary — types, runtime constants, limits, parser, and validator — is available from the `@deepseek-ai/dsh-task-surface/client` entry for client code, which imports only the client namespace; the host-only projection definition stays on the root entry.

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

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No Stage 2 service** — open/submit/dismiss (and the `TaskSurfaceService` methods typed here) are deferred to the Stage 2 task-surface service; Stage 1 ships the domain only.
- **No correlated-submission invariant yet** — validating a `taskSurface` message-source correlation against the active surface is deferred with the Stage 3 apiproxy correlation registration.
- **No client rendering** — the UI that draws the model and collects submissions lives outside this package.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
