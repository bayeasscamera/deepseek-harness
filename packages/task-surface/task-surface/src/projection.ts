/**
 * Projection fold deriving the active task surface from the session log.
 * @module @deepseek-ai/dsh-task-surface/projection
 */

import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { recognizeTaskSurfacePresentationMeta } from './parser.ts'
import type { TaskSurfaceProjection } from './types.ts'

// zod infers mutable members while the projection types declare readonly ones.
const taskSurfaceProjectionSchema = zod.object({
  active: zod.object({ callId: zod.string(), surfaceId: zod.string() }).strict().nullable(),
}).strict().nullable() as unknown as ZodType<TaskSurfaceProjection | null>

/** Derive the active task surface from successful tool/result presentation meta and close it on user messages or dismissal. */
export const taskSurfaceProjectionDefinition = {
  key: 'taskSurface',
  stateVersion: 0,
  init: () => null,
  stateSchema: taskSurfaceProjectionSchema,
  wire: {
    viewSchema: taskSurfaceProjectionSchema,
    view: (state: TaskSurfaceProjection | null) => state,
  },
  apply: (state, event) => {
    if (event.type === 'tool/result') {
      const { error, meta } = event.data
      if (error !== undefined) return state
      const recognized = recognizeTaskSurfacePresentationMeta(meta)
      if (!recognized) return state
      return { active: { callId: event.data.message.source.callId, surfaceId: recognized.surfaceId } }
    }
    if (event.type === 'user/message') {
      if (event.data.source.kind !== 'user') return state
      return { active: null }
    }
    if (event.type === 'task-surface/dismissed') return { active: null }
    // Merge-extensible SessionEventMap: unhandled event kinds leave the state untouched.
    return state
  },
} satisfies ProjectionDefinition<'taskSurface', TaskSurfaceProjection | null>
