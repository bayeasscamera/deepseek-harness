import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition, CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import * as codeReview from '../src/index.ts'

/** Minimal captured shape of the registered `code_review_audit` definition. */
interface CapturedTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: { render: (args: unknown, value: unknown) => unknown }
  execute: (args: unknown) => Promise<unknown>
}

interface Harness {
  readonly command: CommandDefinition
  readonly tool: CapturedTool
  /** Current registration state, for observing disposal. */
  readonly registered: () => { command: CommandDefinition | undefined; tool: CapturedTool | undefined }
  /** Dispose the plugin fiber owning both registrations. */
  readonly dispose: () => Promise<void>
}

/**
 * Mount the plugin on a context whose `commands`/`tools` services capture the
 * registered definitions, so handler and execute run against the shipping
 * plugin body without a full runtime composition.
 */
async function boot(): Promise<Harness> {
  const ctx = new Context()
  let command: CommandDefinition | undefined
  let tool: CapturedTool | undefined
  ctx.provide('commands', {
    register(next: CommandDefinition) {
      command = next
      return () => { command = undefined }
    },
  } as never)
  ctx.provide('tools', {
    register(next: CapturedTool) {
      tool = next
      return () => { tool = undefined }
    },
  } as never)
  const fiber = await ctx.plugin(codeReview)
  if (command === undefined || tool === undefined) {
    throw new Error('plugin did not register its command and tool')
  }
  return {
    command,
    tool,
    registered: () => ({ command, tool }),
    dispose: () => fiber.dispose(),
  }
}

/** Invoke the captured `/review` handler the way the executor would. */
async function run(harness: Harness, rawInput: string): Promise<CommandResult> {
  return Promise.resolve(harness.command.handler({ rawInput } as CommandInvocation))
}

const VALID_LEVELS = 'low, medium, high, extra-high, ultra'

describe('@deepseek-ai/dsh-code-review registration', () => {
  it('registers the /review command and the code_review_audit tool, disposed with the plugin', async () => {
    const test = await boot()
    expect(codeReview.name).toBe('code-review')
    expect(codeReview.inject).toEqual(['commands', 'tools'])
    expect('default' in codeReview).toBe(false)

    expect(test.command.name).toBe('review')
    expect(test.command.description).toBe('Run a code review with an adjustable effort level (low, medium, high, extra-high, ultra).')
    expect(test.command.input).toEqual({ hint: '[low | medium | high | extra-high | ultra] [path]' })
    expect(test.tool.name).toBe('code_review_audit')
    expect(test.tool.description).toBe('Run an automated code review audit at one of five configurable effort levels (low, medium, high, extra-high, ultra).')

    await test.dispose()
    expect(test.registered()).toEqual({ command: undefined, tool: undefined })
  })
})

describe('/review command', () => {
  it('launches a review with the selected level and target path', async () => {
    const test = await boot()
    const result = await run(test, 'high src/auth')
    expect(result.kind).toBe('success')
    if (result.kind !== 'success') throw new Error('expected success')
    expect(result.text).toContain('### Code Review Launched (In-Depth (High))')
    expect(result.text).toContain('**Analysis scope:** `src/auth`')
    expect(result.text).toContain('- Security & zero-trust')
    expect(result.text).toContain('on target: `src/auth`')
  })

  it('resolves an omitted level to the documented medium default', async () => {
    const test = await boot()
    const result = await run(test, '')
    expect(result.kind).toBe('success')
    if (result.kind !== 'success') throw new Error('expected success')
    expect(result.text).toContain('Standard (Medium)')
    expect(result.text).toContain('**Analysis scope:** current changes')
    expect(result.text).toContain('on the recent changes')
  })

  it('accepts level keys case-insensitively', async () => {
    const test = await boot()
    const result = await run(test, 'ULTRA')
    if (result.kind !== 'success') throw new Error('expected success')
    expect(result.text).toContain('Exhaustive (Ultra)')
  })

  it('fails loud naming the valid levels when the first token is not a level', async () => {
    const test = await boot()
    const result = await run(test, 'Bogus src/auth')
    expect(result).toEqual({
      kind: 'error',
      text: `Unknown review level "Bogus". Valid levels: ${VALID_LEVELS}.`,
    })
  })
})

describe('buildReviewPrompt', () => {
  it('renders the target clause for an explicit path', () => {
    const prompt = codeReview.buildReviewPrompt('ultra', 'src/auth')
    expect(prompt).toContain('### Code Review — Level Exhaustive (Ultra)')
    expect(prompt).toContain('Perform a code review on target: `src/auth` focusing on:')
    expect(prompt).toContain('- Formal invariant verification')
    expect(prompt).toContain('**Audit guidelines:** Formal contract verification')
  })

  it('renders the recent-changes clause without a path', () => {
    const prompt = codeReview.buildReviewPrompt('low')
    expect(prompt).toContain('Perform a code review on the recent changes focusing on:')
    expect(prompt).toContain('- Syntax & typos')
  })
})

describe('code_review_audit tool', () => {
  it('declares the closed level enum in its parameter schema', async () => {
    const test = await boot()
    const properties = (test.tool.parameters as { properties?: Record<string, { enum?: string[] }> }).properties ?? {}
    expect(properties.level?.enum).toEqual(['low', 'medium', 'high', 'extra-high', 'ultra'])
  })

  it('returns the structured level spec for an explicit level', async () => {
    const test = await boot()
    const value = await test.tool.execute({ level: 'ultra' }) as { level: string; guidelines: string; aspects: string[] }
    expect(value.level).toBe('ultra')
    expect(value.guidelines).toBe(codeReview.REVIEW_LEVELS.ultra.description)
    expect(value.aspects).toEqual(codeReview.REVIEW_LEVELS.ultra.aspects)
  })

  it('resolves an omitted level to medium', async () => {
    const test = await boot()
    const value = await test.tool.execute({}) as { level: string }
    expect(value.level).toBe('medium')
  })

  it('rejects an unknown level with an error naming the valid levels', async () => {
    const test = await boot()
    // The compiled enum reaches the model as the isError content below.
    await expect(test.tool.execute({ level: 'bogus' }))
      .rejects.toThrow('"level" must be one of ["low","medium","high","extra-high","ultra"]')
  })

  it('renders the structured value as compact text', async () => {
    const test = await boot()
    const rendered = test.tool.output.render({}, {
      level: 'high',
      guidelines: 'Business logic.',
      aspects: ['Business logic', 'Security & zero-trust'],
    }) as { type: string; text: string }[]
    expect(rendered).toEqual([{
      type: 'text',
      text: 'Code Review Level: high\nGuidelines: Business logic.\nAspects: Business logic, Security & zero-trust',
    }])
  })
})
