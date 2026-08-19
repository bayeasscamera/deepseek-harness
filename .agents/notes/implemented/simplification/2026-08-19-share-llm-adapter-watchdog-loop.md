# Agent Note: Share the LLM adapter idle-watchdog stream loop

Status: implemented

English | [中文](2026-08-19-share-llm-adapter-watchdog-loop.zh.md)

## Problem

`dsh-llm-deepseek` and `dsh-llm-pi-ai` each hand-rolled the same stream-lifecycle loop around `idleWatchdog`: fuse caller cancellation, arm the watchdog around each outstanding iterator demand, tear the iterator down on a non-exhausted exit, and classify the outcome. The two copies had drifted. `dsh-llm-pi-ai` probed `timeoutOf(watchdog.signal, …)` after every demand and threw the reason in-loop; `dsh-llm-deepseek` only classified in its `catch`. Their teardown also differed: pi-ai aborted its consumer controller inside the loop's `finally` before returning the iterator, deepseek did it in the outer `finally`. The drift is not cosmetic: the pi-ai SDK converts a watchdog abort into an `aborted` finish *chunk* and returns normally, so a loop without the in-loop probe would surface a watchdog expiry as `ABORTED` instead of `TIMEOUT` — the exact misclassification a retry policy then acts on wrongly (`ABORTED` is not retryable, `TIMEOUT` is).

## Decision

Extract the loop as `watchdogStream({ watchdog, watchdogCode, iterator })` in `@deepseek-ai/dsh-llm` (new `src/stream-watchdog.ts`, exported from the package root). The helper drives the demand loop, probes the watchdog after every demand and throws its `TimeoutReason` when it fired — before honoring a `done` result, so a transport that returns normally on abort still classifies as a timeout — and returns the iterator on any non-exhausted exit, swallowing only the teardown's own abort. Classification stays adapter-owned: each adapter's existing `catch` still maps the propagated reason through `timeoutOf` to its `TIMEOUT`/`ABORTED`/`TRANSPORT` `LlmError`, and each adapter still owns its consumer controller, credential snapshot, and request construction. `dsh-llm` already peer-depends on `dsh-timeout`, so no new dependency edge was added. Both adapters now call the one helper; pi-ai's redundant inner `try`/`finally` collapsed into its outer `catch`/`finally`.

## Alternatives considered

Put the helper in `dsh-timeout`. Rejected: the timeout library only notifies through abort signals and deliberately leaves outcome translation to each capability; a loop that exists to serve the LLM seam's chunk-iteration contract belongs with that seam, and `dsh-llm` already peer-depends on `dsh-timeout` for exactly this composition.

Leave the two loops separate and add tests pinning the drift. Rejected: the drift was the bug surface — two copies of a correctness-sensitive loop will drift again, and the pi-ai probe exists precisely because one transport hides aborts as chunks; a shared loop makes that fact one documented invariant instead of two implicit ones.

## Consequences

- One demand loop serves both adapters; a future transport quirk (abort-as-chunk, abort-as-throw, or neither) is handled once, and `watchdogStream`'s unit suite pins the probe-before-`done` ordering, the teardown-on-failure, and the teardown-swallow behaviors directly.
- DeepSeek's classification gains the probe: a stream whose final demand resolves `done` in the same tick the idle interval elapsed now reports `TIMEOUT` rather than a silent success. The idle interval is the contract, so an expiry that raced the last chunk to a win is still an expiry; the existing 76-test deepseek suite and 45-test pi-ai suite pass unchanged.
- The adapters keep everything deployment-specific: connection facts, credential resolution, request serialization, and the `LlmError` wording and codes. No model-visible behavior, session event, or wire format changed.
