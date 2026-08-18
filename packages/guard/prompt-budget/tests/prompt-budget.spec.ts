import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as PromptBudget from '../src/index.ts'
import { priceAssembly } from '../src/index.ts'
import type { PromptBudgetBreakdown } from '../src/index.ts'

describe('priceAssembly', () => {
  it('prices sections, contexts, tools, and variables with a total', () => {
    const breakdown = priceAssembly({
      sections: [{ name: 'identity', text: 'You are an agent.' }],
      contexts: [{ name: 'rules', text: 'Be concise.' }],
      tools: [{ name: 'echo', description: 'echo back', parameters: {} }],
      variables: { cwd: '/repo', empty: undefined },
    })
    expect(breakdown.sections).toEqual([{ name: 'identity', tokens: Math.ceil(17 / 4) + 4 }])
    expect(breakdown.contexts).toEqual([{ name: 'rules', tokens: Math.ceil(11 / 4) + 4 }])
    expect(breakdown.tools).toHaveLength(1)
    expect(breakdown.tools[0]?.name).toBe('echo')
    // Undefined variables are dropped; defined ones are priced.
    expect(breakdown.variables).toEqual([{ name: 'cwd', tokens: Math.ceil(5 / 4) + 4 }])
    const parts = breakdown.sections.length + breakdown.contexts.length
      + breakdown.tools.length + breakdown.variables.length
    expect(parts).toBe(4)
    expect(breakdown.total).toBe(
      breakdown.sections[0]!.tokens + breakdown.contexts[0]!.tokens
      + breakdown.tools[0]!.tokens + breakdown.variables[0]!.tokens,
    )
  })

  it('prices an empty assembly to zero parts and a zero total', () => {
    const breakdown = priceAssembly({ sections: [], contexts: [], tools: [], variables: {} })
    expect(breakdown.sections).toEqual([])
    expect(breakdown.contexts).toEqual([])
    expect(breakdown.tools).toEqual([])
    expect(breakdown.variables).toEqual([])
    expect(breakdown.total).toBe(0)
  })
})

describe('prompt-budget plugin', () => {
  it('emits a breakdown for every assembly and returns it unchanged', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    ctx.systemPrompt.context({ name: 'policy', order: 10, text: 'Stay brief.' })
    ctx.systemPrompt.tools(() => ({ schemas: [{ name: 'echo', description: 'echo back', parameters: {} }] }))

    const breakdowns: PromptBudgetBreakdown[] = []
    ctx.on('prompt-budget/breakdown', breakdown => void breakdowns.push(breakdown))
    await ctx.plugin(PromptBudget)

    const assembly = await ctx.systemPrompt.assemble()
    expect(breakdowns).toHaveLength(1)
    const breakdown = breakdowns[0]!
    expect(breakdown.contexts.map(part => part.name)).toContain('policy')
    expect(breakdown.tools.map(part => part.name)).toEqual(['echo'])
    expect(breakdown.total).toBeGreaterThan(0)
    // The observer is transparent: the assembly the caller receives is the
    // waterfall's own result, priced but never mutated.
    expect(assembly.sections.map(section => section.name)).toContain('harness:identity')
  })

  it('keeps assembling when a breakdown listener throws', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    ctx.on('prompt-budget/breakdown', () => { throw new Error('listener boom') })
    await ctx.plugin(PromptBudget)
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.map(section => section.name)).toContain('harness:identity')
  })
})
