/**
 * Enforced size and count ceilings for task-surface models and submissions.
 * @module @deepseek-ai/dsh-task-surface/limits
 */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Enforced size and count ceilings for one surface model and its submissions. */
export interface TaskSurfaceLimits {
  /** Maximum serialized byte length of the normalized model. */
  readonly maxModelBytes: number
  /** Maximum total number of blocks across all sections of one model. */
  readonly maxBlocks: number
  /** Maximum number of fields in one model. */
  readonly maxFields: number
  /** Maximum number of rows in one table block. */
  readonly maxTableRows: number
  /** Maximum serialized byte length of a submission's normalized values plus note. */
  readonly maxSubmissionBytes: number
}

/**
 * Defaults used by parsers and the projection fold when no explicit limits are
 * configured. The Stage 2 task-surface service exposes these as validated
 * configuration fields and governs its write-side limits with them.
 */
export const DEFAULT_TASK_SURFACE_LIMITS: TaskSurfaceLimits = {
  maxModelBytes: 64 * 1024,
  maxBlocks: 64,
  maxFields: 32,
  maxTableRows: 200,
  maxSubmissionBytes: 32 * 1024,
}

/**
 * Byte length of one JSON value's compact serialization (UTF-8).
 * @param value - the JSON value to measure.
 * @returns its serialized byte length.
 */
export function jsonByteLength(value: JsonValue): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
}
