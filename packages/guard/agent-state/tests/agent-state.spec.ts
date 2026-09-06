import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as AgentState from '../src/index.ts'
import { loadState, saveState } from '../src/index.ts'
import { predictAction } from '../src/index.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const roots: string[] = []
afterAll(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

/** Config overrides; optional fields accept explicit `undefined` so a test can remove a default under exactOptionalPropertyTypes. */
type HarnessConfig = { [K in keyof AgentState.Config]?: AgentState.Config[K] | undefined }

/** Boot the core spine + the guard with an isolated store directory. */
async function harness(config: HarnessConfig = {}): Promise<{ ctx: Context; store: string }> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  const store = join(mkdtempSync(join(tmpdir(), 'dsh-agent-state-')), 'state.jsonl')
  roots.push(join(store, '..'))
  // A key present with `undefined` removes the harness default instead of
  // overriding it — that is how the store-derivation test opts out of
  // `storeDir` under exactOptionalPropertyTypes.
  const resolved = { storeDir: store, ...config } as Record<string, unknown>
  if (resolved['storeDir'] === undefined) delete resolved['storeDir']
  await ctx.plugin(AgentState, resolved)
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

/** Flattened text of every message the mock adapter received on one request. */
function requestTexts(request: GenerateOptions): string[] {
  return request.messages.map(m => m.content.map(block => block.type === 'text' ? block.text : '').join('\n'))
}

const RECALL_TEXT = 'Durable tool history for this workspace:\n- probe: 100% success over 3 settled calls; lessons: none'

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

describe('store atomicity', () => {
  it('replaces the store without leaving a temp file behind', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-agent-state-atomic-'))
    roots.push(dir)
    const path = join(dir, 'state.jsonl')
    saveState(path, { version: 1, tools: {}, observations: [] })
    expect(existsSync(`${path}.tmp`)).toBe(false)
    expect(loadState(path).version).toBe(1)
  })

  it('rethrows write failures after cleaning the temp file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-agent-state-atomic-'))
    roots.push(dir)
    const path = join(dir, 'state.jsonl')
    // A directory at the target path makes the final rename fail; the temp
    // file exists at that point and must not survive the rethrow.
    mkdirSync(path)
    expect(() => { saveState(path, { version: 1, tools: {}, observations: [] }) }).toThrow()
    expect(existsSync(`${path}.tmp`)).toBe(false)
  })
})

describe('store retention', () => {
  it('caps observations and per-tool lessons via Config', async () => {
    const { ctx, store } = await harness({ maxObservations: 2, maxLessonsPerTool: 1 })
    const service = ctx.agentState
    const base = { tool: 'bash', outcome: 'success' as const, matchedPrediction: true, unexpected: [] as string[], lesson: '', at: 0 }
    service.foldObservation({ ...base, id: 'o1', lesson: 'first' })
    service.foldObservation({ ...base, id: 'o2', lesson: 'second' })
    service.foldObservation({ ...base, id: 'o3', outcome: 'failure', lesson: 'third' })

    const persisted = loadState(store)
    expect(persisted.observations).toHaveLength(2)
    expect(persisted.observations.map(o => o.id)).toEqual(['o3', 'o2'])
    expect(persisted.tools['bash']?.lessons).toEqual(['third'])
    expect(persisted.tools['bash']?.failures).toBe(1)
  })

  it('treats a storeDir without a .jsonl suffix as a directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-agent-state-dir-'))
    roots.push(dir)
    const { ctx } = await harness({ storeDir: dir })
    ctx.agentState.foldObservation({ id: 'o1', tool: 'bash', outcome: 'success', matchedPrediction: true, unexpected: [], lesson: '', at: 0 })
    expect(existsSync(join(dir, 'state.jsonl'))).toBe(true)
  })

  it('derives the store path from $DSH_HOME when storeDir is omitted', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-agent-state-home-'))
    roots.push(home)
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const { ctx } = await harness({ storeDir: undefined })
      ctx.agentState.foldObservation({ id: 'o1', tool: 'bash', outcome: 'success', matchedPrediction: true, unexpected: [], lesson: '', at: 0 })
      const key = createHash('sha256').update(process.cwd()).digest('hex').slice(0, 16)
      expect(existsSync(join(home, 'agent-state', key, 'state.jsonl'))).toBe(true)
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
    }
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

    // A matched success stays silent: no plugin notice rides on the result.
    expect(notices(agent).some(n => n.text.includes('[probe] settled'))).toBe(false)

    expect(existsSync(store)).toBe(true)
    expect(existsSync(`${store}.tmp`)).toBe(false)
    const persisted = loadState(store)
    expect(persisted.tools['probe']).toBeDefined()
    expect(persisted.tools['probe']?.successes).toBe(1)
    expect(persisted.observations).toHaveLength(1)
    expect(persisted.observations[0]?.tool).toBe('probe')
  })

  it('feeds the comparison back when the tool settles as a failure', async () => {
    const { ctx, store } = await harness()
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'failing', {}),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a2'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(notices(agent).some(n => n.text.includes('[failing] settled failure'))).toBe(true)
    const persisted = loadState(store)
    expect(persisted.tools['failing']?.failures).toBe(1)
    const observation = persisted.observations[0]
    expect(observation?.outcome).toBe('failure')
    expect(observation?.matchedPrediction).toBe(true)
  })

  it('attaches the comparison to a blocked result even for a matched success', async () => {
    const { ctx } = await harness()
    ctx.on('tools/post-execute', async () => ({ kind: 'block', feedback: [{ type: 'text', text: 'stop-it' }] }))
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'probe', {}),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a3'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(notices(agent).some(n => n.text.includes('[probe] settled success'))).toBe(true)
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
    const agent = ctx.agentLoop.create(SessionId('a4'), { provider: 'mock', model: 'mock' })
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
    const agent = ctx.agentLoop.create(SessionId('a5'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const results = [...agent.session.events].filter(e => e.type === 'tool/result')
    expect(results).toHaveLength(1)
  })

  it('allows predicted-irreversible calls by default and records the settle-time surprise', async () => {
    const { ctx, store } = await harness()
    ctx.tools.register(defineContentToolFixture({
      name: 'bash',
      description: 'b',
      parameters: { command: { type: 'string' } },
      async execute() { return [{ type: 'text', text: 'nuked' }] },
    }))
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'bash', { command: 'rm -rf /tmp/victim' }),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a8'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const persisted = loadState(store)
    expect(persisted.tools['bash']?.successes).toBe(1)
    expect(persisted.observations[0]?.unexpected).toEqual(['an irreversible action was allowed to run and completed'])
    expect(persisted.observations[0]?.matchedPrediction).toBe(false)
    expect(persisted.tools['bash']?.lessons).toContain('bash: an irreversible action was allowed to run and completed')
    expect(notices(agent).some(n => n.text.includes('[bash] settled success') && n.text.includes('UNEXPECTED'))).toBe(true)
  })

  it('is transparent to direct tool executions without an agent', async () => {
    const { ctx, store } = await harness()
    await ctx.tools.execute({ signal: AbortSignal.timeout(5000), callId: CallId('direct-1'), name: 'probe', arguments: {} })
    expect(loadState(store).observations).toHaveLength(0)
  })
})

describe('pre-step recall', () => {
  it('prepends recall once a tool has three settles and still runs the rest of the chain', async () => {
    const { ctx } = await harness()
    // A deeper pre-step listener prepends its own marker; the guard must
    // merge on top of it (await next()) instead of short-circuiting.
    ctx.on('agent/pre-step', async (_payload, next) => {
      const decision = await next()
      if (decision.kind !== 'enter') return decision
      const marker = createUserMessage({ content: [{ type: 'text', text: 'MARKER-PRESENT' }], source: { kind: 'plugin', plugin: 'test-marker' } })
      return { kind: 'enter', messages: [marker, ...decision.messages] }
    })
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'probe', {}),
      toolCallResponse('c2', 'probe', {}),
      toolCallResponse('c3', 'probe', {}),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a6'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(adapter.requests.length).toBeGreaterThanOrEqual(4)
    for (const request of adapter.requests.slice(0, 3)) {
      expect(requestTexts(request).join('\n')).not.toContain('Durable tool history')
    }
    const texts = requestTexts(adapter.requests[3]!)
    expect(texts).toContain(RECALL_TEXT)
    expect(texts.some(t => t.includes('MARKER-PRESENT'))).toBe(true)
    // Model-visible recall is logged: the notice lands as a plugin user message.
    expect(notices(agent).some(n => n.text.includes(RECALL_TEXT))).toBe(true)
  })

  it('renders recall for a named tool subset via the service', async () => {
    const { ctx } = await harness()
    const service = ctx.agentState
    expect(service.recallFor(['bash'])).toBeUndefined()
    for (let i = 0; i < 3; i++) {
      service.foldObservation({ id: `o${i}`, tool: 'bash', outcome: 'success', matchedPrediction: true, unexpected: [], lesson: '', at: 0 })
    }
    const recall = service.recallFor(['bash'])
    expect(recall?.content).toEqual([{ type: 'text', text: RECALL_TEXT.replace('probe', 'bash') }])
  })

  it('passes a reject decision through untouched', async () => {
    const { ctx } = await harness()
    let calls = 0
    ctx.on('agent/pre-step', async () => {
      calls += 1
      return { kind: 'reject' }
    })
    const adapter = new MockAdapter([textResponse('never')])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a7'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(calls).toBe(1)
    expect(adapter.requests).toHaveLength(0)
  })
})
