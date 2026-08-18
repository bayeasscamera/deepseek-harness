# 长期记忆

[English](memory.md) | 中文

跨会话持久记忆：工作区作用域的记录、词法召回分级与面向模型的 prompt 小节。[包契约](../../packages/memory/memory) 拥有存储文件格式、合并与作用域；[工具](../../packages/memory/tool-memory) 负责被记录的写入、搜索与遗忘。

Source: [`packages/memory/memory/src/index.ts`](../../packages/memory/memory/src/index.ts)

## 记录

`MemoryRecord` 是一条持久观察。id 即遗忘键；`hits` 统计召回次数。

```ts type-equiv
/** One durable memory record. */
interface MemoryRecord {
  /** Stable id, also the forget key. */
  readonly id: string
  /** What the record says about its subject. */
  readonly kind: MemoryKind
  /** The remembered statement, one concise sentence. */
  readonly text: string
  /** Where the record applies. */
  readonly scope: MemoryScope
  /** Wall-clock creation time in milliseconds since the epoch. */
  readonly createdAt: number
  /** Wall-clock time of the last re-confirmation, in milliseconds since the epoch. */
  readonly updatedAt: number
  /** How many times recall has surfaced the record. */
  readonly hits: number
}
```

## 种类与作用域

`MemoryKind` 区分稳定事实、偏好与失败教训；`MemoryScope` 将记录限定于所有工作区或某一个精确根。

```ts type-equiv
/** What a record says about its subject. */
type MemoryKind = 'fact' | 'preference' | 'lesson'
```

```ts type-equiv
/** Where a record applies: everywhere, or one workspace root. */
type MemoryScope = 'global' | { readonly cwd: string }
```

## 召回

`search()` 让逐段子串匹配排在词元重叠之上，并严格在零分过滤之后加入有界新鲜度加成；工作区记录仅在 cwd 精确匹配时适用。`memory:recall` prompt 小节在固定前言下渲染最高分记录——它们是持久观察而非当前用户指令；冲突时以当前请求为准。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmemory--memoryservice"></a>

### `ctx.memory` — `MemoryService`

The long-term memory service: owns the durable record store, consolidates duplicate writes, ranks recall, and exposes the per-session prompt section.

```ts cordis-catalog
/**
 * Store one memory. A write that restates an existing record (same kind,
 * text, and scope) consolidates into it instead of duplicating: the existing
 * record's `updatedAt` refreshes and the new hits reset is skipped.
 * @param kind - what the record says about its subject.
 * @param text - the remembered statement; trimmed, must be non-empty.
 * @param scope - where the record applies.
 * @returns the stored (new or consolidated) record.
 */
remember(kind: MemoryKind, text: string, scope: MemoryScope): MemoryRecord

/**
 * Remove one record by id.
 * @param id - the record id from a previous remember or search result.
 * @returns whether a record was removed.
 */
forget(id: string): boolean

/**
 * Rank and return the records matching a query in one workspace.
 * @param query - free-text query; an empty query returns the freshest records.
 * @param options - `cwd` scopes workspace records in, `limit` caps the result.
 * @returns matching records, best score first, ties by most recent update.
 */
search(query: string, options: { cwd?: string; limit?: number } = {}): MemoryRecord[]

/**
 * Render the recall prompt section for one workspace: the highest-ranked
 * records under a fixed instruction, or the empty string with none.
 * @param cwd - the session workspace root, when known.
 * @returns the model-facing section text.
 */
recallText(cwd: string | undefined): string
```

Source: [`packages/memory/memory/src/index.ts:110`](../../packages/memory/memory/src/index.ts)
<!-- END GENERATED cordis-surface -->
