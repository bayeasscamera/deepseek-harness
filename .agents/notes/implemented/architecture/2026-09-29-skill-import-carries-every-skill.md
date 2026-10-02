# Agent Note: a picked folder installs every skill it carries

Status: implemented

English | [中文](2026-09-29-skill-import-carries-every-skill.zh.md)

## Problem

Skill import read the pick as one skill in one folder: it required the pick to be a directory, required `SKILL.md` at that directory's root, and returned a single outcome. Discovery had always accepted two shapes — a directory carrying `SKILL.md`, and a flat `*.md` file sitting in the root itself — so the two disagreed about what a skill is. Every catalog the operator keeps grouped in sub-folders was invisible to import: selecting `EverythingClaudeCode/`, `anthropics:skills/`, or the skills root itself failed with `missing-skill-file`, and a flat markdown file could not be picked at all because the host chooser only offers directories.

`settings/importSkills` now resolves the pick the way discovery resolves a root. `findSkillSources` is the rule both sides share: `skillSourceOf` decides how one listed entry carries a skill and `discoverRoot` calls it, so the installer cannot drift from what a later scan will accept. A folder holding its own `SKILL.md` is one skill and is not descended into; any other folder is scanned for skill folders and flat markdown files, up to `SKILL_SOURCE_SCAN_DEPTH` levels, skipping dot-prefixed entries and symbolic links. A picked markdown file is a single flat skill. The verb returns one outcome per skill found, installed and refused alike, so a prose file discovered beside real skills is reported instead of silently installed or silently dropped.

## Decision

The target is addressed by the name the manifest declares, never by the file name on disk: a flat skill installs as `<skills>/<declared-name>.md` and a folder skill as `<skills>/<declared-name>/`. That keeps the installed file name and the skill's identity the same value, which is what makes a collision observable for the flat case at all.

Collision detection therefore differs by shape, and both are atomic. A folder moves with `rename`, whose refusal on a target holding files is the collision. A flat file links with `link`, whose refusal on an existing destination is the collision — `rename` would have silently replaced the installed file. Neither shape checks existence first.

The depth bound and the skipped-entry rules are the guard against a pick reaching outside itself: an unbounded scan over a wide folder would walk the filesystem, and following links would never terminate. A folder with no `SKILL.md` that yields nothing reports `missing-skill-file`, which is the same answer the single-skill verb gave and needs no new wire code.

## Alternatives considered

**Keep the single-skill reading of a pick.** Requiring `SKILL.md` at the picked directory's root was the shipped behaviour: every catalog an operator keeps grouped in sub-folders stayed invisible to import while discovery accepted it. The installer and discovery share one resolution rule instead.

**Address the target by the picked file name.** A flat skill would install under whatever the file happens to be called, so re-importing the same skill from a differently named file would land beside the first instead of colliding with it. The manifest's declared name is the identity, and the installed name follows it.

**Move the flat shape with `rename` too.** `rename` replaces an existing destination silently, so a flat import over an installed skill would overwrite it; `link` is the primitive whose refusal is the collision.

**Check the destination's existence first.** A check-then-publish sequence is a time-of-check to time-of-use gap, and `rename`/`link` already answer the question atomically.

**Scan a pick without a depth bound, following links.** A wide folder would walk the filesystem and a link cycle would never terminate; the bound and the skipped-entry rules keep the pick inside itself.

## Consequences

`importSkill` is replaced by `importSkills`, returning `SkillImportValue[]`. Nothing outside the settings controller and its tab referenced the old verb, so no SDK projection or recorded session moved with it; the tab already consumed a multi-outcome report.

The refused-cause vocabulary is unchanged, so a caller distinguishes failures exactly as before. What callers must now handle is a list: the tab renders the installed names and surfaces the first refusal reason, which is enough feedback for a batch and keeps one message instead of one per skill.

Discovery is unchanged in what it accepts. `findSkillSources` reads the same rule `discoverRoot` applies, so a picked folder installs as the set discovery will later list from the user skill directory.
