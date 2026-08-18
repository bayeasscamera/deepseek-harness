# @deepseek-ai/dsh-context-rules

[English](README.md) | 中文

DeepSeek Harness 的上下文作用域规则引擎。自动发现 `~/.dsh/rules/*.md`、`<cwd>/.dsh/rules/*.md` 和 `<cwd>/.claude/rules/*.md` 中的 markdown 规则文件，使用 YAML frontmatter `paths:` glob 过滤，并将匹配的规则文本注入系统提示词上下文段。

## Model Experience

将匹配的项目规则直接注入系统提示词的动态上下文部分。

#### KV Cache effect

规则注入在动态上下文部分（order 60），位于稳定系统提示词前缀之后，以保持 KV 缓存效率。

## Known Limitations and Deferred Work

- **Frontmatter 路径匹配** — 当前针对工作区根目录进行评估；活动文件跟踪集成已延期。
- **规则截断** — 限制在 `maxRules`（默认 20）以内以防止上下文耗尽。
