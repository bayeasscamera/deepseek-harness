# Agent Note: 独立格式化工具无法接管本仓库的代码风格

Status: rejected — 重新格式化引入 7469 个 `oxlint` 错误，其中四条冲突规则中有一条任何格式化工具配置都无法满足

[English](2026-09-30-standalone-formatter-contradicts-stylistic-rules.md) | 中文

## Problem

仓库 3664 个 TypeScript/TSX 文件中有 2915 个未经机器格式化。风格完全由 [`.oxlintrc.json`](../../../../.oxlintrc.json) 中的 `@stylistic` 规则加人工纪律维持，因此没有任何工具能在不冒 lint 错误的前提下重新格式化文件。我们安装并评估了 `oxfmt` 0.71.0：它与已固定的 `oxlint` 1.76.0 出自同一个 oxc 项目，可以让一家厂商同时提供工具链的两半。

## Proposal

按实测而非猜测安装 `oxfmt`：`printWidth` 100（p90 = 82，p99 = 129，超过 100 的占 3%）、`semi: false`、`singleQuote`、`trailingComma: all`、`arrowParens: "avoid"`（784 个带括号对 2791 个单参数裸写样本），排除生成器拥有的产物，并用「未格式化文件计数上升即失败」的棘轮把关。

## Alternatives considered

**保留 `@stylistic` 规则作为唯一格式化权威。** 仓库本就拥有格式化机制，`pnpm run lint:fix`（`oxlint --fix`）也已能就地改写其中可修复的部分。

**采用 `oxfmt` 并删除四条冲突规则**，接受单一权威。这是全仓库范围的风格变更，而不是一次重新格式化：`requireForBlockBody` 会给大约 3000 处带块体的箭头函数加上括号。只有当目标是替换 linter 的格式化规则时，这才是对的答案，而那是约定决策，不是工具决策。

**把 `oxfmt` 保留为可选、非强制的工具。** 不采纳，因为两个权威按构造就不一致，而运行被宣传的 `format` 命令会产生过不了 `lint` 的树。一个会破坏 gate 的可选工具是陷阱，不是便利。

## Consequences

重新格式化产生了 7469 个新的 `oxlint` 错误：`indent` 4450、`arrow-parens` 3013、`comma-dangle` 5、`semi` 1。其中一处冲突根本无法通过配置解决——[`arrow-parens`](../../../../.oxlintrc.json) 带有 `requireForBlockBody: true`，要求 `(x) => { … }`，而 `oxfmt` 只提供 `always` 和 `avoid`，因此仓库的主流风格在每一个带块体的箭头函数上都与该规则冲突。`indent` 则在格式化器自行决定的续行排版上产生分歧。

因此实测漂移依然存在：2915 个未格式化文件，而 `pnpm run lint:fix` 是唯一能减少它的机制。本仓库没有 `pnpm run format` 这个脚本。
