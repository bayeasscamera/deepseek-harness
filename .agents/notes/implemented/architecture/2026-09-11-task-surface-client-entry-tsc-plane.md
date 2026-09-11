# Agent Note: Task-surface client entry serves from the tsc plane

Status: implemented

English | [中文](2026-09-11-task-surface-client-entry-tsc-plane.zh.md)

## Problem

`@deepseek-ai/dsh-task-surface` shipped in 8e199f6d12 with `exports["./client"]` targeting `./lib/client.js` and `files` listing that same file — a path no build step produces. The host tsdown pass bundles exactly `lib/types/{index,invariant,startup}.js` into `lib/`, and the client tsdown pass builds only packages that declare browser bundles; task-surface declares none. An export-map consumer resolving `@deepseek-ai/dsh-task-surface/client` from built artifacts found no file, and no `tsconfig.base.json` alias mapped the subpath in the source plane.

## Decision

`exports["./client"]` targets `./lib/types/client.js` and ships through the existing `lib/types/**/*.js` files glob — the layout every sibling domain package already serves (`dsh-schedule`, `dsh-plan-mode`, `dsh-token-meter`, `dsh-tool-todo`, `dsh-session-title`, `dsh-subagent`). A domain client namespace is a source re-export barrel of the browser-safe vocabulary; it has no browser bundle and no Node entry to bundle. This is the domain-package pattern, not the `packages/client/*` plugin layout, where packages declare browser bundles and `exports["./client"]` points at the tsdown-emitted `lib/client.js` ([GUI Web client architecture](2026-07-19-gui-web-client-architecture.md) owns that pattern).

`src/invariant.ts` imports `parseTaskSurfacePresentationMeta` and `TASK_SURFACE_PRESENTATION_META_KIND` through relative files (`./parser.ts`, `./runtime.ts`), matching sibling companion plugins; `src/client.ts` carries the barrel subset with `jscpd:ignore` markers, because it deliberately re-exports a subset of the root barrel's statements and the duplication gate would otherwise reject the overlap.

`tsconfig.base.json` gains the hand-written `@deepseek-ai/dsh-task-surface/client` alias. `gen-tsconfig-paths` generates only bare and `/invariant` specifiers, so every `/client` subpath alias in the repository is hand-written; the new entry joins that set.

The package README (English and Chinese) documents the entry split under "Export shape": browser-safe vocabulary on `./client`, the host-only projection definition on the root entry, the invariant companion on `./invariant`. The `packages/task-surface/` group README trio registers the group, and `verify-subsystem-pages` carries the matching exemption entry. The package version moves to the workspace release line (`0.1.3-alpha.2`).

## Alternatives considered

**Point `./client` at a tsdown bundle.** The workspace tsdown entry set is exactly `{index,invariant,startup}` for every host package. A domain client namespace is pure re-exports with no Node consumer, so bundling adds build output nothing loads while every sibling domain package already serves from `lib/types/`.

**Copy the `packages/client/*` plugin layout.** That layout belongs to packages that declare browser bundles; the client tsdown pass emits `lib/client.js` only for them. task-surface declares none, so the copied entry dangles — the original defect.

**Import the invariant's values through the package's bare name.** A bare self-import inside `src/` couples the companion to the export map and resolves through the alias to the whole root barrel, pulling the projection module into the companion's module graph. Sibling companions import relative files.

**Rely on the workspace symlink for source-plane resolution.** Without a `paths` alias, TypeScript resolves the subpath through the package's built `lib/` exports — the artifact-plane leak `gen-tsconfig-paths` exists to prevent; the generator's uncovered-package check reports only bare specifiers, so the hand-written alias is required.

## Consequences

`@deepseek-ai/dsh-task-surface/client` resolves against real files from both the published package and the source plane. Every future `/client` subpath needs its hand-written `tsconfig.base.json` alias; nothing generates it. Domain client-namespace barrels that subset the root barrel keep `jscpd:ignore` markers. No consumer imports the entry today; the Stage 2 task-surface service and its clients are the intended importers, and the `./client` entry is their browser-safe seam.

## Testing

Package specs (`tests/invariant.spec.ts`, `tests/parser.spec.ts`, `tests/projection.spec.ts`, `tests/validator.spec.ts`) exercise the domain through source-plane imports; `pnpm run publint`, `pnpm run gen-tsconfig-paths -- --check`, and `pnpm run verify-translation-pairing` cover the export map, the alias set, and the bilingual README pair.
