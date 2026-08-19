# Agent Note: Demote tool-web implementation helpers from the package root

Status: implemented

English | [中文](2026-08-18-tool-web-helper-demotion.zh.md)

## Problem

`@deepseek-ai/dsh-tool-web` re-exported its parse/format/present/apply/meta implementation helpers (`applyWebSearchTool`, `formatSearchOutput`, `parseSearchArgs`, `presentSearchCall`, `presentSearchResult`, `searchMetaFromValue`, `searchMetaFromResult`, `applyWebFetchTool`, `formatFetchOutput`, `parseFetchArgs`, `presentFetchCall`, `presentFetchResult`, `fetchMetaFromValue`, `fetchMetaFromResult`, and the `WebSearchMeta`/`WebFetchMeta` types) at the package root. Exact-symbol searches across `packages/`, `examples/`, and `apps/` found no outside-package consumer of any of them: they are called only inside `search.ts`/`fetch.ts` and by this package's own tests. The sibling tool packages `dsh-tool-fs` and `dsh-tool-bash` already keep their equivalents source-private and export only the plugin contract (`name`, `inject`, `Config`, `apply`), so `tool-web` was the outlier widening its public surface for test convenience.

## Decision

Stop re-exporting those helpers and types at the package root. `index.ts` now exports only the plugin contract plus the config-default constants. `WEB_SEARCH_MAX_RESULTS` stays exported: unlike the parse/format/present helpers it is the default for the `searchMaxResults` config field and has a real outside-package consumer (`apps/web/tests/web-search-round.e2e.ts` asserts the shipped default), so demoting it while keeping the sibling `DEFAULT_WEB_TOOL_TIMEOUT_MS`/`DEFAULT_FETCH_MAX_OUTPUT_CHARS` defaults would be an unexplained asymmetry. The package's tests now import the helpers from `../src/search.ts` and `../src/fetch.ts`, matching the `dsh-tool-fs`/`dsh-tool-bash` convention.

## Alternatives considered

Keep the helpers public for white-box test convenience. The only consumers were this package's own tests, which can import source modules directly; keeping the exports made the package root explain implementation internals that no shipped caller uses and diverged from the sibling tool packages' contract.

## Verification

`pnpm exec vitest run packages/web/tool-web` passes (76 tests across 4 files). `pnpm run typecheck` passes, including the `apps/web` e2e that imports `WEB_SEARCH_MAX_RESULTS`.

## Consequences

The `dsh-tool-web` root export is now the plugin contract plus `WEB_SEARCH_MAX_RESULTS` and the `DEFAULT_*` config defaults. This completes the `dsh-tool-web` row of the [dead-API inventory](../../proposed/simplification/2026-07-04-prune-dead-core-spine-api.md) except for `WEB_SEARCH_MAX_RESULTS`, which that inventory should treat as deliberately retained.
