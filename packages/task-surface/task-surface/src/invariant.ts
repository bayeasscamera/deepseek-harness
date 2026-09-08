/**
 * Package-owned session-event invariants for task surfaces.
 * @module @deepseek-ai/dsh-task-surface/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { parseTaskSurfacePresentationMeta } from './parser.ts'
import { TASK_SURFACE_PRESENTATION_META_KIND } from './runtime.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-task-surface'

/** Cordis companion plugin name. */
export const name = 'task-surface-invariant'

/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Whether one meta payload carries the task-surface tag. */
function isTaggedTaskSurfaceMeta(meta: JsonValue | undefined): meta is JsonValue {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return false
  return (meta as { kind?: unknown }).kind === TASK_SURFACE_PRESENTATION_META_KIND
}

/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/** Validate the package-owned event fields and ignore unrelated events. */
function validateEvent(event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'tool/result') return
  const { error, meta } = event.data
  if (error !== undefined || !isTaggedTaskSurfaceMeta(meta)) return
  try {
    parseTaskSurfacePresentationMeta(meta)
  } catch (cause) {
    fail(`tool/result carries a ${TASK_SURFACE_PRESENTATION_META_KIND} meta that does not parse: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

/** Install validation for loaded and newly appended task-surface presentation meta. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const validateExisting = (session: Session): void => {
    for (const event of session.snapshotEvents()) validateEvent(event, fail)
  }
  ctx.sessions.list().forEach(validateExisting)
  ctx.on('session/created', validateExisting, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const event = (args as [Session, SessionEvent])[1]
    validateEvent(event, fail)
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */

/**
 * Install the package invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
