# Agent Note: skill import installs through a staging copy and one rename

Status: implemented

English | [中文](2026-09-29-skill-import-atomic-install.zh.md)

## Problem

`settings/importSkill` copied the picked folder straight onto its target and treated a `stat` on that target as the collision test. Three failures followed from that shape, none of them observable in the success path. A `stat`-then-`cp` sequence is a time-of-check to time-of-use gap: `fs.cp` with `recursive` merges into a directory that already exists instead of refusing it, so an import racing another import could interleave files into an installed skill. A copy that failed part-way left a half-written folder in the user skill directory, which discovery then read as a nameless entry, logged, and refused to re-import over. And the import rescanned the roots itself, so a discovery failure after a successful install reported the import as failed while the skill sat installed on disk.

The install now stages the copy in a sibling folder named `.dsh-import-<name>-<random>`, moves it with a single `rename`, and drops the staging copy in a `finally`. The rename is the only step that can meet an existing target, so its refusal is the collision signal and no separate existence check is needed. `cp` runs with `verbatimSymlinks` so a link inside an imported folder keeps the target it was written with instead of being rewritten relative to the new location. One install runs at a time per controller: a caller arriving mid-install joins the running one instead of racing it. A picked folder that encloses the user skill directory is refused before validation, because copying it would recurse through the staging copy the install creates. The rescan moved to the caller, which already had one: the tab refreshes through `refreshSkills` after a successful import.

## Decision

An install is a directory publication, so it uses the publication primitive the platform already has — write beside the target, then rename — instead of a copy whose partial state is observable. The staging prefix is not a lock: it names the copy so a failure leaves something recognisable next to its target, and the `finally` is what makes the presence of that residue impossible on every path the code can take.

`containsDirectory` resolves both paths with `realpath` before comparing, because a picker can hand back a relative path or a symlinked spelling of the same folder, and a lexical prefix test would miss the second case.

The accepted name is the only thing that addresses the target, and the acceptance contract already restricts it to kebab-case, so `join` cannot escape the user skill directory. A test imports a manifest declaring `../../escaped` and asserts the skills directory is never created, which is what makes the invariant executable rather than asserted.

## Alternatives considered

**Keep the copy and narrow the existence check.** `fs.cp` with `recursive` merges into a directory that already exists, so an earlier check narrows the window without closing it: two imports racing between the check and the copy still interleave files into an installed skill. The rename publishes the whole directory or nothing.

**Test the enclosure with a lexical prefix.** A picker can hand back a relative path or a symlinked spelling of the same folder, so comparing the unresolved strings misses the case the check exists for; resolving both sides with `realpath` is what makes it hold.

**Refresh discovery inside the import.** The import would then report a failure for a skill it did place on disk when the later rescan failed. The rescan belongs to the caller, which already lists through `refreshSkills`.

## Consequences

A refused import no longer merges into an installed skill, and no longer leaves a folder that blocks the next attempt. The wire result is unchanged, so the tab and the SDK client needed no protocol change.

The host no longer refreshes discovery as a side effect of an import. `importSkill` documents that callers list through `refreshSkills` to observe the installed folder, and the tab already did.

The tab now drains its feedback timers when it unmounts, so a message cannot set state on an unmounted component, and a render test covers the component's states rather than leaving them to a browser-grade harness.
