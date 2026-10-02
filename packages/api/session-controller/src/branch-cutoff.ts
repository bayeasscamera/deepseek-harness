/** Pure branch-cutoff planning over a stored Session event log. */

import { extractSessionEventText } from '@deepseek-ai/dsh-session-query'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** One planned branch cutoff: the source prefix to copy plus any draft handoff. */
export interface BranchCutoff {
  /**
   * Exclusive source event index the child copies: events `[0, cut)` seed the
   * child, so `cut` always sits on a turn boundary or at the head of the log.
   */
  readonly cut: number
  /** Text of the chosen user message, handed to the caller as an editable draft. */
  readonly draftText?: string
}

/** Why a requested branch cannot produce a child. */
export type BranchCutoffRefusal = 'no-completed-turn'

/** Cutoff planning result: one planned branch or one refusal reason. */
export type BranchCutoffPlan =
  | { readonly kind: 'branch'; readonly cutoff: BranchCutoff }
  | { readonly kind: 'refused'; readonly reason: BranchCutoffRefusal }

/**
 * Plan the source prefix one branch copies.
 *
 * The anchor decides the reading: a user message stays OUT of the child and comes
 * back as a draft so the caller can rephrase it, while any other anchor is
 * INCLUDED through the end of its turn. A cutoff that would land inside an
 * unfinished turn — the model is still generating, or a tool call has no result
 * yet — moves back to the last completed turn instead, because a copied history
 * whose tool call has no result is rejected by model providers.
 * @param events - The source session's stored events, in `seq` order.
 * @param atSeq - Anchor event seq, or undefined to branch the whole session.
 * @returns The planned cutoff, or the refusal reason when nothing can be copied.
 */
export function planBranchCutoff(
  events: readonly SessionEvent[],
  atSeq: number | undefined,
): BranchCutoffPlan {
  if (atSeq === undefined) {
    const boundary = events.findLastIndex(event => event.type === 'turn/end')
    if (boundary === -1) return { kind: 'refused', reason: 'no-completed-turn' }
    return { kind: 'branch', cutoff: { cut: extendPastBetweenTurnEvents(events, boundary + 1) } }
  }
  const anchorIndex = events.findIndex(event => event.seq === atSeq)
  const anchor = anchorIndex === -1 ? undefined : events[anchorIndex]
  if (anchor?.type === 'user/message') {
    const boundary = events.findLastIndex(event => event.type === 'turn/end' && event.seq < atSeq)
    return {
      kind: 'branch',
      cutoff: {
        cut: extendPastBetweenTurnEvents(events, boundary === -1 ? 0 : boundary + 1, anchorIndex),
        draftText: extractSessionEventText(anchor),
      },
    }
  }
  const boundary = turnBoundaryFor(events, atSeq)
  return {
    kind: 'branch',
    cutoff: { cut: boundary === -1 ? 0 : extendPastBetweenTurnEvents(events, boundary + 1) },
  }
}

/**
 * Resolve the completed-turn boundary one non-user anchor copies through.
 * @param events - The source session's stored events.
 * @param atSeq - Anchor event seq.
 * @returns The boundary event index, or -1 when no completed turn qualifies.
 */
function turnBoundaryFor(events: readonly SessionEvent[], atSeq: number): number {
  const completedAtOrAfter = events.findIndex(
    event => event.type === 'turn/end' && event.seq >= atSeq,
  )
  if (completedAtOrAfter !== -1) return completedAtOrAfter
  return events.findLastIndex(event => event.type === 'turn/end' && event.seq < atSeq)
}

/**
 * Advance an exclusive end past between-turn events without crossing a turn start.
 * @param events - The source session's stored events.
 * @param start - Candidate exclusive end.
 * @param limit - Hard upper bound, which keeps a user anchor out of the copy.
 * @returns The exclusive end that keeps every copied turn closed.
 */
function extendPastBetweenTurnEvents(
  events: readonly SessionEvent[],
  start: number,
  limit: number = events.length,
): number {
  let cut = start
  while (cut < limit && cut < events.length && events[cut]?.type !== 'turn/start') cut += 1
  return cut
}
