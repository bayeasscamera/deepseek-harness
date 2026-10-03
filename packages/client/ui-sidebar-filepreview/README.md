---
description: "The right Sidebar's rich preview tab type for the dsh web client: workspace images, PDFs, HTML pages, delimited tables, and Word, Excel, and PowerPoint documents read from byte windows, above the text viewer's fallback claim."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar-filepreview

English | [中文](README.zh.md)

## Summary

The right Sidebar's rich preview: one workspace file whose bytes are read window by window, then either published as one object URL — for the formats the browser draws itself — or converted into what the renderer needs: rows for delimited text and workbooks, static HTML for a Word document, slide text for a deck. Pictures, PDFs, and HTML pages are drawn by the browser; tables and converted documents by this package. It claims the file addresses whose basename carries an extension it renders at the `builtin` band, above the text viewer's `fallback` claim on every file address, so only the formats it draws leave the text viewer and everything else lands there unchanged. Like every tab type shipped from outside `ui-sidebar-right`, every import from the Sidebar is a type, the file's metadata comes from the shared `file` resource, the bytes are the type's own business, and the type's controls live in its own body.

## Table of Contents

- [What it registers](#what-it-registers)
- [Addresses](#addresses)
- [How it reads](#how-it-reads)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="what-it-registers"></a>
## What it registers

- **The type** — `ctx.sidebarRightTabs.register(...)` with id `@deepseek-ai/dsh-client-ui-sidebar-filepreview` (this implementation's identity in the tab system, and the key its body registers under), kind `preview`, one pattern per rendered extension (`*.png`, `*.jpg`, `*.jpeg`, `*.gif`, `*.webp`, `*.avif`, `*.bmp`, `*.ico`, `*.svg`, `*.html`, `*.htm`, `*.pdf`, `*.csv`, `*.tsv`, `*.xlsx`, `*.docx`, `*.pptx`), band `builtin`. Nothing broader is claimed: a file the extension list does not name stays with the text viewer. The whole address is the content identity, so two files with one name in different directories, or one path under two sessions, are two tabs; the decoded basename is the tab title.
- **The body** — the keyed `sidebar.right.pane.tab` seat under the type's id. Its header row shows the Host's absolute path (or the requested path until metadata arrives) and exposes its full value in a tooltip, with the type's one control at its end: a reload button. The Sidebar's tab strip carries no controls of this type. The body takes the pane body's full height: the header row stays put and the drawn file fills the rest — a picture is letterboxed, while a PDF or an HTML page fills the pane and owns its own scrolling.
- **One store and one face**, session-scoped and bucketed by tab id. The store holds the object URL the bytes were published under, their total size, the format the path resolved to, and the load in flight or its failure. The face (`load`, `reload`) performs the reads, builds the Blob and its URL, and writes through the store's actions. The bucket is forgotten — and its URL revoked — when the owner's `signal` aborts, which is when the tab record is gone.

<a id="addresses"></a>
## Addresses

A tab's address is `dsh-resource://file/session/<sessionId>/<path relative to that session's workspace root>` or `dsh-resource://file/absolute/<absolute path without its leading />`, built by `fileAddressFor` in `@deepseek-ai/dsh-util-workspace-path` and read back by `parseFileAddress`; `hostFileOf` in `rpc.ts` turns it into the session and path the endpoint takes. A `session` address reads under the session it names; an `absolute` address reads under the session the slot was mounted for, still inside the Host's workspace confinement. A malformed address throws, because the registry only sends addresses it matched against this type's patterns and a caller building one is expected to use the helper.

<a id="how-it-reads"></a>
## How it reads

The body reads its record through `useTabInfo().tab`; the drawn media type comes from the file's extension (`previewFormatOf` in `media.ts`, case-insensitive). Content comes from the Host:

- `useResource<'file'>(tab.contentId)`, the standard hook from `@deepseek-ai/dsh-client-resources`, yields `{ absolutePath, version, bytes, changed }` from the `file` provider in `@deepseek-ai/dsh-api-workspace-files`; only `absolutePath` is read, for the header.
- Bytes come from `remote.workspaceFiles.readBytes(sessionId, path, { offset }, signal)`, bound in `rpc.ts` and called by the face. Each call asks for a position and never a length, so the window size is the Host's configured cap and no call is refused for asking above it. Windows are read until the Host reports end of file, concatenated, and published as one Blob under an object URL of the format's media type. A `file-preview/too-large` failure refuses a file past the viewer's own total (32 MiB, `MAX_PREVIEW_BYTES`), and a window that reports neither bytes nor end of file fails as `file-preview/unreadable` rather than looping.
- **Rendering** — a picture is drawn with `<img>`; an HTML page in `<iframe sandbox="allow-scripts">`, so a page keeps its scripts while staying an opaque origin that cannot reach this application, open popups, or submit forms; a PDF with `<embed type="application/pdf">`, which hands it to the browser's own viewer. The PDF element needs Chromium's PDF viewer to be enabled in the desktop build; see the limitations below.
- **Conversion** — a `.csv` or `.tsv` is parsed into rows (`delimited.ts`); a `.xlsx`, `.docx`, or `.pptx` is opened as the ZIP of XML parts it is (`ooxml.ts`) and read by the part that holds its content: a workbook's shared strings and worksheets into sheets of rows, a document's body into paragraphs, headings, emphasis, and tables as HTML, and a deck's slide parts into paragraphs per slide. A converted document is drawn in `<iframe sandbox="">` — no scripts at all — because its HTML is this package's own output. Bytes that cannot be read as the extension claims fail as `file-preview/malformed` rather than drawing nothing. Conversion runs in the face, once per load, on the whole file.
- **Reload** — the header's control revokes the URL the tab published, drops the load, and reads again from the first byte. A reload retires the reads still in flight: the face keeps a load generation per tab, and a settlement from an older generation writes nothing. A failed load shows one sentence per code (`workspace-file/not-found`, `outside-workspace`, `not-regular-file`, `too-large` for a Host window over its cap; `file-preview/unsupported`, `too-large`, `unreadable` for this viewer's own refusals) or the transport's own message, with a retry that reloads.

Copy comes from the `sidebarFilepreview` locale namespace.

<a id="model-experience"></a>
## Model Experience

None, as the preview is a browser-only viewer that registers no tool, prompt section, or session event.

#### KV Cache effect

No direct effect; what the user reads here never enters a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The whole file is held in memory.** Every window is concatenated before the Blob is built or the conversion runs, so the viewer costs the file's size while a preview is live and refuses anything past 32 MiB; there is no streaming and no seek.
- **Relative assets do not resolve in HTML previews.** The frame's base is the object URL, so a page that references sibling files renders without them; a self-contained page (inline styles and scripts) is what this preview serves.
- **The media type comes from the extension only.** The Host serves bytes with no content type, and the viewer does not sniff, so a misnamed file is drawn under the wrong type and fails as a broken picture or an empty frame.
- **PDF rendering in the desktop app needs Chromium's PDF viewer.** The desktop build enables the plugin flag for it; that has not been verified against a packaged build.
- **Office previews keep the text, not the layout.** A converted document drops numbering, styles, images, footnotes, and positioning; a deck yields its slide text without shapes or theme; a workbook's dates stay the serial numbers the cells store, because the number formats that would interpret them are not read. A sheet is capped at 500 rows and 40 columns, and a delimited file at the same, with the cap stated under the table.
- **No controls beyond reload.** There is no zoom, rotate, page, or download affordance; the browser's own viewer chrome serves a PDF.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The type's only runtime state is one Slot store per tab, written by the face that owns it and forgotten on the tab's abort signal; there is no second observation of it to compare against.
