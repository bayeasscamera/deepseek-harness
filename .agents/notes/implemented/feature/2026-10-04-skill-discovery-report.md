# Agent Note: A skill that is not discovered says why

Status: implemented

English | [中文](2026-10-04-skill-discovery-report.zh.md)

## Problem

Local skill discovery reads one level deep: `<root>/<name>/SKILL.md` or `<root>/<name>.md`. Anything else in a root was silently nothing. A folder holding a collection of skills — the shape every published catalog ships in — contributed no skills, no log line, and no catalog entry, while the Skills tab's own hint invited exactly that placement ("Place a skill folder containing a SKILL.md file there to install it") and its import action would have installed the same folder correctly.

The cost was measurable on one machine: `~/.dsh/skills` held four such folders carrying 670 `SKILL.md` files between them (636 in one cloned examples repository), and the catalog showed 45 skills with nothing to explain the gap. The provider README recorded the one-level rule and the model-side gap ("the model catalog receives no per-skill diagnostic and cannot distinguish an absent skill from an invalid one"), but nothing told the operator, who is the only actor that can fix it.

## Decision

A provider may now report **skips** beside its candidates, and the user-facing surface renders them. `SkillProviderObservation.skipped?: readonly SkillDiscoverySkip[]` carries `{ path, reason, nested?, truncated? }`, where `reason` is `nested-skills`, `invalid-frontmatter`, `missing-name`, `invalid-name`, or `unreadable`; `SkillCatalogSnapshot.skipped` is the merged list, one finding per path, in layer then provider order.

Three rules decide what is reported:

- **A folder is a finding only when it holds skills.** A folder with no `SKILL.md` below it (an asset directory, `node_modules`) reports nothing; a folder with a bounded count of nested manifests reports `nested-skills` with that count.
- **The count is what an import would install.** The walk reuses the import scan's depth and stops at a manifest ceiling and a directory budget, reporting `truncated: true` rather than walking an unbounded tree, so "import it" is the fix the report implies. The count is bounded in work, not only in output.
- **Only a confirmed absence is absence.** The read path decides it: only `ENOENT`-equivalent failures answer "absent", a path that exists but cannot be read throws or answers `unreadable`, and a thrown failure still marks the observation incomplete and preserves the last-good catalog instead of becoming a quiet "no skill here". The nested count then re-stats the folder's own manifest as a second opinion, so a bundle whose manifest vanished between listing and reading reports exactly the skill content the folder still holds — nothing when it holds none.

The diagnostic never enters the model catalog: the model cannot act on it, and the catalog is a routing surface, not a status page. The settings controller exposes it on the same wire value as the catalog (`SkillInventoryValue { skills, skipped }`), and the Skills tab renders it above the list it did find — one line per entry, with the reason, capped at ten named entries plus a remainder line.

A malformed skip fails the observation exactly as a malformed candidate does: a diagnostic that names no path or an unknown reason is a provider defect, and half-reading it would be worse than rejecting it.

## Alternatives considered

**Discover the plugin layout in place** (`<plugin>/skills/<name>/SKILL.md`). One extra level would make a cloned collection work with no import step, which is what a user expects when they clone a skills repository into the root. It lost on two counts: the examples repository on this machine alone would have added 636 catalog entries (~40k tokens) of skills the operator never chose, and the import flow already exists, already flattens a picked folder correctly, and keeps the choice with the user. The problem was the silence, not the depth.

**Warn on the host log and leave it there.** Cheapest possible fix, and the provider already logs malformed manifests. It lost because the log is not where the question is asked: the operator looks at the Skills tab, and a host log line answers a question nobody is reading for.

**Report every folder without a manifest.** No bounded scan, no count, no false-negative risk. It lost because it would report ordinary asset folders, and a report that is mostly noise stops being read — the notice has to mean "this one is a skill collection".

**Put the diagnostic in the model catalog.** The model could then tell the user why a skill is missing. It lost because the catalog is injected into every step's context: a machine with four skipped folders would pay for that text on every request, for a fact only the operator can act on.

## Consequences

A folder dropped into a skill root now produces either skills or a stated reason, which closes the gap the README had recorded as a limitation rather than a decision. The provider owns a bounded diagnostic walk (depth, manifests, directories) on the miss path only, and the registry carries one more field through its cache — skips are cached with the catalog they describe, so a second read does not re-walk anything.

Two limits remain, both recorded in the READMEs: the count is bounded, so a very large collection reports `truncated` with a floor rather than an exact number; and a provider that fails discovery outright still contributes no finding beyond the registry's log line, because a rejected provider has no observation to report from.
