# Agent Note: 将 WIP 规则包接入 invariant 伴随插件与 hygiene 门禁

Status: implemented

中文 | [English](2026-08-19-wire-wip-rule-packages-hygiene.md)

## 问题

三个以 WIP 形式提交的包（`0b6d88bc46`）使 `pnpm run hygiene` 失败，并在第一个失败步骤处阻断了整个门禁。`verify-package-invariants` 要求每个携带 `invariant.ts` 伴随插件的包，必须把 `@deepseek-ai/dsh-invariants` 同时声明为 `workspace:^` 的 peerDependency 与 devDependency，并在其 tsconfig 中引用 `runtime-diagnostics/invariants`；`dsh-context-rules` 与 `dsh-permission-rules` 各自带有 invariant 伴随插件，却两项声明都缺失。`knip` 还额外标出三个未使用的依赖：`context-rules` 中的 `dsh-tools`、`permission-rules` 中的 `dsh-shell`，以及 `prompt-budget` 中的 `schemastery`。

## 决策

让每个包的 manifest 与其实际导入保持一致：

- `dsh-context-rules`：新增 `dsh-invariants` 的 peer+dev 声明与 `runtime-diagnostics/invariants` 的 tsconfig 引用；移除未使用的 `dsh-llm` 与 `dsh-tools` peer（其源码只导入 `cordis`、`dsh-agent`、`dsh-system-prompt`、`schemastery` 与 `dsh-invariants`）。
- `dsh-permission-rules`：新增 `dsh-invariants` 的 peer+dev 声明与 tsconfig 引用；移除未使用的 `dsh-agent` 与 `dsh-shell` peer（其源码只导入 `cordis`、`dsh-tools`、`schemastery` 与 `dsh-invariants`）。
- `dsh-prompt-budget`：移除未使用的 `schemastery` 依赖及其 tsconfig 引用（该插件没有 `Config` schema，`apply` 也不接收配置）。

## 曾考虑的替代方案

用 knip 的 `ignoreDependencies` 条目让门禁闭嘴，manifest 保持原样。否决：被标记的依赖确实没有被导入，忽略它们会掩盖真实的 manifest/源码不一致而不是修复它，而仓库约定是窄而有据的例外，不是对漂移的一揽子忽略。

删除两个规则包的 invariant 伴随插件以绕开门禁。否决：伴随插件是每个同级包都携带的包属 invariant 注册；删除它们会偏离 invariant 伴随插件约定，而不是满足它。

## 后果

- `pnpm run hygiene` 现在端到端通过（exit 0），不再在 `knip` 处中止；下游各子门禁（`publint`、`constraints`、invariant 伴随插件、cordis-config、NodeNext、运行时闭包、vendored 链接）全部运行并通过。
- 三个 manifest 现在精确描述其源码实际导入的内容；未来的同步或依赖审计从一个真实的基线出发。
- 运行时行为没有任何改变 —— 本次编辑只触及 `package.json` 的依赖段与 tsconfig 的 `references`，外加一次用于刷新 lockfile 的 `pnpm install`。
