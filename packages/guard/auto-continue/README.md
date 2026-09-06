# @deepseek-ai/dsh-auto-continue

English | [中文](README.zh.md)

A guard plugin that automatically resumes the agent loop when the model ends a turn mid-task without explicit completion. It detects incomplete-turn signals and injects a continuation prompt so the agent proceeds without requiring a human nudge.

## Config

```yaml
- id: auto-continue
  name: '@deepseek-ai/dsh-auto-continue'
  config:
    enabled: true        # default true; set false to disable auto-continuation
    maxContinues: 10     # maximum consecutive auto-continues before requiring human input
    delayMs: 0           # optional delay in milliseconds between turn end and continuation
```

## Behavior

- Monitors turn-end events for turns that ended without a terminal completion marker.
- When an incomplete turn is detected and `maxContinues` has not been reached, injects a system continuation message into the next turn.
- Counts consecutive auto-continues and stops when the limit is hit, surfacing a diagnostic notice to the user.
- Resets the counter on any genuine user message or successful task completion.

## Model Experience

### Continuation prompt injection

#### What the model sees

A brief system-injected message such as `"Continue."` appended as a new user turn, prompting the model to resume its previous task from where it left off.

#### Token effect

One short message per auto-continue event. The message is a single discrete entry in conversation history and does not grow unboundedly.

#### KV Cache effect

Continuation messages append to the running conversation history. The cached prefix up to the previous turn remains valid; only the new continuation message is freshly encoded.

## Known Limitations and Deferred Work

- **Heuristic completion detection** — relies on output patterns to determine whether a turn is genuinely complete; complex multi-step tasks may trigger false positives.
- **No task-state awareness** — the plugin does not inspect tool call history or pending work queues; it only acts on raw turn-end signals.
- **Fixed continuation text** — the injected message is a static string; richer context-aware prompting requires plugin extension.
