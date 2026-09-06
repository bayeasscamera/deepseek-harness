# @deepseek-ai/dsh-agent-state

English | [中文](README.zh.md)

Agent state persistence and action consequence reasoning. The guard keeps a durable per-workspace record of every settled tool call and makes the model reason about consequences before and after each action.

## What it does

**Before each step** (`agent/pre-step`): when the store holds a tool with at least three settled calls, the guard prepends a recall context listing per-tool success rates and the lessons this workspace has already paid for. The model plans its next action with its own history on the table.

**Before each mutating action** (`tools/pre-execute`): the call is classified (`read-only`, `reversible`, `irreversible`) and its predicted consequences are derived from the tool name and arguments — files written, processes spawned, destructive command patterns (`rm -r`, `git reset`, `git clean`, table drops, package uninstalls). With `denyIrreversible` the guard denies a predicted-irreversible call outright with the prediction as the reason.

**After each action** (`tools/post-execute`): the settled outcome is compared against the prediction and a one-line lesson folds into the tool's durable statistics. Only surprises ride back to the model as an additional context — a failure, or an outcome the prediction did not expect. A matched success stays in the statistics and injects no message, so nothing rides on every call.

## Persistence

One JSON store per workspace under `$DSH_HOME/agent-state/<workspace-hash>/state.jsonl` (or `storeDir`), replaced atomically after every settled observation (write to a sibling `.tmp`, then rename) — the same derived-file pattern as dsh-memory. The session log stays the source of truth for model-visible events; the store is recall index and rolling statistics:

- per tool: settled successes/failures and up to `maxLessonsPerTool` retained lessons;
- up to `maxObservations` recent observations.

## Data contracts

The service's public API moves two plain records (declared in `src/types.ts`):

**`ActionPrediction`** — the predicted outlook for one tool call, stored before the call runs:

- `risk` — classification after inspecting the tool and its arguments: `read-only`, `reversible`, or `irreversible`;
- `consequences` — predicted effects, most significant first, each an `effect` tag (such as `writes-file` or `spawns-process`) plus a one-line `detail`; empty when read-only;
- `targets` — file paths and commands the action may mutate, kept for later diffing against what actually happened;
- `reversibleByConvention` — whether the tool's own convention makes undo impossible (`rm -f`, truncate).

**`ActionObservation`** — one settled outcome compared against its prediction; the durable row the store folds:

- `id` — stable id, also the consolidation key;
- `tool` — tool name that ran;
- `outcome` — `success` or `failure`;
- `matchedPrediction` — whether the settled result matched the predicted risk class;
- `unexpected` — notable unexpected effects worth remembering, empty when none;
- `lesson` — one-line lesson summary kept for the tool's durable statistics;
- `at` — wall-clock time in milliseconds since the epoch.

## Configuration

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `storeDir` | string | `$DSH_HOME/agent-state` | Store directory (or exact `.jsonl` file path). |
| `denyIrreversible` | boolean | `false` | Deny predicted-irreversible calls instead of predicting and allowing. |
| `maxObservations` | number | `200` | Rolling observation rows retained in the store. |
| `maxLessonsPerTool` | number | `8` | Distinct lessons retained per tool row. |

## Model Experience

### Pre-step history recall

#### What the model sees

When the durable store holds at least three settled calls for an active tool, the agent receives a recall notice before planning its next step. The message sources as a plugin notice (`form: notice`, summary `durable tool history`); the format is pinned by the spec. One bullet per recalled tool, listing the three most recent distinct lessons; tools with fewer than three settled calls are omitted, and the message is absent entirely when no tool qualifies.

##### Recall notice

```markdown
Durable tool history for this workspace:
- bash: 85% success over 20 settled calls; lessons: avoid interactive prompts without flags
```

#### Token effect

Zero tokens when no tool meets the three-settled-call threshold. When active, adds a concise bullet per recalled tool.

#### KV Cache effect

Prepends to step context before tool execution; does not perturb static system prompt caches.

## Known Limitations and Deferred Work

- **Heuristic prediction** — prediction uses tool names and argument keys rather than inspecting file contents or remote environments.
- **Direct execution** — direct `ctx.tools.execute` calls without an active agent context are transparent to the guard.
- **Single writer per workspace** — the store has no cross-process locking; two `dsh` processes in one workspace do read-modify-write full rewrites and the last writer wins, silently dropping the other's observations.
- **Workspace keying** — the store key is the process cwd at plugin construction; a multi-workspace daemon shares one store across its sessions.
