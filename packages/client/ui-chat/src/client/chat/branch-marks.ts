/** Branch markers: how many branches left a Session through each of its messages. */

import type { ChatConversationViewNode, ChatNodeDataMap } from '../contract/chat-nodes.ts'

/** One transcript message available as a branch-mark target. */
export interface BranchMarkNode {
  /** Stable Conversation key of the message. */
  readonly key: string
  /** Durable anchor seq of the message in the source log. */
  readonly seq: number
}

/**
 * Count the branches cut through each message of one Session.
 *
 * A branch child records the number of events it inherited as its fork cut, so
 * the branch left the source right after the last message below that cut. A cut
 * at the head (0 inherited events) marks the first message, the only message it
 * could have left from.
 * @param nodes - the Session's transcript messages with their anchor seqs.
 * @param cuts - inherited event counts of the Session's direct branch children.
 * @returns counts keyed by message key; empty when nothing was cut.
 */
export function deriveBranchMarks(
  nodes: readonly BranchMarkNode[],
  cuts: readonly number[],
): ReadonlyMap<string, number> {
  if (nodes.length === 0 || cuts.length === 0) return EMPTY_BRANCH_MARKS
  const ordered = [...nodes].sort((left, right) => left.seq - right.seq)
  const marks = new Map<string, number>()
  for (const cut of cuts) {
    let target = ordered[0]
    if (target === undefined) continue
    for (const node of ordered) {
      if (node.seq > cut - 1) break
      target = node
    }
    marks.set(target.key, (marks.get(target.key) ?? 0) + 1)
  }
  return marks
}

/**
 * The seq a branch cut at this node would anchor on, for the node kinds that
 * publish a branch action. Other kinds are no mark target: they render no
 * action row, so a mark on them would never be seen.
 * @param node - one Chat node in transcript order.
 * @returns the anchor seq, or undefined when the node carries no branch action.
 */
export function branchAnchorOf(node: ChatConversationViewNode): number | undefined {
  if (node.kind === 'user') return node.anchorSeq
  if (node.kind !== 'turn-tail') return undefined
  // The seat hands every keyed renderer the node its own registration built,
  // so the tail kind guarantees the tail payload.
  const data = node.data as ChatNodeDataMap['turn-tail']
  return data.closing?.finalNode.seq ?? node.anchorSeq
}

/** Shared empty result: no branch marks, so the seat map never allocates. */
export const EMPTY_BRANCH_MARKS: ReadonlyMap<string, number> = new Map()
