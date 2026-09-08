/**
 * Host barrel for the task-surface domain. Stage 1 ships no Cordis plugin:
 * the root entry exposes the pure domain (types, runtime, limits, parser,
 * validator, projection definition) and `./invariant` remains the package's
 * only Cordis surface.
 * @module @deepseek-ai/dsh-task-surface
 */

export type * from './types.ts'
export {
  TASK_SURFACE_PRESENTATION_META_KIND,
  TASK_SURFACE_SOURCE_KIND,
  TaskSurfaceId,
  TaskSurfaceSubmissionId,
  TaskSurfaceDismissalId,
} from './runtime.ts'
export { DEFAULT_TASK_SURFACE_LIMITS, jsonByteLength } from './limits.ts'
export type { TaskSurfaceLimits } from './limits.ts'
export {
  parseTaskSurfaceModel,
  parseTaskSurfacePresentationMeta,
  recognizeTaskSurfacePresentationMeta,
  parseTaskSurfaceCorrelation,
} from './parser.ts'
export { formatTaskSurfaceSubmission, validateTaskSurfaceSubmission } from './validator.ts'
export type { TaskSurfaceSubmissionIssue } from './validator.ts'
export { taskSurfaceProjectionDefinition } from './projection.ts'
