# Agent Note: A presentation tool over the binary write

Status: implemented

English | [中文](2026-10-03-presentation-tool.zh.md)

## Problem

The harness could describe a file, edit a file, and read any file, but it could not produce an artifact that is not text: the filesystem seam wrote strings, and the version asks for integrated PowerPoint generation from predefined layouts. A tool that shells out to a Python library would not be integrated, and one that hands the model base64 would make it carry bytes it never reads.

## Decision

`packages/office/tool-slides` provides `write_presentation`. The package owns two halves. `src/pptx.ts` is a pure writer: a deck of a title, an optional subtitle, and content slides goes in, and the bytes of a complete OOXML package come out — `[Content_Types].xml`, the package relationships, `ppt/presentation.xml` listing the master and every slide, one master with its layout list, colour map, and text styles, three layouts (`title`, `secHead`, `obj`), a theme carrying the deck's template, the document properties, and one slide part plus its relationships per slide, each pointing at the layout its slide named. A template (`default`, `dark`, `print`) is a colour scheme, a font pair, and a background together: the theme carries the values and the master paints its background from the scheme's light slot, so a template changes the whole deck without touching a slide, and a section heading is drawn in the template's first accent. Text is escaped on the way in, and the archive's modification time is the caller's instant, so the same deck produces the same bytes. `src/index.ts` is the model contract: the schema the model fills, the resolve-and-write path, and the denial marker.

The tool resolves its target exactly as the filesystem tools do — the sandbox policy's workspace root when the call carries one, else the calling session's workspace canonicalized — and writes through `ctx.fs.writeBytes`, the binary mutation added in the previous phase. That is what makes the artifact a first-class workspace file: the write-intent guards, the per-target lock, the atomic publication, and the sandbox fence all apply, and a policy refusal reaches the model as the shared `[sandbox: file access denied under <mode> mode]` marker rather than as something to retry another way. The write carries no intent, because regenerating a deck at the same path is the normal case.

**The tool's own tests found a fence gap and the change closes it.** `SandboxedFileSystem` fenced `writeText` and `editText` and inherited `writeBytes` from its base: under `read-only`, a binary write landed. The backend now overrides `writeBytes` with the same `checkedTarget` fence, and its suite covers the denial, the contained allow, and the full-access bypass beside the text cases.

The package is named `tool-slides`, not `tool-presentation`, because this repository already uses that word for a different thing: `@deepseek-ai/dsh-agent-tool-presentation` selects whether the agent sees tools natively, as PTC bindings, or both, and the cordis preset already owns the plugin id `tool-presentation`. The model-facing tool keeps the clearer name `write_presentation`, matching the existing split where `tool-web` provides `web_search` and `web_fetch`.

## Alternatives considered

**pptxgenjs as the writer.** A maintained library that produces decks with far more fidelity than the three layouts here, and it would have deleted the whole part-graph code. It lost on weight and fit: 2.6 MB unpacked with four transitive dependencies (including `jszip`, which this repository already weighed and rejected once when choosing `fflate` for the session-log export), pulled into every installation for a tool whose stated shape is "templates and predefined layouts". The same reasoning that chose a parser over mammoth and SheetJS for the viewer applies in the other direction here.

**Extending the existing `write` tool with a base64 parameter.** No new tool, no new package, and the model already knows `write`. It lost because it makes the model the transport: a deck's bytes would travel through the model's context as base64, paying tokens for content it never reads, and a truncated argument would produce a corrupt file rather than an error.

**Shipping the deck through a skill that shells out.** The repository already carries PowerPoint skills that drive `python-pptx` or `pptxgenjs` in the user's environment. It lost on the word "integrated": the version asks for generation built into the product, and a skill depends on whatever the user's machine happens to have installed, with no sandbox-policy integration and no durable result metadata.

**Naming the package `tool-presentation`.** The obvious name, and the first one tried. It lost because the id collides in the preset namespace with `agent-tool-presentation` and makes every reader stop to disambiguate two unrelated meanings of one word.

## Consequences

The agent can now produce a PowerPoint artifact inside the session workspace with the same confinement as any other write, and the produced file appears in the turn's deliverables row because the client's mutation vocabulary learned the new tool name. The cost is owned surface: the writer is this repository's code and its fidelity is what the three layouts and three templates provide — no corporate template of the caller's own, no images, no speaker notes, and no per-slide positioning. Validation is structural (parts, relationships, XML well-formedness, byte determinism) plus two independent readers exercised outside the suite: `python-pptx` opens a generated deck and reads its slides, and the macOS Quick Look importer renders it; it has not been opened in Microsoft PowerPoint in this environment, which the package README records as a limitation. The roster snapshots and the SDK's expected-tools assertion were updated in the same change, because a new tool is a model-visible change.
