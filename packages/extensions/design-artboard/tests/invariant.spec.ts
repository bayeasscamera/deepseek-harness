import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as DesignArtboardInvariant from '../src/invariant.ts'

describe('dsh-design-artboard invariant companion', () => {
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
    const disposer = await DesignArtboardInvariant.apply(ctx)
    expect(registered).toEqual(['@deepseek-ai/dsh-design-artboard'])
    disposer()
    expect(registered).toEqual([])
  })
})
