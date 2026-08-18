# Long-Term Memory

English | [中文](memory.zh.md)

Durable cross-session memory: workspace-scoped records, lexical recall ranking, and the model-facing prompt section. The [package contract](../../packages/memory/memory) owns the store file format, consolidation, and scoping; the [tools](../../packages/memory/tool-memory) own logged writes, searches, and forgets.

Source: [`packages/memory/memory/src/index.ts`](../../packages/memory/memory/src/index.ts)

## Records

`MemoryRecord` is one durable observation. The id is the forget key; `hits` counts recalls.

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

## Kind and scope

`MemoryKind` separates stable truths from preferences and failure lessons; `MemoryScope` bounds a record to every workspace or exactly one root.

```ts type-equiv
/** What a record says about its subject. */
type MemoryKind = 'fact' | 'preference' | 'lesson'
```

```ts type-equiv
/** Where a record applies: everywhere, or one workspace root. */
type MemoryScope = 'global' | { readonly cwd: string }
```

## Recall

`search()` ranks verbatim substring matches above token overlaps, adds a bounded freshness bump strictly after the zero-score filter, and applies workspace records only on exact-cwd matches. The `memory:recall` prompt section renders the top records under a fixed preamble stating they are durable observations, not current-user instructions; the current request wins on conflict.

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
