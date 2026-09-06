# @deepseek-ai/dsh-design-artboard

English | [中文](README.zh.md)

A UI design artboard extension that creates, manages, and previews interactive HTML/Tailwind component previews in `.dsh/artboards/` before committing changes to source code. Registers a `/design` slash command and a `design_create_artboard` model tool.

## Config

```yaml
- id: design-artboard
  name: '@deepseek-ai/dsh-design-artboard'
```

No plugin-level configuration fields. The artboard storage directory is fixed at `.dsh/artboards/` relative to the project root.

## Behavior

- `/design list` — lists all saved artboard HTML files in `.dsh/artboards/`.
- `/design new <name> [html]` — creates a new artboard file with optional inline HTML content; wraps the body in a Tailwind dark-mode preview shell.
- `/design show <name>` — displays the first 1000 characters of the saved artboard file and its path.
- `design_create_artboard` tool — saves an artboard with full control over name, title, and HTML content; returns the absolute file path.

## Model Experience

### Artboard creation tool result

#### What the model sees

The `design_create_artboard` tool takes `name`, optional `title`, and `content` (HTML/Tailwind). On success it returns `{ success: true, filePath }` pointing to the saved preview file, which the model can reference in subsequent verification or reporting steps. The generated [`design_create_artboard` schema](../../../docs/tool-catalog.md#deepseek-aidsh-design-artboard) carries the exact parameter set.

#### Token effect

Negligible — tool output is a compact JSON object with two fields.

#### KV Cache effect

Artboard creation does not inject persistent context. The file path may be referenced in subsequent messages if the model explicitly reads it back.

### Design command listing

#### What the model sees

`/design list` returns a markdown bullet list of artboard names and their file paths, or a usage hint if no artboards exist yet. The model can use this list to decide which artboard to inspect or update.

#### Token effect

Proportional to the number of saved artboards. Each entry adds one bullet line approximately 60–120 characters.

#### KV Cache effect

Command output appends to the running conversation history; subsequent turns benefit from the cached prefix up to the list response.

## Known Limitations and Deferred Work

- **CDN-dependent preview** — artboard HTML files load `https://cdn.tailwindcss.com`; previewing offline requires a bundled Tailwind build.
- **No hot-reload** — artboard files are static snapshots; changes require re-running the create command.
- **Fixed output directory** — `.dsh/artboards/` is not configurable without plugin source modification.
