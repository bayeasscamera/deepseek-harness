/**
 * Client-namespace projection of the task-surface domain. Client code imports
 * ONLY the client namespace (repo discipline), so `./client` carries the
 * browser-safe value surface: types, runtime constants, limits, parser, and
 * validator. The host-only projection definition stays on the root entry and
 * the invariant companion on `./invariant`.
 * @module @deepseek-ai/dsh-task-surface/client
 */

/* jscpd:ignore-start -- client namespace projects the browser-safe subset of the root barrel */
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
/* jscpd:ignore-end */
