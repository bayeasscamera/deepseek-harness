---
description: "French language pack for the web GUI: the fr locale with complete French dictionaries for every client namespace, for users who want the interface in French."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-locale-fr

English | [中文](README.zh.md)

## Summary

`dsh-client-locale-fr` adds French to the web GUI: it registers the `fr` locale (falling back to English, never to another language) plus one complete French dictionary per client namespace, so selecting Français in Settings → General renders the whole interface in French. Choose it when the deployment serves French-speaking users; a French browser picks it provisionally before any stored preference arrives. The pack owns interface copy only: agent replies follow the agent preset's persona, not this package.

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

The web-app bundle already mounts this pack beside `dsh-client-locale`; no configuration is needed. Open Settings → General and select Français. The choice applies immediately and persists as `locale.preference` in the user settings document.

### When to choose it

Keep this pack mounted when French-speaking users operate the GUI. Removing its row hides Français from the language selector and returns active French sessions to the browser/default locale; nothing else changes.

### What the pack registers

One `fr` language definition (`Français`, fallback `en`) and 35 French dictionaries covering every client namespace: `common`, `settings`, `settings.locale`, `settings.theme`, `settings.models`, `settings.plugins`, `settings.pluginInventory`, `settings.agentPreset`, `settings.permission`, `permission.access`, `chat`, `conversation`, `trajectory`, `skill`, `subagent`, `model`, `question`, `feedback`, `sidebar`, `sidebarFiles`, `sidebarRight`, `sidebarTextpreview`, `workspace`, `reference`, `directory-browser`, `open-in-app`, `approval`, `plan`, `goal`, `job`, `schedule.catalog`, `workflowRun`, `deliverables`, `command`, and `slash.menu`.

### Failures and recovery

A key absent from a French table resolves through the English fallback at lookup time; an unknown key renders as the key itself. Registration is transactional: if any dictionary hits a rival owner, everything installed so far rolls back and activation fails loud, leaving no half-French copy behind.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the pack; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The pack follows the language-pack extension point the locale service documents, with two deliberate rules:

- **English fallback, never another language.** The `fr` definition declares `en` as its fallback and the fallback chain terminates at English, so an untranslated key reads English — the reader least likely to read any other shipped language.
- **One unit or nothing.** The definition and all 35 dictionaries install inside a single effect with rollback: a failed activation cannot squat half the French copy.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Node half: empty apply so the plugin appears in host composition |
| [`src/client/index.ts`](src/client/index.ts) | Browser half: `fr` definition plus one `register` per namespace |
| [`src/client/dicts-core.ts`](src/client/dicts-core.ts) | French tables for the shell and settings namespaces |
| [`src/client/dicts-chat.ts`](src/client/dicts-chat.ts) | French tables for the conversation namespaces |
| [`src/client/dicts-shell.ts`](src/client/dicts-shell.ts) | French tables for sidebars, workspaces, and tool chrome |
| — | No runtime invariant companion is published; this package exposes no independent event sequence or mutable data relation beyond contracts enforced at its owning seam. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the locale contract to the client stack and the localization decision.

- [dsh-client-locale](../locale/README.md) — the locale service this pack extends: preference, browser fallback, and the language-pack extension point.
- [Client group map](../README.md) — the browser half this package belongs to.
- [Locale-owned client UI copy](../../../.agents/notes/implemented/architecture/2026-08-23-locale-owned-client-ui-copy.md) — why product text travels through typed dictionaries.
- [Respond in French](../../../docs/user/guide/french.md) — the companion agent-side language setup: a French preset so replies follow the interface.

-----

<a id="model-experience"></a>
## Model Experience

None, as the French language pack is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define where the French pack is incomplete. They are current package constraints.

- **Agent replies are a separate plane** — this pack translates the interface; what the model writes follows the agent preset's persona. Pair it with the [French preset guide](../../../docs/user/guide/french.md).
- **No French plural rules or bidirectional layout** — the registry supplies selection, persistence, browser matching, key fallback, and `<html lang>`; language-specific behavior beyond dictionaries belongs to a richer pack.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The French definition and its 35 dictionaries expose no independent event sequence or mutable data relation; registration disposal and key fallback are asserted by behavior specs.
