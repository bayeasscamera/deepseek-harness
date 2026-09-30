import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, ToolCallId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as AutoContinue from '@deepseek-ai/dsh-auto-continue'
import type { Config } from '@deepseek-ai/dsh-auto-continue'
import {
  MockAdapter,
  maxTokensResponse,
  textResponse,
  toolCallResponse,
} from '../../../core/agent-loop/tests/mock-adapter.ts'

/**
 * Behavior suite for the max-tokens continuation guard: steering at the
 * stopping boundary, the sticky-reason no-re-steer rule, the consecutive cap,
 * reset on user input, mid-tool-call truncation, and fail-loud config
 * validation — all driven through a real agent loop against a scripted mock
 * adapter (no network).
 */

/** Boot the core spine + the guard; the caller registers adapters and extra listeners. */
async function harness(config: Config = {}): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AutoContinue, config)
  ctx.tools.register(
    defineContentToolFixture({
      name: 'probe',
      description: 'p',
      parameters: {},
      async execute() {
        return [{ type: 'text', text: 'ok' }]
      },
    }),
  )
  return ctx
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const d = ctx.on('agent/status', ({ agent: s, status: st }) => {
      if (s === agent && st === 'idle') {
        d()
        resolve()
      }
    })
  })
}

/** Every continuation this guard steered, as durable user/message events. */
function continuations(agent: Agent): SessionEvent<'user/message'>[] {
  return agent.session
    .snapshotEvents()
    .filter(
      (e): e is SessionEvent<'user/message'> =>
        e.type === 'user/message' &&
        e.data.source.kind === 'plugin' &&
        e.data.source.plugin === 'auto-continue',
    )
}

/** Every turn/end reason, in turn order. */
function turnEnds(agent: Agent): unknown[] {
  return agent.session
    .snapshotEvents()
    .filter((e): e is SessionEvent<'turn/end'> => e.type === 'turn/end')
    .map(e => e.data.reason)
}

describe('continuation at the stopping boundary', () => {
  it('steers a continuation prompt when a step is truncated, and the same turn finishes after resuming', async () => {
    const ctx = await harness()
    const adapter = new MockAdapter([
      maxTokensResponse('partial ans'),
      textResponse('finished answer'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(
      createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }),
    )
    await waitForIdle(ctx, agent)

    const steered = continuations(agent)
    expect(steered).toHaveLength(1)
    expect(steered[0]!.data.content).toEqual([
      {
        type: 'text',
        text: expect.stringContaining('cut off at the model output-token limit') as unknown,
      },
    ])
    expect(steered[0]!.data.source).toEqual({
      kind: 'plugin',
      plugin: 'auto-continue',
      form: 'notice',
      summary: 'output ceiling reached — continuing (1/8)',
    })
    // One turn: the continuation resumed the truncated response as step 2.
    expect(turnEnds(agent)).toEqual([{ kind: 'max-tokens' }])
    expect(agent.session.snapshotEvents().filter(e => e.type === 'turn/start')).toHaveLength(1)
    expect(adapter.requests).toHaveLength(2)
    expect(adapter.requests[1]!.messages.at(-2)!.content).toEqual([
      { type: 'text', text: 'partial ans' },
    ])
  })

  it('does not re-steer when a completed continuation step keeps the turn reason sticky', async () => {
    const ctx = await harness()
    const adapter = new MockAdapter([
      maxTokensResponse('partial'),
      textResponse('complete'),
      // A third entry proves the turn closed: a re-steer would consume it.
      textResponse('should never run'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(
      createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }),
    )
    await waitForIdle(ctx, agent)

    expect(continuations(agent)).toHaveLength(1)
    expect(adapter.requests).toHaveLength(2)
  })

  it('chains continuations across consecutive truncated steps, closing the turn at the cap', async () => {
    const ctx = await harness({ maxConsecutive: 2 })
    const adapter = new MockAdapter([
      maxTokensResponse('chunk 1'),
      maxTokensResponse('chunk 2'),
      maxTokensResponse('chunk 3 would stay pending'),
      textResponse('should never run'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(
      createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }),
    )
    await waitForIdle(ctx, agent)

    const steered = continuations(agent)
    expect(steered).toHaveLength(2)
    expect(steered[0]!.data.source).toMatchObject({
      summary: 'output ceiling reached — continuing (1/2)',
    })
    expect(steered[1]!.data.source).toMatchObject({
      summary: 'output ceiling reached — continuing (2/2)',
    })
    expect(turnEnds(agent)).toEqual([{ kind: 'max-tokens' }])
    expect(adapter.requests).toHaveLength(3)
  })

  it('a new user message resets the consecutive count', async () => {
    const ctx = await harness({ maxConsecutive: 1 })
    const adapter = new MockAdapter([
      maxTokensResponse('t1'),
      maxTokensResponse('t2'),
      maxTokensResponse('t3'),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(
      createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }),
    )
    await waitForIdle(ctx, agent)
    expect(continuations(agent)).toHaveLength(1)
    expect(turnEnds(agent)).toEqual([{ kind: 'max-tokens' }])

    agent.followup(
      createUserMessage({ content: [{ type: 'text', text: 'again' }], source: { kind: 'user' } }),
    )
    await waitForIdle(ctx, agent)

    expect(continuations(agent)).toHaveLength(2)
    expect(turnEnds(agent)).toEqual([{ kind: 'max-tokens' }, { kind: 'max-tokens' }])
  })

  it('does not steer on a turn that completes without truncation', async () => {
    const ctx = await harness()
    const adapter = new MockAdapter([textResponse('done')])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(
      createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }),
    )
    await waitForIdle(ctx, agent)

    expect(continuations(agent)).toHaveLength(0)
    expect(turnEnds(agent)).toEqual([{ kind: 'completed' }])
  })

  it('does not continue a delegated one-shot agent: its run reports the limit hit to the parent', async () => {
    const ctx = await harness()
    const adapter = new MockAdapter([maxTokensResponse('cut'), textResponse('never requested')])
    ctx.llm.registerAdapter(['mock'], adapter)
    const child = await ctx.agents.create({
      sessionId: SessionId('child'),
      meta: { delegationDepth: 1 },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    child.agent.followup(
      createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }),
    )
    await waitForIdle(ctx, child.agent)

    expect(continuations(child.agent)).toHaveLength(0)
    expect(turnEnds(child.agent)).toEqual([{ kind: 'max-tokens' }])
    expect(adapter.requests).toHaveLength(1)
  })
})

describe('truncated tool calls', () => {
  it('continues after a tool call was cut off mid-arguments, and the re-issued call executes', async () => {
    const cutOffToolCall: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      {
        type: 'tool-call-delta',
        index: 0,
        id: ToolCallId('c1'),
        name: 'probe',
        argumentsDelta: '{"q":',
      },
      { type: 'finish', reason: { kind: 'max-tokens' } },
    ]
    const ctx = await harness()
    const adapter = new MockAdapter([
      cutOffToolCall,
      toolCallResponse('c2', 'probe', { q: 'ok' }),
      textResponse('done after the tool ran'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(
      createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }),
    )
    await waitForIdle(ctx, agent)

    expect(continuations(agent)).toHaveLength(1)
    expect(adapter.requests).toHaveLength(3)
    expect(turnEnds(agent)).toEqual([{ kind: 'max-tokens' }])
    const toolResults = agent.session.snapshotEvents().filter(e => e.type === 'tool/result')
    expect(toolResults).toHaveLength(1)
  })
})

describe('fail-loud config validation', () => {
  it('rejects a non-integer maxConsecutive', async () => {
    const ctx = await harness()
    await expect(ctx.plugin(AutoContinue, { maxConsecutive: 1.5 })).rejects.toThrow(/integer >= 1/)
  })

  it('rejects a maxConsecutive below 1', async () => {
    const ctx = await harness()
    await expect(ctx.plugin(AutoContinue, { maxConsecutive: 0 })).rejects.toThrow(/integer >= 1/)
  })
})
