/**
 * Runtime constructors and protocol constants for the task-surface domain.
 * @module @deepseek-ai/dsh-task-surface/runtime
 */

import type { TaskSurfaceDismissalId } from './types.ts'
import type { TaskSurfaceId } from './types.ts'
import type { TaskSurfaceSubmissionId } from './types.ts'

/** Presentation meta tag carried by the `tool/result` event's `meta` field. */
export const TASK_SURFACE_PRESENTATION_META_KIND = 'dsh/task-surface'

/**
 * Message-source `kind` reserved for correlated task-surface submissions. The
 * `MessageSourceMap` member implementing it is registered by dsh-apiproxy,
 * never by this package.
 */
export const TASK_SURFACE_SOURCE_KIND = 'taskSurface'

/**
 * Brand a string as a task-surface id.
 * @param id - raw task-surface identifier.
 * @returns the same string with the compile-time brand.
 */
export function TaskSurfaceId(id: string): TaskSurfaceId {
  return id as TaskSurfaceId
}

/**
 * Brand a string as a task-surface submission id.
 * @param id - raw submission identifier.
 * @returns the same string with the compile-time brand.
 */
export function TaskSurfaceSubmissionId(id: string): TaskSurfaceSubmissionId {
  return id as TaskSurfaceSubmissionId
}

/**
 * Brand a string as a task-surface dismissal id.
 * @param id - raw dismissal identifier.
 * @returns the same string with the compile-time brand.
 */
export function TaskSurfaceDismissalId(id: string): TaskSurfaceDismissalId {
  return id as TaskSurfaceDismissalId
}
