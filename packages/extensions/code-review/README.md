# @deepseek-ai/dsh-code-review

English | [中文](README.zh.md)

A multi-level adaptive code review extension providing five configurable review depths (`low`, `medium`, `high`, `extra-high`, `ultra`) to balance speed and token cost against exhaustive security and bug discovery. Registers a `/review` slash command and a `code_review_audit` model tool.

## Config

```yaml
- id: code-review-plugin
  name: '@deepseek-ai/dsh-code-review'
```

No plugin-level configuration fields. Review depth is selected per invocation via the command or tool.

## Behavior

- `/review [low|medium|high|extra-high|ultra] [path]` — generates a structured audit prompt for the selected effort level and optional file/directory target.
- `code_review_audit` tool — returns structured JSON (`level`, `guidelines`, `aspects`) that the model uses to scope its review focus.
- Defaults to `medium` when no level is supplied or the supplied value is not a recognized level key.

## Model Experience

### Review command output

#### What the model sees

A structured markdown block listing the selected level label, the analysis scope (file path or "current changes"), and the aspect checklist. The block ends with the generated evaluation prompt for the model to apply.

#### Token effect

Small constant overhead per `/review` invocation. The injected prompt block is approximately 10–30 tokens depending on the level and target path.

#### KV Cache effect

Each `/review` call appends a new context block. Subsequent turns reuse the cached prefix up to the injected review block.

### code_review_audit tool result

#### What the model sees

The tool returns `{ level, guidelines, aspects }` as structured JSON. The model reads `guidelines` and `aspects` to calibrate the depth and focus of its self-directed review. The generated [`code_review_audit` schema](../../../docs/tool-catalog.md#deepseek-aidsh-code-review) carries the exact level enum and output fields.

#### Token effect

Negligible — the tool output is a compact JSON object with three fields.

#### KV Cache effect

Tool output appends to the turn's assistant message; subsequent turns benefit from the cached prefix up to the tool output block.

## Known Limitations and Deferred Work

- **Prompt-based guidance only** — the extension generates review focus prompts but does not execute static analysis, AST inspection, or automated test runs.
- **No diff awareness** — the tool does not inspect the actual diff; the model must retrieve and analyze file contents independently.
- **Fixed level taxonomy** — the five-level scale is opinionated; intermediate or custom granularity requires plugin modification.
