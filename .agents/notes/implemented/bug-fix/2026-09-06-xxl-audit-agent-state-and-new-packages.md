# Agent Note: XXL audit treatment — agent-state feedback discipline, snapshot-hang root cause, and new-package completion

Status: implemented

English | [中文](2026-09-06-xxl-audit-agent-state-and-new-packages.zh.md)

## Problem

The 2026-09-05 XXL audit found four interacting defect classes. First, the headless snapshot hung: mounting `agent-state` in the base bundle (380c2cd0af) made its post-execute listener attach a `[bash] settled success …` comparison notice to every settled tool call, and the keyless headless mock (`cli-mock-llm.ts`) decided its next response from `messages.at(-1)` alone — the notice masked the tool-result, so the mock re-emitted the same bash call forever (992 iterations at ~50 Hz, rewriting the store each time). Second, `agent-state` violated two written conventions: its pre-step listener returned `{kind:'enter'}` without `next()`, discarding later listeners' contributions and the runtime-context projection, and its store documented atomic replacement while `saveState` performed a plain `writeFileSync`. A related latent bug surfaced while testing: `loadState` replaced the observation list per row instead of concatenating, so any reload kept only the newest observation. Third, the six new WIP packages were unmountable scaffolding: unwired engines, READMEs documenting nonexistent behavior, path traversal, dropped disposers, coverage-gate-impossible tests. Fourth, committed packages carried findings of their own (advisory-only denylist with unbounded breaker noise, stat-hash staleness, text-only promotion confinement, case-sensitive Bearer stripping, swallowed sandbox-listener errors).

## Decision

**agent-state emits surprises only.** The post-execute listener still folds every settled observation into the durable statistics, but attaches the comparison as an additional context only when the outcome is a failure or the prediction mismatched; a matched success injects nothing. The mock now scans backwards for the latest tool-result block, so notice messages can never mask it regardless of which guards inject context. The pre-step listener delegates with `await next()` and prepends the recall on top of the merged decision. `saveState` writes a sibling `.tmp` and renames; `loadState` concatenates observation rows in persisted order; retention caps (`maxObservations`, `maxLessonsPerTool`) became validated Config fields.

**The six new packages were completed rather than deleted.** Each now carries the wiring its README claims: world-model's consequence engine listens on the tool pipeline (surprise-only feedback, per-cwd store map, fail-loud schema version), auto-continue owns rate-limit recoveries on the `agent/request-error` waterfall within a per-agent budget, screen-reader wires verbosity through a per-context service with an `assertNever` tail, ios-simulator injects its process runner so tests never spawn `xcrun`, design-artboard validates the read path with the same stem predicate as the write path and reports real mtimes. All six are release members under the workspace version (`0.1.0-rc.5`): published metadata, `private` removed, deps matched to imports, per-file 100% coverage, and all seven tools catalogued through the gen-tool-catalog manifest, whose completeness guard now also pins the non-`tool-*` directories explicitly.

**Committed-code fixes preserve waterfall semantics.** The host-runner sandbox wrapper distinguishes waterfall invocations (it delegates to `next()` even when the wrapped listener threw, so a failure can never veto the chain) and rethrows after quarantine bookkeeping on emit listeners. Promotion containment re-verifies `ctx.fs.contains` after resolution, closing the symlink redirect that text-only prefix checks allow. Bearer stripping is scheme-word case-insensitive; the typert reuse hash is content-based; the auto-verification breaker fires exactly once per target and its README states the denylist is advisory and post-hoc.

**Onboarding takeover inerts the whole document except itself.** Portaling the settings panel to `document.body` escaped the previous `#root`-only inert scope, leaving body-portaled dialogs keyboard- and screen-reader-reachable under a takeover; the surface now inerts every body child it did not inert on entry and restores exactly those on unmount.

## Alternatives considered

**Fixing the mock instead of the guard.** Rejected as the only change: the notice-on-every-call behavior also injected a model-visible message after every tool call in real sessions, an unconditional token cost no composition asked for. Keeping matched successes out of the model-visible stream fixes both the desync and the noise; the mock hardening stays because fixture brittleness was a second independent defect.

**Merging world-model's engine into agent-state.** Deferred with the overlap documented: both keep heuristic risk tables that will drift, but deleting a package the user authored is a product decision, not an audit fix. The shared machinery (atomic write, surprise-only feedback) was ported; the table merge is recorded as deferred work.

**Rebasing the unpushed stack to move the mislocated test hunk from 974e6d3d0b into fadc5ff600.** Skipped: the rewrite risk across ten commits outweighs a bisect-only inconvenience on a branch whose final tree is coherent.

## Consequences

Every snapshot replays keylessly again (115/115) and the unit suite grew by roughly two hundred tests to 13 701, all green with the coverage, hygiene, duplication, and doc gates. Agent-backed sessions no longer carry a per-tool-call notice; model-visible feedback is limited to surprises and confirmed high-risk successes. The new packages are loadable, documented, and catalogued, though none is mounted in a default profile — mounting remains an explicit composition decision per profile.
