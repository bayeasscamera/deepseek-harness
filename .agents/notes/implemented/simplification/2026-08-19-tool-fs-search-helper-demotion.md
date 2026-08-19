# Agent Note: Demote tool-fs-search implementation helpers from the package root

Status: implemented

English | [中文](2026-08-19-tool-fs-search-helper-demotion.zh.md)

## Problem

`@deepseek-ai/dsh-tool-fs-search` re-exported its entire implementation surface at the package root: the glob/grep apply/parse/format/present/build helpers, the `SearchError` class, the ripgrep runner (`resolveRgPath`, `runRipgrep`), the retention and spill helpers, every `*_MAX_*`/`SEARCH_*` cap constant, and the `GlobInput`/`GrepInput`/`GrepMatch`/`RipgrepRun`/`SearchErrorCode` types. Exact-symbol searches across `packages/`, `apps/`, `examples/`, and `scripts/` found no outside-package consumer of any of them: the only external references are two comment mentions of `formatGlobOutput`/`formatGrepOutput` in `dsh-client-connection`'s fixture, and `scripts/gen-tool-catalog.ts` mounts the plugin through its contract (`name`, `inject`, `Config`, `apply`) alone. The sibling tool packages `dsh-tool-fs` and `dsh-tool-bash` already keep their equivalents source-private and export only the plugin contract, and the [tool-web demotion](2026-08-18-tool-web-helper-demotion.md) applied the same correction one package over; `tool-fs-search` was the remaining outlier.

## Decision

Stop re-exporting those helpers, constants, and types at the package root. `index.ts` now exports only the plugin contract (`name`, `inject`, `Config`, `apply`). Unlike tool-web, no config-default constant stays exported: tool-web kept `WEB_SEARCH_MAX_RESULTS` because `apps/web/tests/web-search-round.e2e.ts` asserts the shipped default through it, and no tool-fs-search cap constant has any outside-package consumer, so exporting one here would be an unexplained asymmetry with the sibling tool packages. The package's tests now import the helpers from `../src/glob.ts`, `../src/grep.ts`, and `../src/search-core.ts`, matching the `dsh-tool-fs`/`dsh-tool-bash`/`dsh-tool-web` convention; `tools.spec.ts` keeps its namespace import for the plugin value and `Config` type. The generated config catalog's source line for the package moved with the shorter `index.ts` and was regenerated in both languages.

## Alternatives considered

Keep the helpers public for white-box test convenience. The only consumers were this package's own tests, which can import source modules directly; keeping the exports made the package root explain implementation internals that no shipped caller uses and diverged from every sibling tool package's contract.

## Consequences

- The package root is the plugin contract only, consistent with `dsh-tool-fs`, `dsh-tool-bash`, and (after its own demotion) `dsh-tool-web`; a future consumer that needs a helper must argue for a public API instead of inheriting one.
- The 144-test suite passes unchanged with the rewired imports; no model-visible schema, render text, or error code changed, and the `./src/*` exports-map entry already permitted the direct source imports the tests now use.
