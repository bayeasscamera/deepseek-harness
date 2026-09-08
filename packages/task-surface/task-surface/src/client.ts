/**
 * Client-namespace projection of the task-surface domain: a pure re-export
 * of the package's browser-safe value surface. Client code imports ONLY the
 * client namespace (repo discipline), so `./client` projects the same
 * single-source content the root entry serves to host consumers — zero
 * duplication; host-side projection and invariant surfaces stay on the
 * root and `./invariant` entries.
 * @module @deepseek-ai/dsh-task-surface/client
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
