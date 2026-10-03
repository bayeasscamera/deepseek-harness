---
description: "The office group map: model-facing tools that produce office artifacts in the session workspace, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/office

English | [中文](README.zh.md)

## Summary

The office group produces the artifacts a person opens in an office application. It currently holds one product package: a tool that turns a described deck into a real `.pptx` in the session workspace, written as bytes through the filesystem seam so the same confinement, guards, and atomic publication apply as to any other mutation. The group owns the artifact format and the model contract; where the file lands, and whether the write is allowed, belong to the filesystem and sandbox seams it writes through.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`tool-slides`](tool-slides/README.md) | Lets the agent write a PowerPoint presentation from a structured outline | registers on `ctx.tools` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Filesystem subsystem](../../docs/subsystems/filesystem.md) — the seam every artifact write goes through, including the binary mutation.
- [Sandbox subsystem](../../docs/subsystems/sandbox.md) — the policy that decides whether a write is allowed.
- [Generated tool catalog](../../docs/tool-catalog.md#deepseek-aidsh-tool-slides) — the `write_presentation` schema the model receives.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
