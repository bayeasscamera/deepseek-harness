import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { LlmFailure, StreamChunk } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as AutoContinue from '../src/index.ts'
import type { Config } from '../src/index.ts'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

const RATE_LIMIT_FAILURE: LlmFailure = {
  message: 'rate limit exceeded',
  code: 'RATE_LIMIT',
  status: 429,
}

/** Scripted adapter entry whose stream ends with an in-band error finish. */
function errorFinish(failure: LlmFailure): StreamChunk[] {
  return [{ type: 'finish', reason: { kind: 'error', failure } }]
}

/** Wait until the probe observes truth, bounded for scheduler slack. */async function until(condition: () => boolean): Promise<void> {
  for (let waited = 0; waited < 2000 && !condition(); waited += 5) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  expect(condition()).toBe(true)
}

interface LoopHarness {
  ctx: Context
  plugin: Awaited<ReturnType<Context['plugin']>>
}

/** Boot the core spine, the command runtime, and the guard. */
async function loopHarness(config: Partial<Config> = {}): Promise<LoopHarness> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentLoop, { agents: [] })
  const plugin = await ctx.plugin(AutoContinue, { ...config })
  return { ctx, plugin }
}

function createAgent(ctx: Context, id: string, adapter: MockAdapter): Agent {
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx.agentLoop.create(SessionId(id), { provider: 'mock', model: 'mock' })
}

async function send(agent: Agent, text: string): Promise<void> {
  const idle = agent.whenIdle()
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await idle
}

/** A downstream request-error probe: invoked exactly when the guard delegates. */
function probeDelegation(ctx: Context): { calls: () => number } {
  let count = 0
  ctx.on('agent/request-error', async (_payload, next) => {
    count += 1
    return next()
  })
  return { calls: () => count }
}

describe('isRateLimitError', () => {
  it('classifies harness-owned rate-limit and quota codes', () => {
    expect(AutoContinue.isRateLimitError({ message: 'slow down', code: 'RATE_LIMIT' })).toBe(true)
    expect(AutoContinue.isRateLimitError({ message: 'no funds', code: 'QUOTA' })).toBe(true)
  })

  it('classifies an HTTP 429 status regardless of code', () => {
    expect(AutoContinue.isRateLimitError({ message: 'throttled', code: 'HTTP_429', status: 429 })).toBe(true)
  })

  it('falls back to message markers for foreign failures', () => {
    for (const marker of ['Too Many Requests', 'error 429', 'RESOURCE_EXHAUSTED', 'over capacity', 'BUDGET EXHAUSTED']) {
      expect(AutoContinue.isRateLimitError({ message: marker, code: 'UNKNOWN' })).toBe(true)
    }
    expect(AutoContinue.isRateLimitError({ message: 'connection reset', code: 'UNKNOWN' })).toBe(false)
    expect(AutoContinue.isRateLimitError({ message: '', code: 'UNKNOWN' })).toBe(false)
  })
})

describe('calculateBackoffMs', () => {
  it('doubles the base delay per prior consecutive continue', () => {
    expect(AutoContinue.calculateBackoffMs(0, 1000)).toBe(1000)
    expect(AutoContinue.calculateBackoffMs(1, 1000)).toBe(2000)
    expect(AutoContinue.calculateBackoffMs(3, 500)).toBe(4000)
  })

  it('caps the delay at the Node timer ceiling', () => {
    expect(AutoContinue.calculateBackoffMs(40, 1000)).toBe(MAX_TIMER_DELAY_MS)
    expect(AutoContinue.calculateBackoffMs(5, 0)).toBe(0)
  })
})

describe('resolveRecoveryDelayMs', () => {
  it('honors the provider retry-after hint up to the timer ceiling', () => {
    expect(AutoContinue.resolveRecoveryDelayMs({ ...RATE_LIMIT_FAILURE, providerRetryAfterMs: 45_000 }, 0, 1000)).toBe(45_000)
    expect(AutoContinue.resolveRecoveryDelayMs(
      { ...RATE_LIMIT_FAILURE, providerRetryAfterMs: MAX_TIMER_DELAY_MS * 2 }, 0, 1000,
    )).toBe(MAX_TIMER_DELAY_MS)
  })

  it('falls back to exponential backoff without a hint', () => {
    expect(AutoContinue.resolveRecoveryDelayMs(RATE_LIMIT_FAILURE, 0, 1000)).toBe(1000)
    expect(AutoContinue.resolveRecoveryDelayMs(RATE_LIMIT_FAILURE, 2, 1000)).toBe(4000)
  })
})

describe('AutoContinueService', () => {
  it('tracks per-agent budgets and clears them on reset', async () => {
    const { ctx } = await loopHarness({ enabled: true, maxContinues: 2, delayMs: 5 })
    const service = ctx.autoContinue
    const agentId = SessionId('svc-agent')
    expect(service.enabled).toBe(true)
    expect(service.continuesFor(agentId)).toBe(0)
    expect(service.budgetExhausted(agentId)).toBe(false)
    service.recordContinue(agentId)
    service.recordContinue(agentId)
    expect(service.continuesFor(agentId)).toBe(2)
    expect(service.budgetExhausted(agentId)).toBe(true)
    service.resetBudget(agentId)
    expect(service.budgetExhausted(agentId)).toBe(false)
  })

  it('reports and clears in-flight cooldown waits', async () => {
    const { ctx } = await loopHarness()
    const service = ctx.autoContinue
    const agentId = SessionId('wait-agent')
    expect(service.waitResumeAt(agentId)).toBeUndefined()
    service.noteWait(agentId, Date.now() + 50_000)
    expect(service.waitResumeAt(agentId)).toBeDefined()
    service.clearWait(agentId)
    expect(service.waitResumeAt(agentId)).toBeUndefined()
  })
})

describe('/autocontinue command', () => {
  interface CommandHarness {
    ctx: Context
    agent: Agent
    service: AutoContinue.AutoContinueService
    plugin: Awaited<ReturnType<Context['plugin']>>
  }

  async function commandHarness(config: Partial<Config> = {}): Promise<CommandHarness> {
    const ctx = new Context()
    await ctx.plugin(CommandRuntime)
    const plugin = await ctx.plugin(AutoContinue, { ...config })
    const agent = {
      id: SessionId('command-agent'),
      session: Session.create(SessionId('command-agent')),
      status: 'idle',
      options: {},
    } as unknown as Agent
    return { ctx, agent, service: ctx.autoContinue, plugin }
  }

  async function run(
    test: CommandHarness,
    input: string,
  ): Promise<NonNullable<Awaited<ReturnType<CommandRuntime['execute']>>>> {
    const execution = await test.ctx.commands.execute(test.agent, `/autocontinue${input}`, new AbortController().signal)
    if (execution === undefined) throw new Error('autocontinue command was not registered')
    return execution
  }

  it('exposes plugin exports and disposes the command with the fiber', async () => {
    const test = await commandHarness()
    expect(AutoContinue.name).toBe('auto-continue')
    expect(AutoContinue.inject).toEqual(['commands'])
    expect('default' in AutoContinue).toBe(false)
    expect(test.ctx.commands.list(test.agent)).toContainEqual({
      name: 'autocontinue',
      description: 'Toggle or inspect automatic recovery from rate-limit model-request failures',
      input: { hint: '[on | off | status | reset]' },
    })
    await test.plugin.dispose()
    expect(test.ctx.commands.find(test.agent, 'autocontinue')).toBeUndefined()
  })

  it('toggles, resets, and reports through the service', async () => {
    const test = await commandHarness({ maxContinues: 7, delayMs: 250 })
    const agentId = test.agent.id

    expect((await run(test, ' on')).result).toEqual({
      kind: 'success',
      text: 'Auto-continue enabled: rate-limit failures wait out a cooldown and retry automatically until the continuation budget is spent.',
    })
    const enabledStatus = await run(test, '')
    expect(enabledStatus.result.kind).toBe('success')
    expect(enabledStatus.result.text).toContain('Auto-continue status:\n- Enabled: yes')

    test.service.recordContinue(agentId)
    test.service.recordContinue(agentId)
    expect((await run(test, ' status')).result).toEqual({
      kind: 'success',
      text: 'Auto-continue status:\n- Enabled: yes\n- Continues used by this agent: 2 of 7\n- Base backoff: 250ms\n\nCommands: /autocontinue on | /autocontinue off | /autocontinue status | /autocontinue reset',
    })

    expect((await run(test, ' reset')).result).toEqual({
      kind: 'success',
      text: `Continuation budget reset for agent ${String(agentId)}.`,
    })
    expect(test.service.continuesFor(agentId)).toBe(0)

    expect((await run(test, ' off')).result).toEqual({
      kind: 'success',
      text: 'Auto-continue disabled: request failures surface immediately.',
    })
    const disabledStatus = await run(test, '')
    expect(disabledStatus.result.kind).toBe('success')
    expect(disabledStatus.result.text).toContain('- Enabled: no')
    expect(test.service.enabled).toBe(false)
  })

  it('reports an in-flight rate-limit cooldown and rejects unknown input', async () => {
    const test = await commandHarness()
    test.service.noteWait(test.agent.id, Date.now() + 50_000)
    const waiting = await run(test, ' status')
    expect(waiting.result.kind).toBe('success')
    expect(waiting.result.text).toMatch(/- Rate-limit cooldown: resuming in \d+s/)

    const rejected = await run(test, ' wat')
    expect(rejected.result).toEqual({
      kind: 'error',
      text: 'Unknown argument "wat". Usage: /autocontinue [on | off | status | reset]',
    })
  })
})

describe('agent/request-error guard through a real agent loop', () => {
  it('owns a rate-limit failure, waits, and retries the identical request', async () => {
    const { ctx } = await loopHarness({ enabled: true, delayMs: 1 })
    const adapter = new MockAdapter([
      errorFinish({ ...RATE_LIMIT_FAILURE, providerRetryAfterMs: 5 }),
      textResponse('resumed'),
    ])
    const agent = createAgent(ctx, 'recover-agent', adapter)
    await send(agent, 'go')

    expect(adapter.requests).toHaveLength(2)
    expect(adapter.requests[0]).toEqual(adapter.requests[1])
    expect(agent.session.events.at(-1)).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'completed' } },
    })
    expect(ctx.autoContinue.continuesFor(agent.id)).toBe(0)
    expect(ctx.autoContinue.waitResumeAt(agent.id)).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('doubles the backoff across consecutive owned recoveries', async () => {
    const { ctx } = await loopHarness({ enabled: true, delayMs: 10, maxContinues: 3 })
    const adapter = new MockAdapter([
      errorFinish(RATE_LIMIT_FAILURE),
      errorFinish(RATE_LIMIT_FAILURE),
      textResponse('recovered twice'),
    ])
    const agent = createAgent(ctx, 'backoff-agent', adapter)
    const startedAt = Date.now()
    await send(agent, 'go')
    // The scheduled waits are 10ms then 20ms; a timer cannot fire early.
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(30)

    expect(adapter.requests).toHaveLength(3)
    expect(agent.session.events.at(-1)).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'completed' } },
    })
    await ctx.fiber.dispose()
  })

  it('resets the per-agent budget after a successful request', async () => {
    const { ctx } = await loopHarness({ enabled: true, delayMs: 1, maxContinues: 1 })
    const probe = probeDelegation(ctx)
    const adapter = new MockAdapter([
      errorFinish(RATE_LIMIT_FAILURE),
      textResponse('first ok'),
      errorFinish(RATE_LIMIT_FAILURE),
      textResponse('second ok'),
    ])
    const agent = createAgent(ctx, 'budget-agent', adapter)

    await send(agent, 'first')
    await send(agent, 'second')

    expect(adapter.requests).toHaveLength(4)
    expect(probe.calls()).toBe(0)
    const completions = agent.session.events.filter(event => event.type === 'turn/end')
    expect(completions).toHaveLength(2)
    expect(completions[1]).toMatchObject({ data: { reason: { kind: 'completed' } } })
    await ctx.fiber.dispose()
  })

  it('delegates non-rate-limit failures to the rest of the chain', async () => {
    const { ctx } = await loopHarness({ enabled: true, delayMs: 1 })
    const probe = probeDelegation(ctx)
    const adapter = new MockAdapter([
      errorFinish({ message: 'upstream exploded', code: 'SERVER', status: 500 }),
    ])
    const agent = createAgent(ctx, 'server-agent', adapter)
    await send(agent, 'go')

    expect(probe.calls()).toBe(1)
    expect(adapter.requests).toHaveLength(1)
    expect(agent.session.events.at(-1)).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'error', error: { code: 'SERVER' } } },
    })
    await ctx.fiber.dispose()
  })

  it('delegates rate-limit failures while disabled', async () => {
    const { ctx } = await loopHarness()
    const probe = probeDelegation(ctx)
    const adapter = new MockAdapter([errorFinish(RATE_LIMIT_FAILURE)])
    const agent = createAgent(ctx, 'disabled-agent', adapter)
    await send(agent, 'go')

    expect(probe.calls()).toBe(1)
    expect(adapter.requests).toHaveLength(1)
    expect(agent.session.events.at(-1)).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'error', error: { code: 'RATE_LIMIT' } } },
    })
    await ctx.fiber.dispose()
  })

  it('delegates once the per-agent budget is exhausted', async () => {
    const { ctx } = await loopHarness({ enabled: true, delayMs: 1, maxContinues: 1 })
    const probe = probeDelegation(ctx)
    const adapter = new MockAdapter([
      errorFinish(RATE_LIMIT_FAILURE),
      errorFinish(RATE_LIMIT_FAILURE),
    ])
    const agent = createAgent(ctx, 'exhausted-agent', adapter)
    await send(agent, 'go')

    expect(probe.calls()).toBe(1)
    expect(adapter.requests).toHaveLength(2)
    expect(agent.session.events.at(-1)).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'error', error: { code: 'RATE_LIMIT' } } },
    })
    await ctx.fiber.dispose()
  })

  it('abandons the cooldown when the turn is cancelled', async () => {
    const { ctx } = await loopHarness({ enabled: true, delayMs: 60_000 })
    const adapter = new MockAdapter([errorFinish(RATE_LIMIT_FAILURE)])
    const agent = createAgent(ctx, 'abort-agent', adapter)
    const idle = agent.whenIdle()
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await until(() => ctx.autoContinue.waitResumeAt(agent.id) !== undefined)
    agent.cancel({ kind: 'user' })
    await idle

    expect(adapter.requests).toHaveLength(1)
    expect(agent.session.events.at(-1)).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'aborted', reason: { kind: 'user' } } },
    })
    expect(ctx.autoContinue.waitResumeAt(agent.id)).toBeUndefined()
    expect(ctx.autoContinue.continuesFor(agent.id)).toBe(0)
    await ctx.fiber.dispose()
  })

  it('stops owning recovery after the plugin is disposed mid-cooldown', async () => {
    const { ctx, plugin } = await loopHarness({ enabled: true, delayMs: 60_000 })
    const adapter = new MockAdapter([errorFinish(RATE_LIMIT_FAILURE)])
    const agent = createAgent(ctx, 'dispose-agent', adapter)
    const idle = agent.whenIdle()
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await until(() => ctx.autoContinue.waitResumeAt(agent.id) !== undefined)
    await plugin.dispose()
    await idle

    expect(adapter.requests).toHaveLength(1)
    expect(agent.session.events.at(-1)).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'error', error: { code: 'RATE_LIMIT' } } },
    })
    await ctx.fiber.dispose()
  })

  it('neither waits nor retries when the turn signal is already aborted', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(AgentLoop, { agents: [] })
    // Registered before the guard, so the turn is cancelled before the guard
    // sees the failure and the cooldown is skipped entirely.
    ctx.on('agent/request-error', (payload, next) => {
      payload.agent.cancel({ kind: 'user' })
      return next()
    })
    await ctx.plugin(AutoContinue, { enabled: true, delayMs: 60_000 })
    const adapter = new MockAdapter([errorFinish(RATE_LIMIT_FAILURE)])
    const agent = createAgent(ctx, 'pre-aborted-agent', adapter)
    await send(agent, 'go')

    expect(adapter.requests).toHaveLength(1)
    expect(agent.session.events.at(-1)).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'aborted', reason: { kind: 'user' } } },
    })
    expect(ctx.autoContinue.waitResumeAt(agent.id)).toBeUndefined()
    expect(ctx.autoContinue.continuesFor(agent.id)).toBe(0)
    await ctx.fiber.dispose()
  })

  it('returns no recovery for a stale callback captured before disposal', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(AgentLoop, { agents: [] })
    let entered = false
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    // Registered before the guard, so the guard's callback is captured into
    // this dispatch and only reached after the gate lets the chain proceed.
    ctx.on('agent/request-error', async (_payload, next) => {
      entered = true
      await gate
      return next()
    })
    const plugin = await ctx.plugin(AutoContinue, { enabled: true, delayMs: 60_000 })
    const service = ctx.autoContinue
    const adapter = new MockAdapter([errorFinish(RATE_LIMIT_FAILURE)])
    const agent = createAgent(ctx, 'stale-agent', adapter)
    const idle = agent.whenIdle()
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await until(() => entered)

    await plugin.dispose()
    release?.()
    await idle

    expect(service.continuesFor(agent.id)).toBe(0)
    expect(adapter.requests).toHaveLength(1)
    expect(agent.session.events.at(-1)).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'error', error: { code: 'RATE_LIMIT' } } },
    })
    await ctx.fiber.dispose()
  })
})
