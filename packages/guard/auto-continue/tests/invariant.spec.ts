import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as AutoContinueInvariant from '../src/invariant.ts'

describe('dsh-auto-continue invariant companion', () => {
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
    const disposer = await AutoContinueInvariant.apply(ctx)
    expect(registered).toEqual(['@deepseek-ai/dsh-auto-continue'])
    disposer()
    expect(registered).toEqual([])
  })
})
