/** Durable fork-cut projection: how much history a seeded Session inherited. */

import type { Context } from '@deepseek-ai/cordis'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import type { ForkCutProjection } from './types.ts'

const forkCutSchema = z.number().int().nonnegative().nullable() as unknown as z.ZodType<ForkCutProjection>

/**
 * The fork cut never changes after creation: a Session's inherited prefix is
 * fixed at create, so the fold captures it from the immutable metadata and
 * ignores every event.
 */
const forkCutProjection = {
  key: 'forkCut',
  stateSchema: forkCutSchema,
  init: (header, inheritedEventCount) => (header.isSeeded ? inheritedEventCount : null),
  apply: state => state,
  wire: { viewSchema: forkCutSchema, view: state => state },
  stateVersion: 1,
} satisfies ProjectionDefinition<'forkCut', ForkCutProjection>

/**
 * Register the fork-cut projection when the registry is present. A parent view
 * reads a child's value from the Session list to mark the source message the
 * child inherited through.
 * @param ctx - Session Controller context.
 */
export function installForkCutProjection(ctx: Context): void {
  ctx.sessionProjections.register(forkCutProjection)
}
