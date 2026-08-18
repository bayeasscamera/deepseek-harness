# @deepseek-ai/dsh-context-rules

English | [中文](README.zh.md)

Context-scoped rules engine for DeepSeek Harness. Automatically discovers markdown rule files across `~/.dsh/rules/*.md`, `<cwd>/.dsh/rules/*.md`, and `<cwd>/.claude/rules/*.md`, filters them using YAML frontmatter `paths:` globs, and injects matching rule text into the system prompt context section.

## Model Experience

Indirectly, through `dsh-system-prompt`, which renders the injected dynamic context sections into prompt assembly.

#### KV Cache effect

No prefix invalidation; dynamic context sections are rendered after the stable system prompt prefix.

## Known Limitations and Deferred Work

- **Frontmatter path matching** — currently evaluates against the workspace root; active file-tracking integration is deferred.
- **Rules truncation** — capped at `maxRules` (default 20) to prevent context exhaustion.
