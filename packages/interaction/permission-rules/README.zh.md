# @deepseek-ai/dsh-permission-rules

[English](README.md) | 中文

DeepSeek Harness 的细粒度工具权限规则，原生集成到 `tools/pre-execute` waterfall 管道中。评估工具和 bash 命令的正则允许列表与拒绝列表，并对 shell 命令运行启发式危险检测。

## Model Experience

通过模型转录中允许、询问或拒绝的工具执行间接体现。

#### KV Cache effect

无前缀失效；决策按每次工具调用进行，不修改提示词前缀。

## Known Limitations and Deferred Work

- **静态正则评估** — 命令解析使用正则表达式而非完整的 shell AST 分析器。
- **针对 Bash 的启发式** — 危险检测针对 POSIX shell 模式，不分析 Windows PowerShell 语法。
