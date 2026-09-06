import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as ScreenReaderInvariant from '../src/invariant.ts'

describe('dsh-screen-reader invariant companion', () => {
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
    const disposer = await ScreenReaderInvariant.apply(ctx)
    expect(registered).toEqual(['@deepseek-ai/dsh-screen-reader'])
    disposer()
    expect(registered).toEqual([])
  })
})
