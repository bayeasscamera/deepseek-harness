import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as AutoVerification from '../src/index.ts'
import { checkBracketBalance, verifyContent } from '../src/index.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

async function harness(config: AutoVerification.Config = {}): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AutoVerification, config)
  ctx.tools.register(defineContentToolFixture({
    name: 'write_file',
    description: 'write',
    parameters: { path: { type: 'string' }, content: { type: 'string' } },
    async execute() { return [{ type: 'text', text: 'wrote' }] },
  }))
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

describe('checkBracketBalance', () => {
  it('returns undefined for balanced code', () => {
    expect(checkBracketBalance('function foo() { if (a[0]) { return (1 + 2); } }')).toBeUndefined()
  })

  it('handles strings and comments correctly', () => {
    const code = `
      // { unbalanced in comment
      /* ( unbalanced in block comment */
      const s = "{ unbalanced in string ( ";
      function bar() { return 42; }
    `
    expect(checkBracketBalance(code)).toBeUndefined()
  })

  it('detects unclosed opening brackets', () => {
    const err = checkBracketBalance('function test() { const a = [1, 2;')
    expect(err).toContain('Unclosed opening bracket')
  })

  it('detects unmatched closing brackets', () => {
    const err = checkBracketBalance('function test() { return 1; }}')
    expect(err).toContain("Unmatched closing bracket '}'")
  })
})

describe('verifyContent', () => {
  it('validates valid json', () => {
    expect(verifyContent('config.json', '{"a": 1, "b": [2, 3]}', { checkJson: true })).toBeUndefined()
  })

  it('detects invalid json syntax', () => {
    const err = verifyContent('data.json', '{"a": 1, "b": [2, 3,]}', { checkJson: true })
    expect(err).toContain('JSON syntax error in data.json')
  })

  it('verifies code file brackets', () => {
    const err = verifyContent('src/index.ts', 'export function run() { console.log("missing close"', { checkBrackets: true })
    expect(err).toContain('Structural syntax warning in src/index.ts')
  })

  it('validates balanced UI component markup with JSX fragments', () => {
    const err = verifyContent('src/App.tsx', '<><div><span>Text</span><img src="foo.png" /></div></>', { checkVisualUi: true })
    expect(err).toBeUndefined()
  })

  it('detects unclosed JSX fragment in markup', () => {
    const err = verifyContent('src/App.tsx', '<><div><span>Text</span></div>', { checkVisualUi: true })
    expect(err).toContain('Unclosed UI tag <> detected')
  })

  it('detects unclosed UI component tag in markup', () => {
    const err = verifyContent('src/Card.vue', '<template><div><p>Hello</div></template>', { checkVisualUi: true })
    expect(err).toContain('Visual UI structural warning in src/Card.vue')
  })

  it('validates correct CSS stylesheet', () => {
    const err = verifyContent('src/styles.css', '.card { color: red; font-size: 14px; }', { checkVisualUi: true })
    expect(err).toBeUndefined()
  })

  it('detects unclosed brace in CSS stylesheet', () => {
    const err = verifyContent('src/styles.css', '.card { color: red;', { checkVisualUi: true })
    expect(err).toContain('Stylesheet structural warning in src/styles.css: Unclosed brace (1 remaining)')
  })

  it('detects malformed hex color in CSS stylesheet', () => {
    const err = verifyContent('src/styles.css', '.btn { background: #12; color: #fff; }', { checkVisualUi: true })
    expect(err).toContain('Malformed hex color code "#12"')
  })

  it('detects tab indentation in YAML files', () => {
    const err = verifyContent('config.yaml', 'name: app\n\tport: 8080', {})
    expect(err).toContain('YAML syntax error at line 2: tab characters are forbidden')
  })

  it('detects unclosed YAML frontmatter in Markdown', () => {
    const err = verifyContent('README.md', '---\ntitle: Doc\nauthor: Me\n\n# Body', {})
    expect(err).toContain('Unclosed YAML frontmatter fence')
  })

  it('detects hardcoded secret tokens in source code', () => {
    const err = verifyContent('src/client.ts', 'const key = "sk-1234567890abcdef1234567890abcdef";', {})
    expect(err).toContain('Potential hardcoded API token or credential detected')
  })
})

describe('auto-verification guard integration', () => {
  it('injects diagnostic notice on broken code mutation in agent loop', async () => {
    const ctx = await harness()
    const adapter = new MockAdapter([
      toolCallResponse('call_1', 'write_file', { path: 'test.json', content: '{"invalid": json' }),
      textResponse('I see the error, fixing it.'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)

    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Write the json file' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const events = [...agent.session.events]
    const notice = events.find((e): e is SessionEvent<'user/message'> =>
      e.type === 'user/message'
      && e.data.source.kind === 'plugin'
      && e.data.source.plugin === 'auto-verification',
    )

    expect(notice).toBeDefined()
    const firstPart = notice?.data.content[0] as { type: string; text: string } | undefined
    expect(firstPart?.type).toBe('text')
    expect(firstPart?.text).toContain('JSON syntax error in test.json')
  })

  it('injects visual review notice when visualFeedbackStep is enabled for UI mutations', async () => {
    const ctx = await harness({ visualFeedbackStep: true })
    const adapter = new MockAdapter([
      toolCallResponse('call_ui', 'write_file', { path: 'Component.tsx', content: '<div><span>Valid</span></div>' }),
      textResponse('UI updated.'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)

    const agent = ctx.agentLoop.create(SessionId('a2'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Render component' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const events = [...agent.session.events]
    const notice = events.find((e): e is SessionEvent<'user/message'> =>
      e.type === 'user/message'
      && e.data.source.kind === 'plugin'
      && e.data.source.plugin === 'auto-verification'
      && e.data.source.form === 'notice'
      && e.data.source.summary.includes('Visual Review'),
    )

    expect(notice).toBeDefined()
    const firstPart = notice?.data.content[0] as { type: string; text: string } | undefined
    expect(firstPart?.type).toBe('text')
    expect(firstPart?.text).toContain('Visual Feedback Step')
  })

  it('injects TDD notice when enforceTdd is enabled for code mutations', async () => {
    const ctx = await harness({ enforceTdd: true })
    const adapter = new MockAdapter([
      toolCallResponse('call_code', 'write_file', { path: 'src/service.ts', content: 'export function calc() { return 42; }' }),
      textResponse('Done.'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)

    const agent = ctx.agentLoop.create(SessionId('a3'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Write service' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const events = [...agent.session.events]
    const notice = events.find((e): e is SessionEvent<'user/message'> =>
      e.type === 'user/message'
      && e.data.source.kind === 'plugin'
      && e.data.source.plugin === 'auto-verification'
      && e.data.source.form === 'notice'
      && e.data.source.summary.includes('TDD Check'),
    )

    expect(notice).toBeDefined()
    const firstPart = notice?.data.content[0] as { type: string; text: string } | undefined
    expect(firstPart?.type).toBe('text')
    expect(firstPart?.text).toContain('TDD Pipeline')
  })

  it('detects denylisted security paths and triggers loop constraint notice', async () => {
    const ctx = await harness()
    const adapter = new MockAdapter([
      toolCallResponse('call_secret', 'write_file', { path: '.env.production', content: 'SECRET=12345' }),
      textResponse('Cancelled.'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)

    const agent = ctx.agentLoop.create(SessionId('a4'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Write secret' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const events = [...agent.session.events]
    const notice = events.find((e): e is SessionEvent<'user/message'> =>
      e.type === 'user/message'
      && e.data.source.kind === 'plugin'
      && e.data.source.plugin === 'auto-verification'
      && e.data.source.form === 'notice'
      && e.data.source.summary.includes('Security Denylist'),
    )

    expect(notice).toBeDefined()
    const firstPart = notice?.data.content[0] as { type: string; text: string } | undefined
    expect(firstPart?.type).toBe('text')
    expect(firstPart?.text).toContain('Loop Constraint Violation')
  })

  it('injects loop-engineering verifier notice when enforceLoopVerifier is true', async () => {
    const ctx = await harness({ enforceLoopVerifier: true })
    const adapter = new MockAdapter([
      toolCallResponse('call_fix', 'write_file', { path: 'src/fix.ts', content: 'export const fixed = true;' }),
      textResponse('Verifying.'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)

    const agent = ctx.agentLoop.create(SessionId('a5'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Apply fix' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const events = [...agent.session.events]
    const notice = events.find((e): e is SessionEvent<'user/message'> =>
      e.type === 'user/message'
      && e.data.source.kind === 'plugin'
      && e.data.source.plugin === 'auto-verification'
      && e.data.source.form === 'notice'
      && e.data.source.summary.includes('Loop Verifier'),
    )

    expect(notice).toBeDefined()
    const firstPart = notice?.data.content[0] as { type: string; text: string } | undefined
    expect(firstPart?.type).toBe('text')
    expect(firstPart?.text).toContain('Loop-Engineering Verifier')
  })

  it('fires the circuit-breaker notice exactly once per target', async () => {
    const ctx = await harness()
    const adapter = new MockAdapter([
      toolCallResponse('call_repeat_1', 'write_file', { path: 'src/loop.ts', content: 'export const value = 1;' }),
      toolCallResponse('call_repeat_2', 'write_file', { path: 'src/loop.ts', content: 'export const value = 2;' }),
      toolCallResponse('call_repeat_3', 'write_file', { path: 'src/loop.ts', content: 'export const value = 3;' }),
      toolCallResponse('call_repeat_4', 'write_file', { path: 'src/loop.ts', content: 'export const value = 4;' }),
      textResponse('Escalated once, then stayed quiet.'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)

    const agent = ctx.agentLoop.create(SessionId('a6'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Repeat the same edit' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const events = [...agent.session.events]
    const breakers = events.filter((e): e is SessionEvent<'user/message'> =>
      e.type === 'user/message'
      && e.data.source.kind === 'plugin'
      && e.data.source.plugin === 'auto-verification'
      && e.data.source.form === 'notice'
      && e.data.source.summary.includes('Circuit Breaker'),
    )

    // The default maxAttemptsPerTarget is 3, so the third edit escalates and
    // the fourth must not re-inject the notice into model context.
    expect(breakers).toHaveLength(1)
    const firstPart = breakers[0]?.data.content[0] as { type: string; text: string } | undefined
    expect(firstPart?.type).toBe('text')
    expect(firstPart?.text).toContain('Loop Engineering Circuit-Breaker')
  })
})
