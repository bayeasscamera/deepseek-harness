# @deepseek-ai/dsh-tool-memory

English | [中文](README.zh.md)

Model-facing long-term memory tools over [`@deepseek-ai/dsh-memory`](../memory): `memory_write` stores a durable record, `memory_search` ranks what is remembered, and `memory_forget` removes one. Every call is a logged tool call; the memory service owns persistence and the recall prompt section.

## Tools

- `memory_write(kind, text, scope?)` — one durable memory. `kind` is `fact`, `preference`, or `lesson`; `scope` defaults to `workspace` (the calling session's cwd; `global` without one) unless the deployment pins `defaultScope: 'global'`. Restating an existing memory refreshes it instead of duplicating.
- `memory_search(query, limit?)` — ranked recall within the calling workspace; an empty query lists the freshest records.
- `memory_forget(id)` — removes one record by id; writing the corrected fact is preferred over forgetting, because restating does not replace old text.

## Model Experience

### Tool schemas and results

#### What the model sees

The model sees the generated [`memory_write`](../../../docs/tool-catalog.md#deepseek-aidsh-tool-memory), [`memory_search`](../../../docs/tool-catalog.md#deepseek-aidsh-tool-memory), and [`memory_forget`](../../../docs/tool-catalog.md#deepseek-aidsh-tool-memory) schemas with fixed descriptions stating when to write (stable facts, stated preferences, lessons worth recalling weeks later — never transient task state) and how recall already reaches the prompt. Results render one line per record: `id [kind] (scope) text`.

#### Token effect

Three schema rows per request, plus one short result line per write, search hit, or forget; the recall section itself is owned by `@deepseek-ai/dsh-memory`.

#### KV Cache effect

The schemas ride the stable tool-schema prefix; call results are per-turn output and never invalidate the prefix.

## Known Limitations and Deferred Work

- **No batch write** — one memory per `memory_write` call keeps consolidation and logging one-to-one; a batch form can join later by looping the same consolidation.
- **No tool-side listing UI** — search results are plain text lines; a richer presentation method can follow the tool-presentation seam without touching the store.
