# @deepseek-ai/dsh-prompt-budget

English | [中文](README.zh.md)

Prompt-budget observability for the DeepSeek Harness agent: prices every assembled system prompt with the token-meter fixed-density heuristic and emits a per-part breakdown event, so a deployment can see where request tokens go before tuning per-component budgets. Purely observational — it never trims, reorders, or rejects an assembly.

## Observer

`apply()` listens on the `system-prompt/assemble` waterfall, delegates first, prices the resolved assembly with `priceAssembly()`, emits `prompt-budget/breakdown`, and returns the assembly unchanged. A breakdown listener failure is swallowed so observability never blocks the model request.

The breakdown prices every part of the assembly — sections, dynamic contexts, tool schemas, and defined variables — under the same 4-chars-per-token density as `@deepseek-ai/dsh-token-meter`, plus a fixed per-part structural overhead, and sums them into `total`.

## Model Experience

None, as the observer contributes no prompt, tool, or session event; it emits a host-facing breakdown event only.

#### KV Cache effect

No direct effect. The observer never changes the assembled prompt, so it cannot invalidate any request prefix.

## Known Limitations and Deferred Work

- **Heuristic pricing** — the estimate is a fixed-density approximation, not an exact tokenizer count; it is consistent with the token meter but model-specific tokenization can differ.
- **No enforcement** — the plugin reports only; a deployment that wants a hard ceiling combines this breakdown with per-component budgets (`maxRules`, `maxRecall`, `maxBytes`, `tools.restrict()`).
