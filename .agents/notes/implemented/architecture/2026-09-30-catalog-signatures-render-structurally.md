# Agent Note: Cordis catalog signatures render structurally, not from source text

Status: implemented

English | [中文](2026-09-30-catalog-signatures-render-structurally.zh.md)

## Problem

[`memberText`](../../../../packages/typert/generator/src/analyzer.ts) produced a signature by copying the source text of the declaration and collapsing every whitespace run to a single space. The Cordis catalog projector consumed that string for event signatures, while [`FaceModelEmitter`](../../../../packages/typert/generator/src/emitter.ts) re-rendered the same signature structurally from its type model.

The two agreed only by accident: both were reading whatever layout the source happened to have. Any re-wrapping of a declaration — a line crossing the print width, a formatter, a hand edit — made the committed catalog and the runtime emitter disagree, and the disagreement showed up as a `tools-catalog` failure about whitespace inside a parameter list rather than as a defect anyone could locate.

## Decision

The catalog renders event signatures through the same renderer the emitter uses, prefixed with the quoted event name exactly as the emitter prefixes it:

```ts ignore-check
signature: `${quote(event.name)}${this.renderer.renderSignature(node.signature)}`,
```

Service members keep `member.text`, because the emitter's `runtimeMember` uses `renderMember(member, true)`, whose `sourceModifiers` argument returns the source text and preserves source-only modifiers such as `async`. Rendering members structurally instead would drop `async` and break the round-trip in the other direction.

One signature renderer, and the catalog no longer depends on source layout.

## Alternatives considered

Rendering members structurally as well, for symmetry, was tried and reverted: `renderMember` without `sourceModifiers` emits `create(exec: ToolExecutionInput)` where the emitter emits `async create(exec: ToolExecutionInput)`. Symmetry that disagrees with the emitter is not a simplification.

## Consequences

A signature that reaches the catalog through source text still tracks source layout, so a change that re-wraps one must regenerate the catalog in the same change; `gen-cordis-catalog` is the gate that proves it, byte for byte. Event signatures are now formatting-independent, so a future formatter does not touch them.
