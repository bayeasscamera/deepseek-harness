# @deepseek-ai/dsh-world-model

English | [中文](README.zh.md)

A context plugin providing three interlocking environment intelligence capabilities: a declarative environment rules and policy validator, an atomic persistent state store (`.dsh/world-state.json`), and a heuristic consequence and risk engine that evaluates planned tool calls before execution.

Commands: `/env`, `/worldstate`. Tools: `world_model_predict`, `world_model_query`, `world_model_save_fact`.

## Config

```yaml
- id: world-model
  name: '@deepseek-ai/dsh-world-model'
  config:
    maxRules: 30         # maximum environment rules injected into the system prompt
    maxHistory: 50       # maximum task-history entries stored on disk
    maxConsequences: 100 # maximum consequence history entries held in memory
```

## Behavior

- Seeds a registry of built-in environment rules at load time (ESM-only, no-credential-commit, filesystem write permission, etc.).
- Injects an `## Environment Rules` section into the system prompt listing active capabilities, permissions, and constraints plus live runtime telemetry (platform, Node version, memory).
- Persists task history, active rule IDs, and arbitrary custom facts atomically to `.dsh/world-state.json` with backup recovery.
- Pre-flight risk assessment: given an action name and arguments JSON, predicts effects, risk level (`none`/`low`/`medium`/`high`/`critical`), blast radius, and reversibility.

## Model Experience

### Environment rules system prompt injection

#### What the model sees

An `## Environment Rules` section injected into the system prompt listing capabilities, permissions, and constraints as `- **id**: description` bullets grouped by category, followed by a runtime telemetry line.

##### Example injection

```markdown
## Environment Rules

### Capabilities
- **tool:run_command**: Shell command execution is enabled.

### Constraints
- **constraint:no-credential-commit**: Never commit or log secrets, API keys, or credentials.
- **constraint:esm-only**: All TypeScript/JavaScript in this project is ESM. CJS-only imports are forbidden.

### Runtime Telemetry
- **Platform**: darwin (arm64) | Node: v22.19.0 | Memory: 8192 MB free / 16384 MB total
```

#### Token effect

Proportional to the number of active rules (capped at `maxRules`). Telemetry adds one line. Rules inactive since session start do not appear.

#### KV Cache effect

Rules are injected at the system-prompt position before user messages and remain stable across turns unless a rule is toggled mid-session, at which point the prefix is invalidated only for that turn.

### Risk prediction tool output

#### What the model sees

`world_model_predict` returns structured JSON with `riskLevel`, `blastRadius`, `reversible`, `warnings`, and `predictedEffects` arrays, letting the model reason about consequences before executing destructive or wide-impact tool calls. The generated [`world_model_predict`, `world_model_query`, and `world_model_save_fact` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-world-model) carry the exact names, descriptions, and parameters.

#### Token effect

Negligible — the tool output is a compact JSON object. Only invoked on-demand before high-risk tool calls.

#### KV Cache effect

Tool output appends to the turn's assistant message; subsequent turns benefit from the cached prefix up to the tool output block.

## Known Limitations and Deferred Work

- **Heuristic only** — consequence rules are hand-coded patterns; they do not perform static analysis of actual code changes.
- **Single-process state** — the persistent state store is not safe for concurrent writer processes; designed for single-agent sessions.
- **Rule precedence** — all active rules carry equal weight; there is no priority mechanism to override a constraint with a permission.
