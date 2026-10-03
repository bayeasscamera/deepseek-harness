---
description: "The model-facing write_presentation tool: a described deck becomes a real .pptx in the session workspace, written as bytes through the filesystem seam."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-slides

English | [中文](README.zh.md)

## Summary

`dsh-tool-slides` gives the model one tool — `write_presentation` — that turns a structured outline into a PowerPoint package: a title slide built from the deck's title and subtitle, then one slide per entry, drawn by the layout that entry names, on the template the call chooses. The package is written through `ctx.fs.writeBytes`, so the resolution, the write-intent guards, the per-target lock, and the sandbox fence apply exactly as they do to a text write. The tool owns the model contract and the write; the OOXML part graph is this package's own writer's business.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose this plugin wherever the model should be able to produce a presentation. It needs the tool registry and a filesystem backend (`ctx.fs`); the sandbox policy is read per call when the composition mounts it.

### When to call the tool

The model calls `write_presentation` when the user asks for slides, a deck, or a presentation. The deck opens with a title slide, then one slide per entry: layout `bullets` draws a heading with bullet lines, layout `section` draws a divider heading. The template names the deck's colour scheme, font pair, and background: `default` (neutral light), `dark` (dark background, light text), or `print` (black on white, serif, for handouts); omitting it builds the `default` deck.

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

### What the model gets back

The canonical value names the file, whether the write created or replaced it, the package size, and how many slides the deck holds. The rendered text keeps the same `<path>`/`<type>`/`<content>` shape the filesystem tools use, so the model reads a produced artifact the same way everywhere.

```json
{ "path": "/work/project/reports/weekly.pptx", "operation": "create", "bytes": 9834, "slides": 3 }
```

### When the call fails

A path the backend refuses (a directory, a target outside the workspace, a sandbox denial) settles as an error the model sees in the tool result. A policy denial carries the shared `[sandbox: file access denied under <mode> mode]` marker, because a refusal is a decision to report rather than a bug to work around. An existing file at the path is replaced without a read-before-write precondition: a generated deck is an artifact this tool owns, not a file the model is editing.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The observable behavior is covered in [Use this package](#use-this-package); this section explains the writer and the write path.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Tool registration: the `write_presentation` schema, the resolve/write path, the denial marker, the call view |
| [`src/pptx.ts`](src/pptx.ts) | The OOXML writer: content types, relationships, presentation, master, three layouts, theme, document properties, one part per slide |
| — | No runtime invariant companion is published; the tool's only state is the package it writes, and the seam it writes through owns the mutation's lifecycle. |

### The written package

A `.pptx` is a ZIP of XML parts, and the writer emits the whole graph a reader resolves: `[Content_Types].xml` declaring every part's type, `_rels/.rels` pointing at the presentation and the document properties, `ppt/presentation.xml` listing the master and every slide, one master with its layout list, colour map, and text styles, three layouts (`title`, `secHead`, `obj`), a theme carrying the template's colour scheme and fonts, and one slide part plus its relationships per slide — each pointing at the layout the deck chose. The master paints its background from the scheme's light slot and draws body text in the scheme's text colour, which is what makes a template change the whole deck without touching a slide; a section heading is drawn in the template's first accent. Text is escaped on the way in, and the archive's modification time is fixed by the caller's instant, so the same deck produces the same bytes.

### The write path

The tool resolves the target with the sandbox policy's workspace root when the call carries one, else the calling session's workspace canonicalized, and passes the resolved policy to `ctx.fs.writeBytes`. That keeps a generated deck inside the same confinement as every other mutation: `read-only` refuses it, `workspace-write` allows it only under the session workspace, and a refusal arrives as the shared marker rather than a retry. The write is unguarded (no `createIfAbsent`/`replaceIfVersion` intent), because regenerating a deck at the same path is the normal case.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Tool catalog](../../../docs/tool-catalog.md) — every shipped tool's model-facing schema.
- [Filesystem subsystem](../../../docs/subsystems/filesystem.md) — the seam this tool writes through.
- [Sandbox subsystem](../../../docs/subsystems/sandbox.md) — the policy that decides whether a write is allowed.

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`write_presentation` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-slides), including the target path, the deck title and subtitle, the template, and the per-slide layout, heading, and bullet lines.

#### Token effect

Fixed schema cost on every request where the tool is visible.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse from this schema.

### Tool-call history and result

#### What the model sees

The model's full outline remains in the assistant tool-call arguments. The next step sees the rendered `<path>`/`<type>`/`<content>` block naming the file, the create-or-replace operation, the package size, and the slide count.

#### Token effect

Arguments are data-dependent retained tokens; the result is a fixed few lines whatever the deck's size.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Three predefined layouts and three templates** — a deck is a title slide plus `section` and `bullets` slides, built on `default`, `dark`, or `print`; there is no way to supply a corporate template, a master of the caller's own, images, speaker notes, or per-slide positioning.
- **Text only, at a fixed 16:9 geometry** — a template sets the colour scheme, the font pair, and the background; run sizes are set for headings and body text, and nothing else is styled.
- **The package is validated structurally, not by PowerPoint** — the specs assert the parts, relationships, and XML, and a generated deck opens in an independent reader (`python-pptx`) and in the macOS Quick Look importer; it has not been opened in Microsoft PowerPoint in this environment.
- **A deck is replaced, never merged** — the write carries no intent guard, so regenerating at an existing path overwrites it without a read-before-write precondition.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The package is named for the artifact family (`tool-slides`) while the tool is named for the action (`write_presentation`), matching the existing split where `tool-web` provides `web_search` and `web_fetch`. The name avoids the repository's existing `agent-tool-presentation` plugin, which is about how tools are presented to the model rather than about presentations.

</details>
