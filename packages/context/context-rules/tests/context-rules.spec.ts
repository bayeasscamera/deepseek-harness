import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as ContextRules from '../src/index.ts'

describe('dsh-context-rules', () => {
  it('discovers rules and injects matching rules into system prompt', async () => {
    const dir = join(tmpdir(), `dsh-rules-test-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'typescript.md'), `---
paths:
  - 'src/**/*.ts'
  - '**/*.ts'
---
Always use strict TypeScript types.`)
    writeFileSync(join(dir, 'general.md'), 'Be concise and accurate.')

    const ctx = new Context()
    type CtxPrompt = { agent?: { session: { header: { cwd: string } } } }
    let registeredContext: { name: string; order: number; text: (c: CtxPrompt) => string } | undefined

    ctx.provide('systemPrompt')
    ctx.set('systemPrompt', {
      context: (def: never) => { registeredContext = def },
    } as never)

    await ctx.plugin(ContextRules, { extraDirs: [dir] })

    expect(registeredContext).toBeDefined()
    expect(registeredContext?.name).toBe('context-rules')

    const promptText = registeredContext?.text({
      agent: { session: { header: { cwd: dir } } },
    })

    expect(promptText).toContain('Rule: typescript')
    expect(promptText).toContain('Always use strict TypeScript types.')
    expect(promptText).toContain('Rule: general')
    expect(promptText).toContain('Be concise and accurate.')

    rmSync(dir, { recursive: true, force: true })
  })
})
