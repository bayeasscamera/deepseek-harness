import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionSeq, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { ToolCallId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { TASK_SURFACE_PRESENTATION_META_KIND } from '../src/index.ts'
import * as TaskSurfaceInvariant from '../src/invariant.ts'

const validMeta: JsonValue = {
  kind: TASK_SURFACE_PRESENTATION_META_KIND,
  version: 1,
  surfaceId: 's1',
  model: { version: 1, title: 'Deploy', sections: [], submit: { label: 'Go' } },
}

function toolResultPayload(meta?: JsonValue, error?: { name: string; code: string }) {
  return {
    turn: 1,
    step: 1,
    message: createToolResultMessage({ callId: ToolCallId('c1'), content: [{ type: 'text', text: 'presented' }], isError: false }),
    ...(meta === undefined ? {} : { meta }),
    ...(error === undefined ? {} : { error }),
  }
}

function toolResultEvent(meta?: JsonValue, error?: { name: string; code: string }): SessionEvent {
  return { type: 'tool/result', seq: SessionSeq(0), time: 0, data: toolResultPayload(meta, error) }
}

function turnStartEvent(): SessionEvent {
  return { type: 'turn/start', seq: SessionSeq(0), time: 0, data: { turn: 1 } }
}

async function createHarness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  return ctx
}

describe('task-surface presentation meta invariant', () => {
  it('accepts a replayed session whose tagged meta parses', async () => {
    const ctx = await createHarness()
    ctx.sessions.create().append('tool/result', toolResultPayload(validMeta), { surfaceOp: 'append' })
    await expect(ctx.plugin(TaskSurfaceInvariant).then(() => undefined)).resolves.toBeUndefined()
  })

  it('accepts live tagged meta and unrelated dispatches', async () => {
    const ctx = await createHarness()
    await ctx.plugin(TaskSurfaceInvariant)
    expect(() => { ctx.emit('session/event', {} as Session, toolResultEvent(validMeta)) }).not.toThrow()
    expect(() => { ctx.emit('tools/change') }).not.toThrow()
  })

  it('rejects live tagged meta that does not parse', async () => {
    const ctx = await createHarness()
    await ctx.plugin(TaskSurfaceInvariant)
    expect(() => {
      ctx.emit('session/event', {} as Session, toolResultEvent({ kind: TASK_SURFACE_PRESENTATION_META_KIND, version: 1 }))
    }).toThrow(/does not parse/)
  })

  it('rejects late registration over a replayed session with malformed tagged meta', async () => {
    const ctx = await createHarness()
    ctx.sessions.create().append('tool/result', toolResultPayload({ kind: TASK_SURFACE_PRESENTATION_META_KIND, version: 1 }), { surfaceOp: 'append' })
    await expect(ctx.plugin(TaskSurfaceInvariant).then(() => undefined)).rejects.toThrow(/does not parse/)
  })

  it('ignores events outside the package-owned surface', async () => {
    const ctx = await createHarness()
    await ctx.plugin(TaskSurfaceInvariant)
    expect(() => { ctx.emit('session/event', {} as Session, toolResultEvent({ kind: TASK_SURFACE_PRESENTATION_META_KIND, version: 1 }, { name: 'ToolError', code: 'boom' })) }).not.toThrow()
    expect(() => { ctx.emit('session/event', {} as Session, toolResultEvent({ kind: 'other' })) }).not.toThrow()
    expect(() => { ctx.emit('session/event', {} as Session, toolResultEvent([])) }).not.toThrow()
    expect(() => { ctx.emit('session/event', {} as Session, toolResultEvent()) }).not.toThrow()
    expect(() => { ctx.emit('session/event', {} as Session, turnStartEvent()) }).not.toThrow()
  })
})
