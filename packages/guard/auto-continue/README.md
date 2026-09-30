---
description: "Loop-hygiene guard that continues a turn the output ceiling cut off, for users and maintainers choosing, configuring, or debugging the plugin."
kind: "package-reference"
---

# @deepseek-ai/dsh-auto-continue

English | [中文](README.zh.md)

## Summary

A model with a small output budget — a free routed model capping at a few thousand tokens, a reasoning model that spends its ceiling on thinking — can end a step at the output-token limit mid-answer, even mid-tool-call. Without help the turn closes there: the answer is truncated, a code edit is dropped, and finishing the work takes a manual "continue" message, repeated until the model happens to fit. `dsh-auto-continue` steers one continuation prompt at the turn's stopping boundary, so the model resumes the same response in the same turn — the accumulated partial output stays, the tool call that was cut off is re-issued whole, and the conversation keeps its context. A consecutive-continuation cap keeps a model that never finishes from burning requests forever, and a new user message resets the count. It ships enabled in the `dsh` base bundle with up to 8 consecutive continuations.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin when a truncated answer should finish itself instead of waiting for the user. There is nothing to learn or wire: the `dsh` base bundle already runs it, and the default cap works for most sessions — raise or lower it below when your model needs more room or should give up sooner.

### When to choose it

Choose it when the model answers through a provider whose output ceiling is smaller than the answers your tasks need, so a long response reliably splits across continuations. Avoid it when every truncation must surface to the user as a stop — set `maxConsecutive` to `1` for exactly one automatic retry, or remove the plugin to stop only manually.

### Setting the cap

When you want more or fewer automatic continuations, mount the plugin with configuration:

```yaml
- name: '@deepseek-ai/dsh-auto-continue'
  config:
    maxConsecutive: 8   # automatic continuations before the turn closes truncated
```

| Field | Default | Meaning |
|---|---|---|
| `maxConsecutive` | `8` | Consecutive continuations steered before the guard stands down and the turn ends truncated |

Invalid configuration fails at startup with a clear error — a non-integer or a value below 1 — never a silent change of behavior. The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-auto-continue) documents every accepted value.

### What you get

With the defaults, a step that ends at the output ceiling receives one continuation prompt naming the exact cut and the cap, attributed to the plugin in the transcript. The model resumes from the truncation point in a new step of the same turn; each further truncation continues again, up to 8 times, then the turn ends with its recorded `max-tokens` ending. A user message in between resets the counter, so a fresh instruction always gets a fresh budget.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the guard decides to continue and what it steers; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The guard is built on four commitments:

- **Continue, never rewrite.** The guard steers a continuation prompt through the standard inbox; it never edits history or synthesizes output, so the model itself decides how to resume.
- **Decide from durable data.** Whether the turn's latest attempt actually finished truncated is read from the committed `assistant/*` stream — `turn/end` cannot hold the stopping turn's ending yet, and the sticky turn record alone would re-continue a turn that already finished its answer.
- **Count consecutive continuations.** A per-agent counter capped by `maxConsecutive` bounds the worst case — a model that burns its whole budget on reasoning every attempt — while a working long answer chains freely within the cap.
- **Fail loud at load.** `maxConsecutive` validates in `apply` and throws, never falling back to a default.

### Decision: the stopping boundary

The guard listens to `agent/turn-stopping`, which the loop dispatches only when the latest step closed the model's response obligation — a step that dispatched tool calls reopens the obligation, so its results reach the model before the guard can steer. The payload carries the turn's pending ending; the guard steers when three facts hold:

- the pending ending is `max-tokens`;
- the turn's most recently settled attempt, read backwards from the session log, finished with a `max-tokens` finish — this is what keeps the sticky record from re-continuing a completed answer;
- the consecutive count, incremented per steer, is within `maxConsecutive`.

The continuation rides `agent.steer(...)`, so it enters the next step's claimed input as a `user/message` with the plugin's source — model-visible, source-attributed, and reconstructable from the session log with no new session event. A user-sourced message in any claimed batch deletes the counter (a `agent/pre-step` reset hook that always delegates), so continuations across an interjection are not one run.

### Per-agent keying

The counter lives in a `WeakMap<Agent, number>`; one agent's continuations never disturb another's, object lifetime bounds the entry, and a session resumed from persistence starts with a fresh count — the resumed turn's first truncation gets a full budget again.

### The chat notice shares the verdict

The turn-end notice is owned by `dsh-client-ui-chat`, not by this plugin, but it answers the same question: a turn that continued to a normal finish records the sticky `max-tokens` ending yet shows no notice, and only a turn that actually ended truncated shows one. The assistant node publishes that per-attempt verdict from each attempt's durable finish record, and a stream carrying none defers to the recorded ending. The `truncated` field on `AssistantChatData` is that published verdict.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema, fail-loud validation, stopping-boundary and reset listeners |
| [`src/truncation.ts`](src/truncation.ts) | Output-ceiling verdict over the stopping turn's durable log |
| — | No runtime invariant companion is published; the continuation counter is private to one stopping-boundary listener and exposes no package-owned event or snapshot that an independent companion can observe. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the stopping boundary to exhaustive configuration and the guard group map.

- [Architecture — turn flow](../../../docs/architecture.md#turn-flow) — when `agent/turn-stopping` fires and what its payload carries.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-auto-continue) — every accepted config field and its source declaration.
- [guard group map](../README.md) — the sibling guard packages and the loop-hygiene family.

-----

<a id="model-experience"></a>
## Model Experience

### Continuation context message

#### What the model sees

A step truncated at the output ceiling is followed, in the next step's input, by the continuation below. No tool schema or normal-turn text is added.

##### Continuation prompt

```markdown
Your previous response was cut off at the model output-token limit before it finished. Continue that response from exactly where it stopped: do not repeat or rephrase content the conversation already holds. If a tool call was cut off before it completed, issue the complete tool call again.
```

#### Token effect

The continuation is retained history for that agent, ~60 tokens per steer, and each continued request re-sends the accumulated transcript.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the guard is a poor fit. They are current package constraints, not a task backlog.

- **The cap counts steers, not progress** — a model that truncates while genuinely advancing hits the same cap as one that only burns reasoning; the reset on user input is the pressure valve.
- **No provider-specific resume protocol** — the continuation is a plain prompt; providers offering a native continuation token or prefill are not special-cased.
- **In-memory only** — the counter does not survive a session reload; a resumed turn starts a fresh budget, so a stop-cap-broken model can be nudged again after a restart.
- **Truncated reasoning is retained** — the partial reasoning block stays in the transcript and replays as reasoning content, which is what lets the model resume mid-thought; providers that reject passback of partial reasoning will reject the request independently of this guard.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

The auto-continue Agent Note records the observed failure (free routed models truncating at step 1 after a manual "continue") and the alternatives rejected for the stopping-boundary seam, including why the sticky `max-tokens` record does not drive the steering decision.

</details>
