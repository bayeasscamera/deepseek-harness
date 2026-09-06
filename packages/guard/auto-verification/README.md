# @deepseek-ai/dsh-auto-verification

English | [中文](README.zh.md)

A continuous post-edit auto-verification guard plugin: it monitors file mutation tool calls (`write`, `edit`, `str_replace_editor`) and immediately validates syntax and structural integrity (such as JSON syntax and code bracket/delimiter balance). When an error is detected, it automatically injects a diagnostic notice into the next turn so the coding agent can self-heal right away.

## Config

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

The `denylistPaths` check is **advisory and post-hoc**: the guard listens on `tools/post-execute`, so a write matching the denylist has already happened when the notice fires. It does not block the write, revert it, or request approval. Hard enforcement of sensitive paths belongs to a `fs/write-intent` policy or permission plugin.

## Behavior

- Intercepts `tools/post-execute` decisions.
- When a file mutation occurs, runs fast local syntax checks on the mutated text.
- If a syntax or structural violation is found, appends a non-blocking advisory context message (`additionalContexts`) with `{kind: 'plugin', plugin: 'auto-verification'}`.
- When one target has been mutated `maxAttemptsPerTarget` consecutive times, injects a loop-engineering circuit-breaker escalation notice; it fires exactly once per target so repeated edits cannot pile unbounded noise into model context.
- Enables autonomous coding agents to detect and fix syntax mistakes in the immediate next step.

## Model Experience

### Post-edit diagnostic context message

#### What the model sees

When an edit introduces an unclosed bracket or invalid JSON syntax, that agent receives the diagnostic notice below.

##### Diagnostic notice

```markdown
[Auto-Verification] Syntax error detected:
- file: <filePath>
- diagnostic: <errorMessage>
Please review and fix this syntax issue before proceeding.
```

#### Token effect

Zero tokens when edits are clean. Diagnostic messages are retained history only when errors occur.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Static lightweight heuristics** — does not replace full project-wide build/test passes.
- **Language-specific parsers** — uses fast lightweight lexing rather than full compiler ASTs.
- **Advisory denylist only** — the sensitive-path denylist notices a matching write after it happened and never blocks, reverts, or escalates beyond the injected notice.
- **Per-process attempt memory** — mutation counters and fired circuit breakers live in plugin state; a plugin reload or restart starts every target's count over.
