import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as CodeReviewInvariant from '../src/invariant.ts'

describe('dsh-code-review invariant companion', () => {
  it('registers the explained-empty installer', async () => {
    const ctx = new Context()
    const registered: string[] = []
    ctx.provide('invariants')
    ctx.set('invariants', {
      register: (name: string, install: () => void) => {
        install()
        registered.push(name)
        return () => registered.pop()
      },
    } as never)
    const disposer = await CodeReviewInvariant.apply(ctx)
    expect(registered).toEqual(['@deepseek-ai/dsh-code-review'])
    disposer()
    expect(registered).toEqual([])
  })
})
