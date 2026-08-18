# @deepseek-ai/dsh-permission-rules

English | [中文](README.zh.md)

Fine-grained tool permission rules for the DeepSeek Harness, integrated natively into the `tools/pre-execute` waterfall pipeline. Evaluates regex allowlists and denylists for tools and bash commands, and runs a heuristic danger linter on shell commands.

## Model Experience

Indirectly, through `dsh-tools`, which renders allowed, asked, or denied tool executions in the model transcript.

#### KV Cache effect

No prefix invalidation; decisions operate per-tool invocation without modifying prompt prefixes.

## Known Limitations and Deferred Work

- **Static regex evaluation** — command parsing uses regex rather than a full shell AST analyzer.
- **Bash-focused heuristics** — danger linting targets POSIX shell patterns and does not analyze Windows PowerShell syntax.
