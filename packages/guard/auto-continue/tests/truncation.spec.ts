import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { lastAttemptTruncated } from '../src/truncation.ts'

/**
 * Branch suite for {@link lastAttemptTruncated}. The verdict decides whether a
 * stopping turn is continued, and every branch answers a distinct ordering the
 * durable log can present at that boundary; each is pinned here directly
 * instead of through a scripted loop.
 */

/** One event as the durable log carries it, without the sequence plumbing. */
function event(value: Record<string, unknown>): SessionEvent {
  return value as unknown as SessionEvent
}

/** One settled attempt whose stream ends with the given finish kind. */
function attempt(
  turn: number,
  finish: 'stop' | 'max-tokens',
  type = 'assistant/message',
): SessionEvent {
  return event({
    type,
    data: {
      turn,
      step: 1,
      stream: [{ type: 'chunk', time: 0, chunk: { type: 'finish', reason: { kind: finish } } }],
    },
  })
}

describe('lastAttemptTruncated', () => {
  it('reads the newest attempt of the stopping turn', () => {
    expect(lastAttemptTruncated([attempt(1, 'max-tokens')], 1)).toBe(true)
    expect(lastAttemptTruncated([attempt(1, 'stop')], 1)).toBe(false)
  })

  it('reads a log-only attempt the same way', () => {
    expect(lastAttemptTruncated([attempt(1, 'max-tokens', 'assistant/attempt')], 1)).toBe(true)
    expect(lastAttemptTruncated([attempt(1, 'stop', 'assistant/attempt')], 1)).toBe(false)
  })

  it('skips non-attempt events after the attempt', () => {
    const log = [
      attempt(1, 'max-tokens'),
      event({ type: 'step/end', data: { turn: 1, step: 1 } }),
      event({ type: 'tool/result', data: { turn: 1, step: 1 } }),
    ]
    expect(lastAttemptTruncated(log, 1)).toBe(true)
  })

  it('walks past attempts of earlier turns when the stopping turn settled none', () => {
    // A resumed window can open with an earlier turn's attempt and no
    // turn/end before the stopping turn: the scan must reach the start.
    expect(lastAttemptTruncated([attempt(1, 'stop'), attempt(2, 'stop')], 3)).toBe(false)
  })

  it('verdicts the LAST attempt: a completed continuation hides the sticky reason', () => {
    const log = [
      attempt(1, 'max-tokens'),
      event({ type: 'step/end', data: { turn: 1, step: 1 } }),
      attempt(1, 'stop'),
    ]
    expect(lastAttemptTruncated(log, 1)).toBe(false)
  })

  it('does not continue a turn whose newest attempt belongs to another turn', () => {
    expect(lastAttemptTruncated([attempt(1, 'max-tokens'), attempt(2, 'stop')], 2)).toBe(false)
  })

  it('stops at a closed turn before any attempt of the stopping turn', () => {
    const log = [
      attempt(1, 'max-tokens'),
      event({ type: 'turn/end', data: { turn: 1, reason: { kind: 'max-tokens' } } }),
    ]
    expect(lastAttemptTruncated(log, 2)).toBe(false)
  })

  it('does not continue a log with no attempt at all', () => {
    expect(lastAttemptTruncated([], 1)).toBe(false)
    expect(lastAttemptTruncated([event({ type: 'turn/start', data: { turn: 1 } })], 1)).toBe(false)
  })

  it('does not continue an attempt whose stream carries no finish record', () => {
    const log = [event({ type: 'assistant/message', data: { turn: 1, step: 1, stream: [] } })]
    expect(lastAttemptTruncated(log, 1)).toBe(false)
  })
})
