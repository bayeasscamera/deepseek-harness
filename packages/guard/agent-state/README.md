# @deepseek-ai/dsh-agent-state

English | [中文](README.zh.md)

Agent state persistence and action consequence reasoning. The guard keeps a durable per-workspace record of every settled tool call and makes the model reason about consequences before and after each action.

## What it does

**Before each step** (`agent/pre-step`): when the store holds a tool with at least three settled calls, the guard prepends a recall context listing per-tool success rates and the lessons this workspace has already paid for. The model plans its next action with its own history on the table.

**Before each mutating action** (`tools/pre-execute`): the call is classified (`read-only`, `reversible`, `irreversible`) and its predicted consequences are derived from the tool name and arguments — files written, processes spawned, destructive command patterns (`rm -r`, `git reset`, `git clean`, table drops, package uninstalls). With `denyIrreversible` the guard denies a predicted-irreversible call outright with the prediction as the reason.

**After each action** (`tools/post-execute`): the settled outcome is compared against the prediction; the comparison rides back to the model as an additional context (`[tool] settled success — the outcome matched the predicted effect`), and a one-line lesson folds into the tool's durable statistics.

## Persistence

One JSON store per workspace under `$DSH_HOME/agent-state/<workspace-hash>/state.jsonl` (or `storeDir`), rewritten atomically after every settled observation — the same derived-file pattern as dsh-memory. The session log stays the source of truth for model-visible events; the store is recall index and rolling statistics:

- per tool: settled successes/failures and up to 8 retained lessons;
- up to 200 recent observations.

## Configuration

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `storeDir` | string | `$DSH_HOME/agent-state` | Store directory (or exact `.jsonl` file path). |
| `denyIrreversible` | boolean | `false` | Deny predicted-irreversible calls instead of predicting and allowing. |

## Limits

Prediction is heuristic (tool name plus argument shape); it never inspects file content. Direct `ctx.tools.execute` calls without an agent are transparent to the guard.
