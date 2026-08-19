# Agent Note: 将 tool-fs-search 实现辅助函数从包根降级

Status: implemented

中文 | [English](2026-08-19-tool-fs-search-helper-demotion.md)

## 问题

`@deepseek-ai/dsh-tool-fs-search` 在包根重新导出了其全部实现面：glob/grep 的注册/解析/格式化/呈现/argv 构造辅助函数、`SearchError` 类、ripgrep 运行器（`resolveRgPath`、`runRipgrep`）、保留与溢出落盘辅助函数、所有 `*_MAX_*`/`SEARCH_*` 上限常量，以及 `GlobInput`/`GrepInput`/`GrepMatch`/`RipgrepRun`/`SearchErrorCode` 类型。对 `packages/`、`apps/`、`examples/`、`scripts/` 的精确符号搜索未发现任何包外消费者：唯一的外部引用是 `dsh-client-connection` fixture 中两处提及 `formatGlobOutput`/`formatGrepOutput` 的注释，而 `scripts/gen-tool-catalog.ts` 仅通过插件契约（`name`、`inject`、`Config`、`apply`）挂载该插件。同级工具包 `dsh-tool-fs` 与 `dsh-tool-bash` 早已将同类辅助函数保持为源码私有、只导出插件契约，[tool-web 降级](2026-08-18-tool-web-helper-demotion.md)也已对相邻包做过同样的修正；`tool-fs-search` 是剩下的例外。

## 决策

停止在包根重新导出这些辅助函数、常量与类型。`index.ts` 现在只导出插件契约（`name`、`inject`、`Config`、`apply`）。与 tool-web 不同，这里不保留任何配置默认常量导出：tool-web 保留 `WEB_SEARCH_MAX_RESULTS` 是因为 `apps/web/tests/web-search-round.e2e.ts` 通过它断言交付默认值，而 tool-fs-search 的上限常量没有任何包外消费者，在此导出任何一个都会构成与同级工具包之间无法解释的不对称。本包的测试现在从 `../src/glob.ts`、`../src/grep.ts`、`../src/search-core.ts` 导入辅助函数，与 `dsh-tool-fs`/`dsh-tool-bash`/`dsh-tool-web` 的约定一致；`tools.spec.ts` 保留命名空间导入以使用插件值与 `Config` 类型。生成式配置目录中该包的来源行随 `index.ts` 变短而移动，已用两种语言重新生成。

## 曾考虑的替代方案

为白盒测试便利而保留辅助函数公开。唯一的消费者是本包自己的测试，它们可以直接导入源码模块；保留这些导出会让包根解释没有任何交付调用方使用的实现内部细节，并偏离所有同级工具包的契约。

## 后果

- 包根只剩插件契约，与 `dsh-tool-fs`、`dsh-tool-bash` 以及（在其自身降级之后的）`dsh-tool-web` 一致；未来任何需要某个辅助函数的消费者必须先论证一个公开 API，而不是继承一个现成的。
- 144 项测试套件在改接导入后原样通过；模型可见的 schema、渲染文本与错误代码均未改变，exports map 中既有的 `./src/*` 条目本就允许测试现在使用的直接源码导入。
