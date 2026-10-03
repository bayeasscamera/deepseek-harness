# Agent Note: A weekly schedule rule with an explicit zone

Status: implemented

English | [中文](2026-10-03-weekly-schedule-rule.zh.md)

## Problem

Schedule could repeat on a fixed interval only. The version's own example — "regenerate this report from the CSV every Monday at 9am" — needs a rule that names a weekday, a local time, and a zone, and the shipped scope recorded calendar recurrence as a future product boundary rather than pretending a fixed rate covered it: `every_seconds` is anchor-aligned, so a rule built from it drifts by an hour twice a year and cannot state "Monday" at all.

## Decision

`schedule` gains a `weekly` record kind: `{ kind: 'weekly', prompt, weekday, time, timeZone, scheduledAt }`, where `weekday` is the ISO day (1 is Monday), `time` is a local `HH:MM` with no seconds, `timeZone` is a canonical IANA Area/Location zone, and `scheduledAt` stays the earliest occurrence not yet dispatched. `schedule_create` accepts `weekly` as its fourth selector beside `after_seconds`, `at`, and `every_seconds`; the tool refuses a weekday outside 1–7 or a time that is not `HH:MM` before anything is written, and the record builder refuses a zone this runtime cannot resolve.

Occurrences are resolved in the record's zone, and the local wall clock is what the rule keeps: the same `09:00` stays `09:00` across a daylight-saving change, so its UTC instant moves by the offset change. Two edges are decided rather than left to chance. A spring-forward that skips the stated time entirely — `02:30` in a zone that jumps from `02:00` to `03:00` — fires at the first instant after the gap, because a reminder that arrives when the clock passes its target beats one that never arrives; an autumn overlap that repeats the stated time fires at the first of the two instants, which is also what the existing `at` resolution does for a local time. At the calendar's end a rule reports its last representable occurrence and no next target, exactly as a fixed rate does.

The runtime's batch path was generalized rather than duplicated: `EveryDue` became `RecurringDue`, the decision kind `every` became `recurring`, and the framing renderer `renderEveryReminderBatchFraming` became `renderRecurringReminderBatchFraming`, so one overdue batch carries both fixed-rate and weekly reminders in target-then-creation order. Catch-up is latest-only for both kinds, as it was for a fixed rate.

**No session-format version bump.** A new record kind is a payload addition, and the version mechanism's own rule is that v2 "keeps the physical codec neutral to ordinary event vocabulary and payload additions" — the version integer exists for structural change (header shape, envelope, core event semantics, the surface mechanism). The change therefore ships without a migration edge, and an older build meeting a `weekly` record refuses that record rather than misreading it, which is the documented behaviour for payload vocabulary a reader does not know.

## Alternatives considered

**A Cron expression.** One field could express every rule a person might want, and the model already knows the syntax. It lost because it is a language to parse, validate, document, and explain in a denial, for a product surface that needs one weekday and one time; a Cron string also carries no zone, so the zone would have to travel beside it anyway.

**`every_seconds` in multiples of a week.** No new record kind, no new arithmetic. It lost on correctness: a fixed rate is anchor-aligned, so a weekly rule built from it keeps its UTC instant and drifts by an hour at every daylight-saving change, and it cannot name a weekday at all.

**Storing the resolved UTC offset instead of the zone.** The occurrence arithmetic would be simpler and the record smaller. It lost because it is the same drift by another name: an offset captured in winter is wrong in summer, and re-resolving it needs the zone that was thrown away.

**A new session-format version with a migration edge.** Defensible as a conservative reading of "when unsure, bump". It lost because the mechanism note already answers the case: payload additions are what v2's codec is explicitly neutral to, and an identity migration edge would be ceremony that the adjacent-catalog machinery would have to carry forever.

## Consequences

A reminder can now say "every Monday at 09:00 in Europe/Paris" and keep that promise through a daylight-saving change, which is what the version asked for. The cost is more time arithmetic in a package that already owned some: the weekly path adds zone projections, a bounded seven-day walk to find the due local date, and the two DST decisions above, all of which are covered by tests that pin the Paris spring-forward and autumn-overlap instants rather than trusting the library. The limits are recorded in the README: one weekday, one local time, no month days, no Cron, and the group still has no way to reach a cold session.
