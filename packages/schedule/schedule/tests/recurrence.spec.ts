import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  ScheduleId,
  createEveryScheduleRecord,
  createWeeklyScheduleRecord,
  decodeScheduleChange,
  foldScheduleEvents,
  renderRecurringReminderBatchFraming,
  resolveEveryOccurrence,
  resolveWeeklyOccurrence,
} from '../src/domain.ts'

const BASE = Date.parse('2000-01-01T00:00:00.000Z')

function event(data: unknown, seq: number): SessionEvent {
  return { type: 'schedule/change', seq, time: BASE, data } as SessionEvent
}

describe('fixed-rate recurrence properties', () => {
  it('keeps latest-only runtime calculation and durable folding on the creation anchor', () => {
    fc.assert(fc.property(
      fc.integer({ min: 300, max: 86_400 }),
      fc.integer({ min: 0, max: 10_000 }),
      fc.nat({ max: 86_399_999 }),
      (everySeconds, skipped, rawOffset) => {
        const record = createEveryScheduleRecord(
          ScheduleId('schedule-property'),
          'property reminder',
          everySeconds,
          BASE,
        )
        const interval = everySeconds * 1_000
        const target = Date.parse(record.scheduledAt)
        const accepted = target + skipped * interval + rawOffset % interval
        const calculated = resolveEveryOccurrence(record, accepted)
        const expectedOccurrence = new Date(target + skipped * interval).toISOString()
        const expectedNext = new Date(target + (skipped + 1) * interval).toISOString()
        expect(calculated).toEqual({
          occurrenceAt: expectedOccurrence,
          nextScheduledAt: expectedNext,
        })

        const folded = foldScheduleEvents([
          event({ version: 1, operation: 'create', schedule: record }, 0),
          event({
            version: 1,
            operation: 'dispatch',
            id: record.id,
            acceptedAt: new Date(accepted).toISOString(),
          }, 1),
        ])
        expect(folded.active).toEqual([{ ...record, scheduledAt: expectedNext }])
      },
    ), { numRuns: 300 })
  })
})

describe('weekly recurrence', () => {
  const WEEK = 7 * 86_400_000

  it('creates the next matching weekday at the rule time in its zone', () => {
    // Wednesday 2026-03-04 12:00 UTC is 13:00 in Paris; the next Monday 09:00
    // local is 2026-03-09 08:00 UTC (Paris is UTC+1 before the March change).
    const record = createWeeklyScheduleRecord(
      ScheduleId('weekly-1'),
      'weekly report',
      { weekday: 1, time: '09:00', time_zone: 'Europe/Paris' },
      Date.parse('2026-03-04T12:00:00.000Z'),
    )
    expect(record).toMatchObject({
      kind: 'weekly',
      weekday: 1,
      time: '09:00',
      timeZone: 'Europe/Paris',
      scheduledAt: '2026-03-09T08:00:00.000Z',
    })
  })

  it('takes today when the weekday and the local time are still ahead, and next week once it has passed', () => {
    const monday = { weekday: 1, time: '09:00', time_zone: 'Europe/Paris' } as const
    // Monday 2026-03-09 07:00 UTC is 08:00 local: still before 09:00.
    expect(createWeeklyScheduleRecord(ScheduleId('a'), 'r', monday, Date.parse('2026-03-09T07:00:00.000Z')).scheduledAt)
      .toBe('2026-03-09T08:00:00.000Z')
    // Monday 2026-03-09 09:00 UTC is 10:00 local: the 09:00 instant has passed.
    expect(createWeeklyScheduleRecord(ScheduleId('b'), 'r', monday, Date.parse('2026-03-09T09:00:00.000Z')).scheduledAt)
      .toBe('2026-03-16T08:00:00.000Z')
  })

  it('rejects an impossible weekday, time, or zone before anything is written', () => {
    const base = { weekday: 1, time: '09:00', time_zone: 'Europe/Paris' } as const
    const cases: readonly [Parameters<typeof createWeeklyScheduleRecord>[2], string][] = [
      [{ ...base, weekday: 0 }, 'invalid_rule'],
      [{ ...base, weekday: 8 }, 'invalid_rule'],
      [{ ...base, weekday: 1.5 }, 'invalid_rule'],
      [{ ...base, time: '9:00' }, 'invalid_rule'],
      [{ ...base, time: '09:60' }, 'invalid_rule'],
      [{ ...base, time_zone: 'Mars/Olympus' }, 'invalid_time_zone'],
    ]
    for (const [weekly, code] of cases) {
      expect(() => createWeeklyScheduleRecord(ScheduleId('x'), 'r', weekly, BASE)).toThrow(
        expect.objectContaining({ code }),
      )
    }
    expect(() => createWeeklyScheduleRecord(ScheduleId('x'), '   ', base, BASE))
      .toThrow(expect.objectContaining({ code: 'invalid_prompt' }))
  })

  it('resolves the latest due occurrence and the next one a week later', () => {
    const record = createWeeklyScheduleRecord(
      ScheduleId('weekly-2'),
      'weekly report',
      { weekday: 1, time: '09:00', time_zone: 'Europe/Paris' },
      Date.parse('2026-03-04T12:00:00.000Z'),
    )
    const due = resolveWeeklyOccurrence(record, Date.parse('2026-03-16T12:00:00.000Z'))
    expect(due).toEqual({
      occurrenceAt: '2026-03-16T08:00:00.000Z',
      nextScheduledAt: '2026-03-23T08:00:00.000Z',
    })
    // A decision before the recorded target is a corrupt log, not a late run.
    expect(() => resolveWeeklyOccurrence(record, Date.parse('2026-03-09T07:59:59.000Z')))
      .toThrow(expect.objectContaining({ code: 'corrupt_schedule_log' }))
  })

  it('keeps the local wall clock across a spring-forward, and fires at the first instant after a skipped hour', () => {
    // Europe/Paris moves 02:00 to 03:00 on Sunday 2026-03-29.
    const nine = createWeeklyScheduleRecord(
      ScheduleId('weekly-dst'),
      'r',
      { weekday: 7, time: '09:00', time_zone: 'Europe/Paris' },
      Date.parse('2026-03-23T00:00:00.000Z'),
    )
    expect(nine.scheduledAt).toBe('2026-03-29T07:00:00.000Z')
    const next = resolveWeeklyOccurrence(nine, Date.parse('2026-03-29T07:00:00.000Z')).nextScheduledAt
    // The following Sunday is already on summer time: 09:00 local is 07:00 UTC
    // before the change and the same wall clock is one hour earlier in UTC after it.
    expect(next).toBe('2026-04-05T07:00:00.000Z')

    const skipped = createWeeklyScheduleRecord(
      ScheduleId('weekly-gap'),
      'r',
      { weekday: 7, time: '02:30', time_zone: 'Europe/Paris' },
      Date.parse('2026-03-23T00:00:00.000Z'),
    )
    // 02:30 does not exist that Sunday: the reminder fires when the clock passes
    // it, at 03:30 local (01:30 UTC).
    expect(skipped.scheduledAt).toBe('2026-03-29T01:30:00.000Z')

    // A rule just after local midnight on the same Sunday resolves against the
    // offset in force at that instant: the candidate built from the next day's
    // offset projects to the previous evening and is discarded, not returned.
    const midnight = createWeeklyScheduleRecord(
      ScheduleId('weekly-midnight'),
      'r',
      { weekday: 7, time: '00:30', time_zone: 'Europe/Paris' },
      Date.parse('2026-03-23T00:00:00.000Z'),
    )
    expect(midnight.scheduledAt).toBe('2026-03-28T23:30:00.000Z')
  })

  it('takes the first of the two instants an autumn overlap repeats', () => {
    // Europe/Paris repeats 02:00-03:00 on Sunday 2026-10-25; 02:30 local happens
    // at 00:30 UTC (summer) and again at 01:30 UTC (winter).
    const record = createWeeklyScheduleRecord(
      ScheduleId('weekly-overlap'),
      'r',
      { weekday: 7, time: '02:30', time_zone: 'Europe/Paris' },
      Date.parse('2026-10-19T00:00:00.000Z'),
    )
    expect(record.scheduledAt).toBe('2026-10-25T00:30:00.000Z')
  })

  it('refuses a decision outside the representable calendar, and a zone the decoder cannot read', () => {
    const record = createWeeklyScheduleRecord(
      ScheduleId('weekly-bounds'),
      'r',
      { weekday: 1, time: '09:00', time_zone: 'Europe/Paris' },
      Date.parse('2026-03-04T12:00:00.000Z'),
    )
    for (const acceptedAt of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => resolveWeeklyOccurrence(record, acceptedAt))
        .toThrow(expect.objectContaining({ code: 'corrupt_schedule_log' }))
    }
    // The last representable instant is a valid decision: the walk still finds
    // the year's last Monday, and reports no next target because the following
    // one would fall outside the calendar.
    expect(resolveWeeklyOccurrence(record, Date.parse('9999-12-31T23:59:59.999Z')))
      .toEqual({ occurrenceAt: '9999-12-27T08:00:00.000Z' })

    // A zone without an Area/Location shape never becomes a record.
    expect(() => decodeScheduleChange({
      version: 1, operation: 'create', schedule: { ...record, timeZone: 'Paris' },
    })).toThrow(expect.objectContaining({ code: 'corrupt_schedule_log' }))
  })

  it('stops at the calendar end: no occurrence to create, and no next target to report', () => {
    const rule = { weekday: 1, time: '09:00', time_zone: 'Europe/Paris' } as const
    // The last week of the representable calendar has no Monday 09:00 left.
    expect(() => createWeeklyScheduleRecord(
      ScheduleId('weekly-end'), 'r', rule, Date.parse('9999-12-31T23:59:59.000Z'),
    )).toThrow(expect.objectContaining({ code: 'time_out_of_range' }))

    // A rule whose local time on the calendar's last day resolves past the
    // calendar has no representable occurrence at all: the zone behind UTC pushes
    // it into the year 10000, and the walk finds nothing left to create.
    // Midway is eleven hours behind UTC, so this instant is still 9999-12-31
    // there and the local 23:59 lands in the year 10000.
    const lastDay = Date.parse('9999-12-31T12:00:00.000Z')
    const lastWeekday = ((new Date(lastDay).getUTCDay() + 6) % 7) + 1
    expect(() => createWeeklyScheduleRecord(
      ScheduleId('weekly-past-end'),
      'r',
      { weekday: lastWeekday, time: '23:59', time_zone: 'Pacific/Midway' },
      lastDay,
    )).toThrow(expect.objectContaining({ code: 'time_out_of_range' }))

    // A decision on the calendar's last day in a zone behind UTC meets a local
    // date whose rule time resolves into the year 10000: the walk skips it and
    // reports the last occurrence that does fit.
    const behind = {
      id: ScheduleId('weekly-behind'),
      kind: 'weekly' as const,
      prompt: 'r',
      weekday: lastWeekday,
      time: '23:59',
      timeZone: 'Pacific/Midway',
      scheduledAt: '9999-12-24T10:59:00.000Z',
    }
    expect(resolveWeeklyOccurrence(behind, lastDay))
      .toEqual({ occurrenceAt: '9999-12-25T10:59:00.000Z' })

    // A record whose next weekly occurrence would fall past the calendar answers
    // with the due occurrence alone.
    const last = {
      id: ScheduleId('weekly-last'),
      kind: 'weekly' as const,
      prompt: 'r',
      weekday: 1,
      time: '09:00',
      timeZone: 'Europe/Paris',
      scheduledAt: '9999-12-27T08:00:00.000Z',
    }
    expect(resolveWeeklyOccurrence(last, Date.parse('9999-12-31T23:59:59.000Z')))
      .toEqual({ occurrenceAt: '9999-12-27T08:00:00.000Z' })
  })

  it('folds a dispatch into the next occurrence, and decodes only well-formed weekly records', () => {
    const record = createWeeklyScheduleRecord(
      ScheduleId('weekly-3'),
      'weekly report',
      { weekday: 1, time: '09:00', time_zone: 'Europe/Paris' },
      Date.parse('2026-03-04T12:00:00.000Z'),
    )
    const folded = foldScheduleEvents([
      event({ version: 1, operation: 'create', schedule: record }, 0),
      event({
        version: 1,
        operation: 'dispatch',
        id: record.id,
        acceptedAt: '2026-03-09T08:00:00.000Z',
      }, 1),
    ])
    expect(folded.active).toEqual([{ ...record, scheduledAt: '2026-03-16T08:00:00.000Z' }])

    const decoded = decodeScheduleChange({ version: 1, operation: 'create', schedule: record })
    expect(decoded).toMatchObject({ operation: 'create', schedule: { kind: 'weekly' } })
    const corrupt: readonly unknown[] = [
      { ...record, weekday: 0 },
      { ...record, time: '09:00:00' },
      { ...record, timeZone: 'Mars/Olympus' },
      { ...record, extra: true },
      { ...record, prompt: ' padded ' },
    ]
    for (const schedule of corrupt) {
      expect(() => decodeScheduleChange({ version: 1, operation: 'create', schedule }))
        .toThrow(expect.objectContaining({ code: 'corrupt_schedule_log' }))
    }
  })

  it('dispatches a due weekly reminder as a recurring batch and advances it a week', () => {
    const record = createWeeklyScheduleRecord(
      ScheduleId('weekly-4'),
      'weekly report',
      { weekday: 1, time: '09:00', time_zone: 'Europe/Paris' },
      Date.parse('2026-03-04T12:00:00.000Z'),
    )
    const folded = foldScheduleEvents([
      event({ version: 1, operation: 'create', schedule: record }, 0),
    ])
    expect(folded.active).toHaveLength(1)
    expect(renderRecurringReminderBatchFraming([
      { record, occurrenceAt: record.scheduledAt },
    ])).toContain(JSON.stringify([{ schedule_id: 'weekly-4', occurrence_at: '2026-03-09T08:00:00.000Z', reminder_prompt: 'weekly report' }]))
    expect(WEEK).toBe(604_800_000)
  })
})
