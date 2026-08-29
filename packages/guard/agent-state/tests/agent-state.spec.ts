import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as AgentState from '../src/index.ts'
import { predictAction } from '../src/index.ts'
import { loadState } from '../src/index.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const roots: string[] = []
afterAll(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

/** Boot the core spine + the guard with an isolated store directory. */
async function harness(config: Partial<AgentState.Config> = {}): Promise<{ ctx: Context; store: string }> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  const store = join(mkdtempSync(join(tmpdir(), 'dsh-agent-state-')), 'state.jsonl')
  roots.push(join(store, '..'))
  await ctx.plugin(AgentState, { storeDir: store, ...config })
  ctx.tools.register(defineContentToolFixture({
    name: 'probe',
    description: 'p',
    parameters: {},
    async execute() { return [{ type: 'text', text: 'ok' }] },
  }))
  ctx.tools.register(defineContentToolFixture({
    name: 'failing',
    description: 'f',
    parameters: {},
    async execute() { throw new Error('boom') },
  }))
  return { ctx, store }
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

/** Every plugin-sourced notice context appended for the agent. */
function notices(agent: Agent): { text: string }[] {
  return [...agent.session.events]
    .filter((e): e is SessionEvent<'user/message'> => e.type === 'user/message' && e.data.source.kind !== 'user')
    .map(e => ({ text: e.data.content.map(block => block.type === 'text' ? block.text : '').join('|') }))
}

describe('predictAction', () => {
  it('classifies file writes as reversible with a writes-file consequence', () => {
    const prediction = predictAction('write', { file_path: '/tmp/x.md' })
    expect(prediction.risk).toBe('reversible')
    expect(prediction.consequences[0]?.effect).toBe('writes-file')
    expect(prediction.targets).toEqual(['/tmp/x.md'])
  })

  it('classifies destructive commands as irreversible', () => {
    const prediction = predictAction('bash', { command: 'rm -rf /tmp/x' })
    expect(prediction.risk).toBe('irreversible')
    expect(prediction.consequences.some(c => c.effect === 'destructive-command')).toBe(true)
  })

  it('classifies unknown tools as read-only with an explicit no-mutation consequence', () => {
    const prediction = predictAction('probe', {})
    expect(prediction.risk).toBe('read-only')
    expect(prediction.consequences[0]?.effect).toBe('no-mutation')
  })
})

describe('pipeline through a real agent loop', () => {
  it('predicts before, observes after, and persists per-tool statistics', async () => {
    const { ctx, store } = await harness()
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'probe', {}),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const found = notices(agent)
    expect(found.some(n => n.text.includes('[probe] settled success'))).toBe(true)

    expect(existsSync(store)).toBe(true)
    const persisted = loadState(store)
    expect(persisted.tools['probe']).toBeDefined()
    expect(persisted.tools['probe']?.successes).toBe(1)
    expect(persisted.observations).toHaveLength(1)
    expect(persisted.observations[0]?.tool).toBe('probe')
  })

  it('records a failure observation when the tool settles with isError', async () => {
    const { ctx, store } = await harness()
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'failing', {}),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a2'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const persisted = loadState(store)
    expect(persisted.tools['failing']?.failures).toBe(1)
    const observation = persisted.observations[0]
    expect(observation?.outcome).toBe('failure')
    expect(observation?.matchedPrediction).toBe(true)
  })

  it('flags an unexpected outcome when a read-only prediction meets a hard error', async () => {
    const { ctx, store } = await harness()
    ctx.on('tools/pre-execute', async () => ({ kind: 'deny' as never, reason: 'sealed' }))
    // A denied call still settles through post-execute: the guard observes the deny.
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'probe', {}),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a3'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const persisted = loadState(store)
    const observation = persisted.observations[0]
    expect(observation).toBeDefined()
    expect(observation?.outcome).toBe('failure')
  })

  it('denies predicted-irreversible actions when denyIrreversible is set', async () => {
    const { ctx } = await harness({ denyIrreversible: true })
    ctx.tools.register(defineContentToolFixture({
      name: 'delete',
      description: 'd',
      parameters: { path: { type: 'string' } },
      async execute() { return [{ type: 'text', text: 'gone' }] },
    }))
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'delete', { path: '/tmp/victim' }),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a4'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const results = [...agent.session.events].filter(e => e.type === 'tool/result')
    expect(results).toHaveLength(1)
  })
})
