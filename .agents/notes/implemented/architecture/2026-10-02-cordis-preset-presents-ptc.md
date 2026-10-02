# Agent Note: the cordis preset presents PTC mode

Status: implemented

English | [中文](2026-10-02-cordis-preset-presents-ptc.zh.md)

## Problem

The shipped `cordis` preset — the coding agent that reads and writes the runtime it runs in — mounted its model-facing tool registry directly, while the shipped `ptc` preset mounted the same registry behind a presentation surface that turns it into a generated SDK driven through `run_code`. The two presets therefore disagreed about what an agent may call, and a reader could not tell whether the difference was deliberate.

## Decision

`packages/preset/agent-presets/presets/cordis/agent.cordis.yml` composes the same presentation row the PTC preset uses: `tool-presentation` at `mode: ptc`. The row waits for the host's `codeRuntime`, so a deployment that composes no TypeScript runtime fails this preset at mount, naming the row, instead of failing at its first request.

Because PTC makes `run_code` the only model-authored composition interface, the general `workflow` tool row is disabled in the preset as well. `workflow-worker-thread` and `tool-ralph` stay enabled: Ralph's fixed fresh-agent loop consumes the engine without publishing a second orchestration language, which is the same reasoning the archived [PTC omits the general workflow tool](../../archived/simplification/2026-09-01-ptc-omits-workflow-tool.md) note recorded for `ptc`.

The omission rule is therefore stated by the surface, not by the preset id: **a shipped preset that presents PTC mode omits the general `workflow` tool**, while a preset that publishes no presentation surface keeps it. The preset test asserts that form and checks the presentation row it keys on, so the next PTC-presenting preset inherits the rule without a second edit to the test.

The rows the two PTC-presenting presets share — result-truncation caps, the instruction cap, optional subagent providers, Ralph rounds, search timeout, glob sampling — ship as one set, so an agent behaves the same whichever of the two it loads, and `standard` keeps its smaller caps and its `workflow` tool.

## Alternatives considered

**Leave `cordis` without a presentation surface.** Then reading and writing its own runtime stays reachable only through the plain tool list and PTC mode exists only as a separate preset, which keeps the difference undocumented in the composition that is supposed to explain it.

**Publish `workflow` beside `run_code`.** Two model-authored orchestration languages with different execution semantics; the archived note above records this rejection, and the same reasoning applies the moment `cordis` presents PTC.

**Keep the test keyed on the preset id.** It passes today and silently misses the next preset that presents PTC, which is how the rule had to be written twice.

## Consequences

A deployment mounting the `cordis` preset now needs a host `codeRuntime`; without one it refuses to mount instead of degrading at the first request. The generated SDK for `cordis` and `ptc` omits the `workflow` binding while keeping `ralph`. The PTC picker description and the shipped preset tests still describe `standard` as publishing `workflow`, and any custom preset that mounts `tool-presentation` at `mode: ptc` is expected to disable its `workflow` row too.
