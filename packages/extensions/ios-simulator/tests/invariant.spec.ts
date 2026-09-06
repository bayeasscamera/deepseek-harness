import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as IosSimulatorInvariant from '../src/invariant.ts'

describe('dsh-ios-simulator invariant companion', () => {
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
    const disposer = await IosSimulatorInvariant.apply(ctx)
    expect(registered).toEqual(['@deepseek-ai/dsh-ios-simulator'])
    disposer()
    expect(registered).toEqual([])
  })
})
