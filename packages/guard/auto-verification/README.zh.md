# @deepseek-ai/dsh-auto-verification

[English](README.md) | 中文

连续编辑后自动验证保护插件：监控文件修改工具调用（`write`、`edit`、`str_replace_editor`），并立即验证语法与结构完整性（例如 JSON 语法与代码括号匹配）。一旦检测到错误，自动向下一轮注入诊断提示，以便代码代理立即自愈。

## 配置

```yaml
- id: auto-verification
  name: '@deepseek-ai/dsh-auto-verification'
  config:
    enabled: true               # default true; master switch for the guard
    checkJson: true             # default true; validates JSON parse
    checkBrackets: true         # default true; validates balanced brackets/delimiters
    checkVisualUi: true         # default true; validates UI markup and stylesheet structure
    enforceTdd: false           # default false; injects a TDD verification reminder after code mutations
    visualFeedbackStep: false   # default false; injects a rendered-layout review reminder after UI mutations
    enforceLoopVerifier: false  # default false; injects the Loop-Engineering Maker/Checker verifier notice on code edits
    denylistPaths: ['.env', 'auth/', 'payments/', 'secrets/', 'credentials/']  # default as shown; sensitive path substrings
    maxAttemptsPerTarget: 3     # default 3; consecutive mutations on one target before the circuit-breaker notice fires, once per target
    maxDiagnosticChars: 1000    # default 1000; character cap on diagnostic output
```

`denylistPaths` 检查是**建议性且事后性的**：该守卫监听 `tools/post-execute`，因此命中敏感路径的写入在通知触发时已经发生。它不会阻止写入、不会回滚，也不会请求批准。敏感路径的强制拦截应由 `fs/write-intent` 策略或权限插件负责。

## 行为

- 拦截 `tools/post-execute` 决策。
- 当发生文件变更时，在修改文本上执行快速本地语法检查。
- 若发现语法或结构冲突，追加非阻塞建议上下文消息（`additionalContexts`），标识为 `{kind: 'plugin', plugin: 'auto-verification'}`。
- 当同一目标被连续修改 `maxAttemptsPerTarget` 次时，注入循环工程熔断升级通知；该通知对每个目标只触发一次，避免反复编辑向模型上下文堆积无界噪声。
- 使自主编码 agent 能够在紧接着的下一步中检测并修复语法错误。

## 模型体验

### 编辑后诊断上下文消息

#### 模型所见

当编辑引入未闭合括号或非法 JSON 语法时，agent 会收到以下诊断通知：

##### 诊断通知

```markdown
[Auto-Verification] Syntax error detected:
- file: <filePath>
- diagnostic: <errorMessage>
Please review and fix this syntax issue before proceeding.
```

#### Token 影响

当代码无语法错误时为零 token；仅在检测到错误时作为历史记录保留。

#### KV Cache 影响

仅追加模式；新内容跟随可复用的请求前缀，不破坏已有的 KV Cache。

## 已知局限与后续工作

- **轻量级启发式检查** — 无法完全替代全量编译与测试。
- **语言解析器覆盖** — 当前采用快速轻量扫描而非完整 AST 编译器。
- **仅建议性拒绝列表** — 敏感路径拒绝列表在匹配写入发生后才提示，绝不阻止、回滚或升级为超出注入通知的干预。
- **进程内计数记忆** — 修改计数与已触发的熔断器保存在插件状态中；插件重载或重启后，每个目标的计数从头开始。
