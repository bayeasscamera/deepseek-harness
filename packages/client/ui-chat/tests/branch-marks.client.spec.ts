/** Branch-mark derivation: which message each branch left through. */
import { describe, expect, it } from 'vitest'
import { branchAnchorOf, deriveBranchMarks } from '../src/client/chat/branch-marks.ts'

const node = (key: string, seq: number) => ({ key, seq })

describe('deriveBranchMarks', () => {
  it('marks the last message below each cut and sums branches sharing one', () => {
    const marks = deriveBranchMarks([node('a', 1), node('b', 2), node('c', 5)], [3, 3, 6])
    expect([...marks]).toEqual([['b', 2], ['c', 1]])
  })

  it('marks the first message when a branch inherited nothing', () => {
    expect([...deriveBranchMarks([node('a', 1), node('b', 2)], [0])]).toEqual([['a', 1]])
  })

  it('marks in transcript order even when the nodes arrive unsorted', () => {
    expect([...deriveBranchMarks([node('c', 5), node('a', 1), node('b', 2)], [3])]).toEqual([['b', 1]])
  })

  it('returns nothing without cuts or without messages', () => {
    expect(deriveBranchMarks([node('a', 1)], []).size).toBe(0)
    expect(deriveBranchMarks([], [1]).size).toBe(0)
  })
})

describe('branchAnchorOf', () => {
  it('anchors a user message on its own seq', () => {
    expect(branchAnchorOf({ kind: 'user', anchorSeq: 4 } as never)).toBe(4)
  })

  it('anchors a turn tail on its finalized assistant message', () => {
    expect(branchAnchorOf({
      kind: 'turn-tail',
      anchorSeq: 9,
      data: { closing: { finalNode: { seq: 7 } } },
    } as never)).toBe(7)
  })

  it('falls back to the tail seq when the turn has no finalized assistant', () => {
    expect(branchAnchorOf({ kind: 'turn-tail', anchorSeq: 9, data: { closing: null } } as never)).toBe(9)
  })

  it('ignores node kinds that publish no branch action', () => {
    expect(branchAnchorOf({ kind: 'assistant-step', anchorSeq: 3 } as never)).toBeUndefined()
    expect(branchAnchorOf({ kind: 'tool-call', anchorSeq: 3 } as never)).toBeUndefined()
  })
})
