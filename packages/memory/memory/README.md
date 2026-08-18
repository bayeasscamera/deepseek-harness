# @deepseek-ai/dsh-memory

English | [中文](README.zh.md)

Long-term memory for the DeepSeek Harness agent: a durable cross-session record store with workspace scoping, ranked recall, and automatic system-prompt injection. The model-facing tools live in [`@deepseek-ai/dsh-tool-memory`](../tool-memory); this package owns the service, the store, and the prompt section.

## Service

`MemoryService` (context key `memory`) owns one JSONL store file, by default `memory.jsonl` under `$DSH_HOME` (or `~/.dsh`), created on first write. Every mutation rewrites the file from the in-memory index, so the file is derived data; a torn last line from an interrupted write is dropped on load rather than fatal.

A record carries a `kind` (`fact` | `preference` | `lesson`), one concise `text` sentence, a `scope` (`global`, or one exact workspace `cwd`), timestamps, and a recall hit counter.

- `remember(kind, text, scope)` stores one record. A restatement with the same kind, text, and scope consolidates into the existing record — `updatedAt` refreshes, no duplicate appears.
- `forget(id)` removes one record and reports the miss for an unknown id.
- `search(query, { cwd, limit })` ranks the records applying in one workspace: verbatim substring matches score highest, each shared word token adds, and records updated within the last day get a small freshness bump. Workspace records apply only when the caller's cwd is exactly their declared root; global records apply everywhere. Recalled records get their hit counter incremented and persisted.
- `recallText(cwd)` renders the top records as the model-facing recall section, or the empty string with none.

## Recall injection

`apply()` publishes the service and registers a `systemPrompt.context()` entry named `memory:recall` at order 70 (after `context-rules` at 60). The section text is computed per assembly from the calling agent's session cwd, so one session's workspace memories never leak into another workspace's prompt.

## Model Experience

### Recall section

#### What the model sees

When the workspace has memories, the system prompt carries a fixed `memory:recall` section listing the top-ranked records as `- [kind] text (this workspace)` lines under a fixed preamble stating these are durable observations from earlier sessions, not instructions from the current user, and that the current request wins on conflict.

#### Token effect

One section per request, bounded by `maxRecall` records (default 12) plus the fixed preamble; zero tokens with no memories.

#### KV Cache effect

The section rides the stable system-prompt prefix, so within a session it invalidates the prefix only when a write or hit-count change lands between requests; sessions without memories never pay for it.

## Known Limitations and Deferred Work

- **Exact-cwd workspace scoping** — a workspace memory applies only when the session cwd equals the recorded root exactly; symlinked or nested paths do not match. A normalization step can join later without a store change.
- **No embedding recall** — ranking is lexical (verbatim plus token overlap); semantic retrieval needs an embedding provider behind the same `search()` contract.
- **No automatic extraction** — records are written by the model through the tools or by deployment code; no background pass derives memories from session transcripts.
