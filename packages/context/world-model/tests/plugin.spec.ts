import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import * as WorldModel from '../src/index.ts'
import { EnvRuleRegistry, seedBuiltinRules } from '../src/index.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const roots: string[] = []
afterAll(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

/** Create an isolated workspace directory that is removed after the suite. */
function tmpRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), `dsh-world-model-${prefix}-`))
  roots.push(root)
  return root
}

/** Boot the core spine, the command registry, and the world-model plugin. */
async function harness(
  config: Partial<WorldModel.Config> = {},
  prePlugin?: (ctx: Context) => void,
): Promise<{ ctx: Context }> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  prePlugin?.(ctx)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(WorldModel, config)
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
  return { ctx }
}

function createAgent(ctx: Context, id: string, cwd?: string): Agent {
  return ctx.agentLoop.create(SessionId(id), { provider: 'mock', model: 'mock' }, cwd === undefined ? {} : { cwd })
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

/** Run one tool execution through the real registry pipeline, optionally agent-backed. */
async function executeTool(ctx: Context, agent: Agent | undefined, name: string, args: unknown): Promise<ToolExecutionResult> {
  return ctx.tools.execute({
    signal: AbortSignal.timeout(5000),
    callId: CallId(`direct-${name}`),
    name,
    arguments: args,
    ...(agent === undefined ? {} : { agent }),
  })
}

/** Run one slash command against the real command registry. */
async function runCommand(ctx: Context, agent: Agent, line: string): Promise<string> {
  const execution = await ctx.commands.execute(agent, line, new AbortController().signal)
  if (execution === undefined) throw new Error(`command "${line}" did not resolve`)
  if (execution.result.kind === 'error') return `ERROR: ${execution.result.text}`
  return execution.result.text ?? ''
}

/** Read the persisted world state of one workspace (every mutating path flushes synchronously). */
async function persistedState(): Promise<Record<string, unknown>> {
  return JSON.parse(readFileSync(join(currentWorkspace, '.dsh', 'world-state.json'), 'utf8')) as Record<string, unknown>
}

let currentWorkspace = ''

async function assembleWorldModelText(ctx: Context): Promise<string> {
  const assembly = await ctx.systemPrompt.assemble()
  return assembly.contexts.find(context => context.name === 'world-model')?.text ?? ''
}

// ---------------------------------------------------------------------------
// Consequence pipeline wired into the agent loop
// ---------------------------------------------------------------------------

describe('consequence pipeline through a real agent loop', () => {
  it('predicts before, records after, and stays silent on a matched low-risk success', async () => {
    currentWorkspace = tmpRoot('success')
    const { ctx } = await harness()
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'probe', {}),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = createAgent(ctx, 'wm-success', currentWorkspace)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    // A matched low-risk success stays silent: no plugin notice rides on the result.
    expect(notices(agent).some(n => n.text.includes('[probe]'))).toBe(false)

    // The settled task was recorded into the workspace store with the session id.
    const state = await persistedState()
    expect(state['sessionId']).toBe('wm-success')
    expect(state['taskHistory']).toEqual([
      expect.objectContaining({ action: 'probe', success: true, outcome: 'ok' }),
    ])
  })

  it('feeds the comparison back when the tool settles as a failure', async () => {
    currentWorkspace = tmpRoot('failure')
    const { ctx } = await harness()
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'failing', {}),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = createAgent(ctx, 'wm-failure', currentWorkspace)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const feedback = notices(agent).find(n => n.text.includes('[failing] settled failure'))
    expect(feedback).toBeDefined()
    expect(feedback?.text).toContain('predicted low risk')
    expect(feedback?.text).toContain('Error: boom')

    const state = await persistedState()
    expect(state['taskHistory']).toEqual([
      expect.objectContaining({ action: 'failing', success: false, outcome: 'boom' }),
    ])
  })

  it('confirms the predicted effects to the model when a high-risk action succeeds', async () => {
    currentWorkspace = tmpRoot('high-risk')
    const { ctx } = await harness()
    ctx.tools.register(defineContentToolFixture({
      name: 'delete_file',
      description: 'd',
      parameters: { path: { type: 'string' } },
      async execute() { return [{ type: 'text', text: 'gone' }] },
    }))
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'delete_file', { path: 'tmp/victim.txt' }),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = createAgent(ctx, 'wm-high-risk', currentWorkspace)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const feedback = notices(agent).find(n => n.text.includes('[delete_file] succeeded'))
    expect(feedback).toBeDefined()
    expect(feedback?.text).toContain('the predicted high risk effects occurred')
    expect(feedback?.text).toContain('warnings: Irreversible deletion')
    await ctx.fiber.dispose()
  })

  it('reports a divergence when a pre-execute listener rewrites the arguments', async () => {
    currentWorkspace = tmpRoot('divergence')
    const { ctx } = await harness()
    ctx.tools.register(defineContentToolFixture({
      name: 'write_to_file',
      description: 'w',
      parameters: { path: { type: 'string' } },
      async execute() { return [{ type: 'text', text: 'written' }] },
    }))
    // A downstream pre-execute listener rewrites the input AFTER the plugin
    // predicted from the original arguments; the post comparison must merge
    // onto its decision and report the mismatch.
    ctx.on('tools/pre-execute', async (_exec, next) => {
      const decision = await next()
      if (decision.kind !== 'allow') return decision
      return { kind: 'allow', updatedInput: { path: 'rewritten.txt' } }
    })
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'write_to_file', { path: 'original.txt' }),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = createAgent(ctx, 'wm-divergence', currentWorkspace)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const feedback = notices(agent).find(n => n.text.includes('[write_to_file] settled success but diverged'))
    expect(feedback).toBeDefined()
    expect(feedback?.text).toContain('missing: file:original.txt:create')
    await ctx.fiber.dispose()
  })

  it('records nothing when a pre-execute listener denies before the plugin runs', async () => {
    currentWorkspace = tmpRoot('pre-deny')
    const { ctx } = await harness({}, (registerCtx) => {
      registerCtx.on('tools/pre-execute', async () => ({ kind: 'deny' as const, reason: 'sealed' }))
    })
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'probe', {}),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = createAgent(ctx, 'wm-pre-deny', currentWorkspace)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(notices(agent).some(n => n.text.includes('[probe]'))).toBe(false)
    await ctx.fiber.dispose()
    expect(existsSync(join(currentWorkspace, '.dsh'))).toBe(false)
  })

  it('still reconciles and feeds back when a later listener denies after the prediction', async () => {
    currentWorkspace = tmpRoot('post-deny')
    const { ctx } = await harness()
    ctx.on('tools/pre-execute', async () => ({ kind: 'deny' as const, reason: 'sealed' }))
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'probe', {}),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = createAgent(ctx, 'wm-post-deny', currentWorkspace)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const feedback = notices(agent).find(n => n.text.includes('[probe] settled failure'))
    expect(feedback).toBeDefined()
    expect(feedback?.text).toContain('Error: sealed')

    const state = await persistedState()
    expect(state['taskHistory']).toEqual([
      expect.objectContaining({ action: 'probe', success: false, outcome: 'sealed' }),
    ])
  })

  it('attaches the comparison to a blocked result', async () => {
    currentWorkspace = tmpRoot('block')
    const { ctx } = await harness()
    ctx.on('tools/post-execute', async () => ({ kind: 'block', feedback: [{ type: 'text', text: 'stop-it' }] }))
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'failing', {}),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = createAgent(ctx, 'wm-block', currentWorkspace)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(notices(agent).some(n => n.text.includes('[failing] settled failure'))).toBe(true)
    const results = [...agent.session.events].filter(e => e.type === 'tool/result')
    expect(JSON.stringify(results)).toContain('stop-it')
    await ctx.fiber.dispose()
  })

  it('is transparent to direct tool executions without an agent', async () => {
    currentWorkspace = tmpRoot('agentless')
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(currentWorkspace)
    try {
      const { ctx } = await harness()
      await executeTool(ctx, undefined, 'probe', {})
      await ctx.fiber.dispose()
      expect(existsSync(join(currentWorkspace, '.dsh'))).toBe(false)
    } finally {
      cwdSpy.mockRestore()
    }
  })
})

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

describe('world-model tools', () => {
  it('world_model_predict returns the risk assessment and renders it', async () => {
    const { ctx } = await harness()
    const agent = createAgent(ctx, 'wm-predict', currentWorkspace = tmpRoot('predict'))
    const result = await executeTool(ctx, agent, 'world_model_predict', {
      action: 'run_command',
      argsJson: JSON.stringify({ command: 'rm -rf /tmp/x' }),
    })
    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ action: 'run_command', riskLevel: 'critical', reversible: false })
    expect(result.content[0]?.type).toBe('text')
    expect((result.content[0] as { text: string }).text).toContain('Risk: critical')
    await ctx.fiber.dispose()
  })

  it('world_model_predict works without argsJson', async () => {
    const { ctx } = await harness()
    const result = await executeTool(ctx, undefined, 'world_model_predict', { action: 'grep_search' })
    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ riskLevel: 'none' })
  })

  it('world_model_predict fails loud on invalid and non-object argsJson', async () => {
    const { ctx } = await harness()
    const invalid = await executeTool(ctx, undefined, 'world_model_predict', { action: 'probe', argsJson: '{broken' })
    expect(invalid.isError).toBe(true)
    expect(invalid.error?.message).toContain('argsJson is not valid JSON')

    const nonObject = await executeTool(ctx, undefined, 'world_model_predict', { action: 'probe', argsJson: '"just a string"' })
    expect(nonObject.isError).toBe(true)
    expect(nonObject.error?.message).toContain('argsJson must be a JSON object')
  })

  it('world_model_query serves rules and telemetry from the registry', async () => {
    const { ctx } = await harness()
    const rules = await executeTool(ctx, undefined, 'world_model_query', { queryType: 'rules' })
    expect((rules.content[0] as { text: string }).text).toContain('## Environment Rules')

    const telemetry = await executeTool(ctx, undefined, 'world_model_query', { queryType: 'telemetry' })
    expect(JSON.parse((telemetry.content[0] as { text: string }).text)).toHaveProperty('platform')
    await ctx.fiber.dispose()
  })

  it('world_model_query reaches the per-workspace store without a prior command', async () => {
    currentWorkspace = tmpRoot('query')
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(currentWorkspace)
    try {
      const { ctx } = await harness()
      // The store bootstraps from the process cwd for agent-less callers.
      const saved = await executeTool(ctx, undefined, 'world_model_save_fact', { key: 'build', valueJson: '"pnpm"' })
      expect(saved.isError).toBe(false)

      const facts = await executeTool(ctx, undefined, 'world_model_query', { queryType: 'facts' })
      expect(JSON.parse((facts.content[0] as { text: string }).text)).toEqual({ build: 'pnpm' })
      expect(existsSync(join(currentWorkspace, '.dsh', 'world-state.json'))).toBe(true)

      const history = await executeTool(ctx, undefined, 'world_model_query', { queryType: 'history' })
      expect(JSON.parse((history.content[0] as { text: string }).text)).toEqual([])
    } finally {
      cwdSpy.mockRestore()
    }
  })

  it('world_model_query lists recorded task history for agent-backed callers', async () => {
    const workspace = tmpRoot('history')
    const { ctx } = await harness()
    const agent = createAgent(ctx, 'wm-history', workspace)
    await executeTool(ctx, agent, 'probe', {})
    const history = await executeTool(ctx, agent, 'world_model_query', { queryType: 'history' })
    const entries = JSON.parse((history.content[0] as { text: string }).text) as { action: string }[]
    expect(entries).toHaveLength(1)
    expect(entries[0]!.action).toBe('probe')
    await ctx.fiber.dispose()
  })

  it('world_model_save_fact stores JSON and plain-text values durably', async () => {
    const workspace = tmpRoot('save-fact')
    const { ctx } = await harness()
    const agent = createAgent(ctx, 'wm-save-fact', workspace)
    await executeTool(ctx, agent, 'world_model_save_fact', { key: 'structured', valueJson: '{"nested":true}' })
    await executeTool(ctx, agent, 'world_model_save_fact', { key: 'plain', valueJson: 'just text' })

    const result = await executeTool(ctx, agent, 'world_model_query', { queryType: 'facts' })
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({ structured: { nested: true }, plain: 'just text' })
    // save_fact flushes synchronously: the file is durable without disposal.
    expect(existsSync(join(workspace, '.dsh', 'world-state.json'))).toBe(true)
    const raw = JSON.parse(readFileSync(join(workspace, '.dsh', 'world-state.json'), 'utf8')) as { customFacts: Record<string, unknown>; sessionId: string }
    expect(Object.keys(raw.customFacts).sort()).toEqual(['plain', 'structured'])
    expect(raw.sessionId).toBe('wm-save-fact')
  })
})

// ---------------------------------------------------------------------------
// Per-workspace store isolation
// ---------------------------------------------------------------------------

describe('per-workspace state stores', () => {
  it('keeps two workspaces isolated from each other', async () => {
    const workspaceA = tmpRoot('ws-a')
    const workspaceB = tmpRoot('ws-b')
    const { ctx } = await harness()
    const agentA = createAgent(ctx, 'wm-ws-a', workspaceA)
    const agentB = createAgent(ctx, 'wm-ws-b', workspaceB)

    await executeTool(ctx, agentA, 'world_model_save_fact', { key: 'workspace', valueJson: '"A"' })
    await executeTool(ctx, agentB, 'world_model_save_fact', { key: 'workspace', valueJson: '"B"' })

    const factsA = JSON.parse(((await executeTool(ctx, agentA, 'world_model_query', { queryType: 'facts' })).content[0] as { text: string }).text) as Record<string, unknown>
    const factsB = JSON.parse(((await executeTool(ctx, agentB, 'world_model_query', { queryType: 'facts' })).content[0] as { text: string }).text) as Record<string, unknown>
    expect(factsA).toEqual({ workspace: 'A' })
    expect(factsB).toEqual({ workspace: 'B' })

    const stateA = JSON.parse(readFileSync(join(workspaceA, '.dsh', 'world-state.json'), 'utf8')) as { sessionId: string }
    const stateB = JSON.parse(readFileSync(join(workspaceB, '.dsh', 'world-state.json'), 'utf8')) as { sessionId: string }
    expect(stateA.sessionId).toBe('wm-ws-a')
    expect(stateB.sessionId).toBe('wm-ws-b')
  })

  it('caches one store per cwd instead of re-reading the file per call', async () => {
    const workspace = tmpRoot('ws-cache')
    const { ctx } = await harness()
    const agent = createAgent(ctx, 'wm-ws-cache', workspace)
    await executeTool(ctx, agent, 'world_model_save_fact', { key: 'k', valueJson: '1' })
    // The second call goes through the cached store; the fact set through it
    // lands in the same file.
    await executeTool(ctx, agent, 'world_model_save_fact', { key: 'k2', valueJson: '2' })
    const raw = JSON.parse(readFileSync(join(workspace, '.dsh', 'world-state.json'), 'utf8')) as { customFacts: Record<string, unknown> }
    expect(raw.customFacts).toEqual({ k: 1, k2: 2 })
  })
})

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

describe('/env command', () => {
  it('lists the active environment rules', async () => {
    const workspace = tmpRoot('env-list')
    const { ctx } = await harness()
    const agent = createAgent(ctx, 'wm-env-list', workspace)
    const text = await runCommand(ctx, agent, '/env list')
    expect(text).toContain('## Environment Rules')
    expect(text).toContain('constraint:no-credential-commit')
    expect(text).toContain('### Runtime Telemetry')
  })

  it('defaults to list on empty input', async () => {
    const workspace = tmpRoot('env-default')
    const { ctx } = await harness()
    const agent = createAgent(ctx, 'wm-env-default', workspace)
    const text = await runCommand(ctx, agent, '/env')
    expect(text).toContain('## Environment Rules')
  })

  it('reports when no rules are active and shows telemetry directly', async () => {
    const workspace = tmpRoot('env-empty')
    const { ctx } = await harness()
    const agent = createAgent(ctx, 'wm-env-empty', workspace)
    const seeded = new EnvRuleRegistry()
    seedBuiltinRules(seeded)
    for (const rule of seeded.list()) {
      await runCommand(ctx, agent, `/env remove ${rule.id}`)
    }
    expect(await runCommand(ctx, agent, '/env list')).toBe('No active environment rules.')

    const telemetry = await runCommand(ctx, agent, '/env telemetry')
    expect(telemetry).toContain('### Runtime Telemetry')
    expect(telemetry).toContain('cores')
  })

  it('validates an action on demand and reports the result is advisory', async () => {
    const workspace = tmpRoot('env-check')
    const { ctx } = await harness()
    const agent = createAgent(ctx, 'wm-env-check', workspace)

    expect(await runCommand(ctx, agent, '/env check')).toBe('ERROR: Usage: /env check <action_name>')

    const safe = await runCommand(ctx, agent, '/env check view_file')
    expect(safe).toContain('### Policy validation for `view_file` (advisory)')
    expect(safe).toContain('**Allowed**: yes')
    expect(safe).not.toContain('**Violations**')

    await runCommand(ctx, agent, '/env remove permission:filesystem-write')
    const blocked = await runCommand(ctx, agent, '/env check write_to_file')
    expect(blocked).toContain('**Allowed**: no')
    expect(blocked).toContain('permission:filesystem-write')
  })

  it('adds rules with a validated category', async () => {
    const workspace = tmpRoot('env-add')
    const { ctx } = await harness()
    const agent = createAgent(ctx, 'wm-env-add', workspace)

    expect(await runCommand(ctx, agent, '/env add'))
      .toBe('ERROR: Usage: /env add <id> <capability|constraint|permission|resource> <description>')
    expect(await runCommand(ctx, agent, '/env add custom:rule'))
      .toBe('ERROR: Usage: /env add <id> <capability|constraint|permission|resource> <description>')
    expect(await runCommand(ctx, agent, '/env add custom:rule category Be careful'))
      .toBe('ERROR: Unknown category "category". Valid categories: capability, constraint, permission, resource.')

    expect(await runCommand(ctx, agent, '/env add custom:rule constraint Be careful'))
      .toBe('Rule "custom:rule" added (constraint).')
    expect(await runCommand(ctx, agent, '/env list')).toContain('custom:rule')
  })

  it('removes rules with usage errors named', async () => {
    const workspace = tmpRoot('env-remove')
    const { ctx } = await harness()
    const agent = createAgent(ctx, 'wm-env-remove', workspace)

    expect(await runCommand(ctx, agent, '/env remove')).toBe('ERROR: Usage: /env remove <id>')
    expect(await runCommand(ctx, agent, '/env remove constraint:esm-only')).toBe('Rule "constraint:esm-only" deactivated.')
  })

  it('toggles rules in both directions and rejects unknown ids', async () => {
    const workspace = tmpRoot('env-toggle')
    const { ctx } = await harness()
    const agent = createAgent(ctx, 'wm-env-toggle', workspace)

    expect(await runCommand(ctx, agent, '/env toggle')).toBe('ERROR: Usage: /env toggle <id>')
    expect(await runCommand(ctx, agent, '/env toggle test:missing')).toBe('ERROR: Rule "test:missing" not found.')
    expect(await runCommand(ctx, agent, '/env toggle constraint:esm-only')).toBe('Rule "constraint:esm-only" deactivated.')
    expect(await runCommand(ctx, agent, '/env toggle constraint:esm-only')).toBe('Rule "constraint:esm-only" activated.')
  })

  it('rejects unknown subcommands', async () => {
    const workspace = tmpRoot('env-unknown')
    const { ctx } = await harness()
    const agent = createAgent(ctx, 'wm-env-unknown', workspace)
    expect(await runCommand(ctx, agent, '/env bogus'))
      .toBe('ERROR: Unknown subcommand. Usage: /env [list | telemetry | check | add | remove | toggle]')
  })
})

describe('/worldstate command', () => {
  it('defaults to show on empty input', async () => {
    const workspace = tmpRoot('ws-default')
    const { ctx } = await harness()
    const agent = createAgent(ctx, 'wm-ws-default', workspace)
    const text = await runCommand(ctx, agent, '/worldstate')
    expect(text).toContain('### Current World-Model State')
  })

  it('shows the current state and resets it', async () => {
    const workspace = tmpRoot('ws-show')
    const { ctx } = await harness()
    const agent = createAgent(ctx, 'wm-ws-show', workspace)

    const show = await runCommand(ctx, agent, '/worldstate show')
    expect(show).toContain('### Current World-Model State')
    expect(show).toContain(join(workspace, '.dsh', 'world-state.json'))
    expect(show).toContain('"taskHistory": []')

    await executeTool(ctx, agent, 'world_model_save_fact', { key: 'kept', valueJson: '1' })
    expect(await runCommand(ctx, agent, '/worldstate reset')).toBe('World-model state reset and synchronized to disk.')
    expect(await runCommand(ctx, agent, '/worldstate facts')).toBe('No custom facts recorded.')
  })

  it('sets and removes facts with usage errors named', async () => {
    const workspace = tmpRoot('ws-set')
    const { ctx } = await harness()
    const agent = createAgent(ctx, 'wm-ws-set', workspace)

    expect(await runCommand(ctx, agent, '/worldstate set')).toBe('ERROR: Usage: /worldstate set <key> <value>')
    expect(await runCommand(ctx, agent, '/worldstate set runner pnpm')).toBe('Fact "runner" set in the persistent store.')
    expect(await runCommand(ctx, agent, '/worldstate facts')).toContain('- **runner**: `"pnpm"`')
    expect(await runCommand(ctx, agent, '/worldstate set runner')).toBe('Fact "runner" removed from the persistent store.')
    expect(await runCommand(ctx, agent, '/worldstate facts')).toBe('No custom facts recorded.')
  })

  it('lists the task history once tasks have been recorded', async () => {
    const workspace = tmpRoot('ws-history')
    const { ctx } = await harness()
    const agent = createAgent(ctx, 'wm-ws-history', workspace)
    expect(await runCommand(ctx, agent, '/worldstate history')).toBe('No tasks in the history.')

    await executeTool(ctx, agent, 'probe', {})
    await executeTool(ctx, agent, 'failing', {})
    const history = await runCommand(ctx, agent, '/worldstate history')
    expect(history).toContain('### Task history (2 entries)')
    expect(history).toContain('✅] **probe**')
    expect(history).toContain('❌] **failing** — boom')
  })

  it('lists recent consequences with risk badges and divergence footer', async () => {
    const workspace = tmpRoot('ws-consequences')
    const { ctx } = await harness()
    ctx.tools.register(defineContentToolFixture({
      name: 'delete_file',
      description: 'd',
      parameters: { path: { type: 'string' } },
      async execute() { return [{ type: 'text', text: 'gone' }] },
    }))
    ctx.tools.register(defineContentToolFixture({
      name: 'bash',
      description: 'b',
      parameters: { command: { type: 'string' } },
      async execute() { return [{ type: 'text', text: 'ran' }] },
    }))
    const agent = createAgent(ctx, 'wm-ws-consequences', workspace)
    expect(await runCommand(ctx, agent, '/worldstate consequences')).toBe('No consequences recorded in this session.')

    await executeTool(ctx, agent, 'probe', {})
    const noDivergences = await runCommand(ctx, agent, '/worldstate consequences')
    expect(noDivergences).toContain('🟢 LOW')
    expect(noDivergences).not.toContain('anomaly/divergence')

    await executeTool(ctx, agent, 'bash', { command: 'echo hi' })
    await executeTool(ctx, agent, 'delete_file', { path: 'victim.txt' })
    await executeTool(ctx, agent, 'bash', { command: 'rm -rf target' })
    const badges = await runCommand(ctx, agent, '/worldstate consequences')
    for (const badge of ['🟢 LOW', '🟡 MEDIUM', '🟠 HIGH', '🔴 CRITICAL']) {
      expect(badges).toContain(badge)
    }

    await executeTool(ctx, agent, 'failing', {})
    const withDivergences = await runCommand(ctx, agent, '/worldstate consequences')
    expect(withDivergences).toContain('anomaly/divergence(s) detected')
  })

  it('lists high-risk actions and rejects unknown subcommands', async () => {
    const workspace = tmpRoot('ws-risk')
    const { ctx } = await harness()
    ctx.tools.register(defineContentToolFixture({
      name: 'delete_file',
      description: 'd',
      parameters: { path: { type: 'string' } },
      async execute() { return [{ type: 'text', text: 'gone' }] },
    }))
    const agent = createAgent(ctx, 'wm-ws-risk', workspace)
    expect(await runCommand(ctx, agent, '/worldstate risk')).toBe('No high-risk actions detected in this session.')

    await executeTool(ctx, agent, 'delete_file', { path: 'victim.txt' })
    const risk = await runCommand(ctx, agent, '/worldstate risk')
    expect(risk).toContain('### High-risk actions detected')
    expect(risk).toContain('**delete_file** [HIGH]')
    expect(risk).toContain('Irreversible deletion')

    expect(await runCommand(ctx, agent, '/worldstate bogus'))
      .toBe('ERROR: Unknown subcommand. Usage: /worldstate [show | reset | set | facts | history | consequences | risk]')
  })
})

// ---------------------------------------------------------------------------
// System prompt injection
// ---------------------------------------------------------------------------

describe('system prompt injection', () => {
  it('injects the environment rules section at order 55', async () => {
    const { ctx } = await harness()
    const text = await assembleWorldModelText(ctx)
    expect(text).toContain('## Environment Rules')
    expect(text).not.toContain('additional rule(s) omitted')
  })

  it('omits rules beyond maxRules with an explicit note', async () => {
    const { ctx } = await harness({ maxRules: 2 })
    const text = await assembleWorldModelText(ctx)
    // Nine builtin rules are seeded; two rendered, seven omitted.
    expect(text).toContain('7 additional rule(s) omitted.')
  })

  it('injects nothing when every rule is inactive', async () => {
    const workspace = tmpRoot('prompt-empty')
    const { ctx } = await harness()
    const agent = createAgent(ctx, 'wm-prompt-empty', workspace)
    const seeded = new EnvRuleRegistry()
    seedBuiltinRules(seeded)
    for (const rule of seeded.list()) {
      await runCommand(ctx, agent, `/env remove ${rule.id}`)
    }
    expect(await assembleWorldModelText(ctx)).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Config plumbing
// ---------------------------------------------------------------------------

describe('config plumbing', () => {
  it('caps the persisted task history at maxHistory', async () => {
    currentWorkspace = tmpRoot('cfg-history')
    const { ctx } = await harness({ maxHistory: 1 })
    const agent = createAgent(ctx, 'wm-cfg-history', currentWorkspace)
    await executeTool(ctx, agent, 'probe', {})
    await executeTool(ctx, agent, 'probe', {})

    const state = await persistedState()
    expect(state['taskHistory']).toHaveLength(1)
  })

  it('caps the in-memory consequence history at maxConsequences', async () => {
    const workspace = tmpRoot('cfg-consequences')
    const { ctx } = await harness({ maxConsequences: 1 })
    const agent = createAgent(ctx, 'wm-cfg-consequences', workspace)
    await executeTool(ctx, agent, 'probe', {})
    await executeTool(ctx, agent, 'probe', {})

    const consequences = await runCommand(ctx, agent, '/worldstate consequences')
    expect(consequences).toContain('### Recent consequences & risks')
    expect(consequences.match(/- \*\*probe\*\*/g)).toHaveLength(1)
    await ctx.fiber.dispose()
  })
})
