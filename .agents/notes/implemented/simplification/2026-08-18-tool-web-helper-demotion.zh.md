# Agent Note: 将 tool-web 实现辅助函数从包根降级

Status: implemented

中文 | [English](2026-08-18-tool-web-helper-demotion.md)

## 问题

`@deepseek-ai/dsh-tool-web` 在包根重新导出了其解析/格式化/呈现/注册/元数据实现辅助函数（`applyWebSearchTool`、`formatSearchOutput`、`parseSearchArgs`、`presentSearchCall`、`presentSearchResult`、`searchMetaFromValue`、`searchMetaFromResult`、`applyWebFetchTool`、`formatFetchOutput`、`parseFetchArgs`、`presentFetchCall`、`presentFetchResult`、`fetchMetaFromValue`、`fetchMetaFromResult`，以及 `WebSearchMeta`/`WebFetchMeta` 类型）。对 `packages/`、`examples/`、`apps/` 的精确符号搜索未发现任何包外消费者：它们只在 `search.ts`/`fetch.ts` 内部以及本包自己的测试中被调用。同级的工具包 `dsh-tool-fs` 与 `dsh-tool-bash` 早已将同类辅助函数保持为源码私有，只导出插件契约（`name`、`inject`、`Config`、`apply`），因此 `tool-web` 是为测试便利而扩大公开接口的例外。

## 决策

停止在包根重新导出这些辅助函数与类型。`index.ts` 现在只导出插件契约及配置默认值常量。`WEB_SEARCH_MAX_RESULTS` 保留导出：与解析/格式化/呈现辅助函数不同，它是 `searchMaxResults` 配置字段的默认值，并且有真实的包外消费者（`apps/web/tests/web-search-round.e2e.ts` 断言该出厂默认值）；在保留同级的 `DEFAULT_WEB_TOOL_TIMEOUT_MS`/`DEFAULT_FETCH_MAX_OUTPUT_CHARS` 默认值的同时降级它，会构成无法解释的不对称。本包的测试现在从 `../src/search.ts` 与 `../src/fetch.ts` 导入这些辅助函数，与 `dsh-tool-fs`/`dsh-tool-bash` 的约定一致。

## 曾考虑的替代方案

为白盒测试便利而保留这些辅助函数公开。唯一的消费者是本包自己的测试，它们可以直接导入源码模块；保留这些导出会让包根解释没有任何已发布调用方使用的实现内部细节，并偏离同级工具包的契约。

## 验证

`pnpm exec vitest run packages/web/tool-web` 通过（4 个文件共 76 个测试）。`pnpm run typecheck` 通过，包括导入 `WEB_SEARCH_MAX_RESULTS` 的 `apps/web` e2e。

## 后果

`dsh-tool-web` 的包根导出现在是插件契约加上 `WEB_SEARCH_MAX_RESULTS` 与 `DEFAULT_*` 配置默认值。这完成了[无用 API 清单](../../proposed/simplification/2026-07-04-prune-dead-core-spine-api.md)中 `dsh-tool-web` 一行除 `WEB_SEARCH_MAX_RESULTS` 之外的全部内容；该清单应将 `WEB_SEARCH_MAX_RESULTS` 视为有意保留。
