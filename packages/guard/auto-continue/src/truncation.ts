/**
 * Output-ceiling truncation verdict for one stopping turn. Split from the
 * plugin entry so its branches are unit-testable without an agent loop.
 * @module @deepseek-ai/dsh-auto-continue/truncation
 */

import { lastAssistantStreamChunk } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/**
 * Whether the turn's most recently settled assistant attempt actually finished
 * truncated at the output ceiling. The sticky `max-tokens` turn reason alone is
 * not enough: a completed step after a successful continuation keeps the turn
 * reason sticky, and steering there would chain continuations against a turn
 * that already finished its answer. The durable stream is the source of truth
 * because `turn/end` for the stopping turn is not committed yet.
 * @param events - the session log at the stopping boundary.
 * @param turn - the turn at its stopping boundary.
 * @returns whether the turn's latest attempt ended with a max-tokens finish.
 */
export function lastAttemptTruncated(events: readonly SessionEvent[], turn: number): boolean {
  for (const event of events.toReversed()) {
    // A closed turn before any attempt of the stopping turn: the turn settled
    // no attempt, so it has nothing to continue.
    if (event.type === 'turn/end') return false
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') continue
    // An attempt of an earlier turn means the stopping turn settled none either.
    if (event.data.turn !== turn) return false
    return lastAssistantStreamChunk(event.data.stream, 'finish')?.reason.kind === 'max-tokens'
  }
  return false
}
