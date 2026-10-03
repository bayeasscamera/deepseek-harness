# Agent Note: Binary writes in the filesystem seam

Status: implemented

English | [中文](2026-10-03-filesystem-binary-writes.zh.md)

## Problem

`ctx.fs` could read raw bytes (`readBytes`, `readByteRange`) but could only write text: `writeText` takes a `string`, normalizes line endings, and answers with a before/after diff basis. A tool that produces an artifact which is not text — a presentation, an archive, an image, a workbook — therefore had no way to put it in the workspace: encoding the bytes as a string corrupts every byte above `0x7F`, and writing the file directly with `node:fs` from a tool would step outside the seam's resolution, its per-target lock, its write-intent guards, and the sandbox policy that fences it.

## Decision

`FileSystem.writeBytes(target, content: Uint8Array, expected?, signal?, sandboxPolicy?)` is the seam's raw-byte mutation, answering `FsWriteBytesOutcome { operation, version, bytes }`. It applies the same guards as `writeText` — `createIfAbsent` refuses a target the caller never read, `replaceIfVersion` refuses a stale or missing target — and publishes through the same atomic path each provider already had: the local backend through its private, synced staging directory with the same no-replace link publication for guarded creation, the E2B backend through its staging directory, `chmod`, and committed rename. It has no diff basis, deliberately: bytes have no line structure to present as one, so the outcome reports the size written instead of `before`/`after`, and the presentation layer falls back to its whole-file diff.

The two writers share their guards. The local backend's inline guard block became `assertWriteIntent(existing, expected, displayPath)` in `fsio.ts`, called by both `writeText` and `writeBytes`, so the refusal codes and messages stay identical for text and bytes and cannot drift apart. The E2B backend already had `checkWriteIntent` and reuses it. The local atomic writer (`fsio.ts`'s `writeFileAtomic`) now takes `string | Uint8Array` and passes the utf8 encoding only for text. The E2B writer hands the sandbox SDK an `ArrayBuffer`, which is what its `files.write` accepts, copied through `content.slice().buffer` so a view into a larger buffer can never publish its neighbours.

## Alternatives considered

**Extending `writeText` to take `string | Uint8Array`.** One method instead of two, and no new outcome type. It lost because the text contract is load-bearing in the other direction: `FsWriteOutcome.after` is a `string` (the LF-normalized diff basis), line-ending normalization applies to text and must not touch bytes, and every existing consumer of the outcome would have had to handle a variant it cannot diff. Two methods keep each contract total.

**Base64 through `writeText`.** No seam change at all, and the guards come for free. It lost because it does not produce the artifact: the workspace would hold base64 text where a `.pptx` is expected, and decoding it would need either a second tool or a shell round-trip — the model paying tokens to carry bytes it never reads.

**Writing the file directly from the tool with `node:fs`.** The shortest path to a working feature. It lost on the seam's own terms: it would bypass path resolution, the per-target lock, the write-intent guards the observation policy installs, and the sandbox policy that fences every other mutation, making one tool the single place where the confinement does not apply.

**A binary-only backend beside the text one.** It would have avoided touching `writeText`'s contract. It lost because every provider would still have to implement byte publication — the same staging, guards, and atomicity — so the split would duplicate the hard part and give a tool two filesystem services to choose between.

## Consequences

A tool can now produce a binary artifact inside the session workspace with the same confinement, locking, and staleness guards as a text write, which is what the presentation-generation work needs. The price is a second mutation method to keep aligned with the first: the guards are shared code now, but the publication path exists twice per backend (once for text, once for bytes) because the content types differ at the point of writing. The byte write keeps no contextual basis, so a binary overwrite is presented as a whole-file change rather than a hunk diff; that is a presentation limitation, not a data one. Both shipped providers are covered to the same per-file standard as their text paths, and the seam documents that text operations reject non-UTF-8 content while `writeBytes` publishes bytes as they are.
