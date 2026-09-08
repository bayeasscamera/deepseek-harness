import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionSeq, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { ToolCallId, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { TASK_SURFACE_PRESENTATION_META_KIND, TaskSurfaceDismissalId, TaskSurfaceId, taskSurfaceProjectionDefinition } from '../src/index.ts'

const deployModel: Record<string, JsonValue> = { version: 1, title: 'Deploy', sections: [], submit: { label: 'Go' } }

function openMeta(surfaceId: string): JsonValue {
  return { kind: TASK_SURFACE_PRESENTATION_META_KIND, version: 1, surfaceId, model: deployModel }
}

function openMessage(callId: string) {
  return createToolResultMessage({ callId: ToolCallId(callId), content: [{ type: 'text', text: 'opened' }], isError: false })
}

function appendOpen(session: Session, surfaceId: string, callId: string): void {
  session.append('tool/result', { turn: 1, step: 1, message: openMessage(callId), meta: openMeta(surfaceId) }, { surfaceOp: 'append' })
}

async function createHarness(registerProjection = true): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  if (registerProjection) ctx.sessionProjections.register(taskSurfaceProjectionDefinition)
  const session = ctx.sessions.create()
  return { ctx, session }
}

function activeOf(ctx: Context, session: Session): unknown {
  return ctx.sessionProjections.snapshot(session).values.taskSurface
}

describe('taskSurface projection', () => {
  it('opens on a tool/result with recognizable presentation meta', async () => {
    const { ctx, session } = await createHarness()
    appendOpen(session, 's1', 'c1')
    expect(activeOf(ctx, session)).toEqual({ active: { callId: 'c1', surfaceId: 's1' } })
  })

  it('does not open on a failed tool/result', async () => {
    const { ctx, session } = await createHarness()
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: openMessage('c1'),
      meta: openMeta('s1'),
      error: { name: 'ToolError', code: 'boom' },
    }, { surfaceOp: 'append' })
    expect(activeOf(ctx, session)).toBeNull()
  })

  it('does not open on malformed tagged meta', () => {
    const event: SessionEvent = {
      type: 'tool/result',
      seq: SessionSeq(0),
      time: 0,
      data: {
        turn: 1,
        step: 1,
        message: openMessage('c1'),
        meta: { kind: TASK_SURFACE_PRESENTATION_META_KIND, version: 1 },
      },
    }
    // `apply` here is the projection definition's fold property, not Function.prototype.apply.
    // eslint-disable-next-line prefer-spread
    expect(taskSurfaceProjectionDefinition.apply(null, event)).toBeNull()
  })

  it('closes on a user message', async () => {
    const { ctx, session } = await createHarness()
    appendOpen(session, 's1', 'c1')
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'done' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    expect(activeOf(ctx, session)).toEqual({ active: null })
  })

  it('ignores plugin-sourced user messages', async () => {
    const { ctx, session } = await createHarness()
    appendOpen(session, 's1', 'c1')
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'echo' }], source: { kind: 'plugin', plugin: 'fixture' } }), { surfaceOp: 'append' })
    expect(activeOf(ctx, session)).toEqual({ active: { callId: 'c1', surfaceId: 's1' } })
  })

  it('closes on a dismissal event', async () => {
    const { ctx, session } = await createHarness()
    appendOpen(session, 's1', 'c1')
    session.append('task-surface/dismissed', { surfaceId: TaskSurfaceId('s1'), dismissalId: TaskSurfaceDismissalId('d1') })
    expect(activeOf(ctx, session)).toEqual({ active: null })
  })

  it('replaces an earlier open with a later one', async () => {
    const { ctx, session } = await createHarness()
    appendOpen(session, 's1', 'c1')
    appendOpen(session, 's2', 'c2')
    expect(activeOf(ctx, session)).toEqual({ active: { callId: 'c2', surfaceId: 's2' } })
  })

  it('leaves the state untouched on unrelated events', async () => {
    const { ctx, session } = await createHarness()
    session.append('turn/start', { turn: 1 })
    expect(activeOf(ctx, session)).toBeNull()
  })

  it('disposal removes the projection values key', async () => {
    const { ctx, session } = await createHarness(false)
    const dispose = ctx.sessionProjections.register(taskSurfaceProjectionDefinition)
    appendOpen(session, 's1', 'c1')
    expect(activeOf(ctx, session)).toEqual({ active: { callId: 'c1', surfaceId: 's1' } })
    dispose()
    expect('taskSurface' in ctx.sessionProjections.snapshot(session).values).toBe(false)
  })
})
