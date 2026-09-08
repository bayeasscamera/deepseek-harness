/**
 * Strict submission validation and model-visible formatting for task surfaces.
 * The validator returns every issue instead of throwing, so callers can reject
 * a submission with a complete report; the formatter renders the accepted
 * submission as transcript text and never throws. Both are browser-safe.
 * @module @deepseek-ai/dsh-task-surface/validator
 */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { DEFAULT_TASK_SURFACE_LIMITS, jsonByteLength } from './limits.ts'
import type { TaskSurfaceLimits } from './limits.ts'
import type { TaskSurfaceField, TaskSurfaceModelV1, TaskSurfaceOption } from './types.ts'

/**
 * One reason a submission failed validation, keyed by field where applicable.
 * A field is satisfied by its submitted value or, when absent, its declared
 * initial; `required` is a UI hint the validator never reads.
 */
export type TaskSurfaceSubmissionIssue =
  | { readonly code: 'unknown-field'; readonly fieldId: string }
  | { readonly code: 'missing-required'; readonly fieldId: string }
  | { readonly code: 'invalid-text'; readonly fieldId: string }
  | { readonly code: 'invalid-choice'; readonly fieldId: string }
  | { readonly code: 'invalid-multi-choice'; readonly fieldId: string }
  | { readonly code: 'invalid-toggle'; readonly fieldId: string }
  | { readonly code: 'invalid-order'; readonly fieldId: string }
  | { readonly code: 'too-large'; readonly bytes: number; readonly maxBytes: number }

/** Close the field-kind switch; the parser rejects unknown kinds upstream. */
function assertNever(value: never): never {
  throw new Error(`unreachable field kind: ${JSON.stringify(value)}`)
}

/**
 * Whether one raw list value is a valid list of known, unique option ids;
 * `exact` additionally requires a full permutation of the declared options.
 */
function isValidOptionIdList(options: readonly TaskSurfaceOption[], raw: JsonValue, exact: boolean): boolean {
  if (!Array.isArray(raw)) return false
  for (const item of raw) {
    if (typeof item !== 'string') return false
  }
  const ids = raw as string[]
  if (new Set(ids).size !== ids.length) return false
  const optionIds = new Set(options.map(option => option.id))
  for (const id of ids) {
    if (!optionIds.has(id)) return false
  }
  return !exact || ids.length === options.length
}

/** Return the kind-mismatch issue for one present value, or `undefined` when valid. */
function fieldIssue(field: TaskSurfaceField, value: JsonValue): TaskSurfaceSubmissionIssue | undefined {
  switch (field.kind) {
    case 'text':
      return typeof value === 'string' ? undefined : { code: 'invalid-text', fieldId: field.id }
    case 'choice':
      return typeof value === 'string' && field.options.some(option => option.id === value)
        ? undefined
        : { code: 'invalid-choice', fieldId: field.id }
    case 'multi-choice':
      return isValidOptionIdList(field.options, value, false) ? undefined : { code: 'invalid-multi-choice', fieldId: field.id }
    case 'toggle':
      return typeof value === 'boolean' ? undefined : { code: 'invalid-toggle', fieldId: field.id }
    case 'order':
      return isValidOptionIdList(field.options, value, true) ? undefined : { code: 'invalid-order', fieldId: field.id }
    default:
      /* v8 ignore next -- the field-kind union is closed; this arm only makes adding a kind a compile error. */
      return assertNever(field)
  }
}

/**
 * Validate one submission's field values against a surface model. Present
 * values must match their field kind, keys outside the declared fields are
 * rejected, and the serialized values plus note must fit the submission
 * budget. Never throws.
 * @param model - the surface model the submission answers.
 * @param values - the submitted field values keyed by field id.
 * @param note - the optional free-form note, counted against the submission budget.
 * @param limits - size and count ceilings; defaults to the package defaults.
 * @returns the issues in declared field order, then unknown fields sorted by key, then the size budget; empty when the submission is valid.
 */
export function validateTaskSurfaceSubmission(
  model: TaskSurfaceModelV1,
  values: Record<string, JsonValue>,
  note?: string,
  limits: TaskSurfaceLimits = DEFAULT_TASK_SURFACE_LIMITS,
): readonly TaskSurfaceSubmissionIssue[] {
  const issues: TaskSurfaceSubmissionIssue[] = []
  const fields = model.fields ?? []
  for (const field of fields) {
    const raw = values[field.id]
    const value = raw === undefined ? field.initial : raw
    if (value === undefined) {
      issues.push({ code: 'missing-required', fieldId: field.id })
      continue
    }
    const issue = fieldIssue(field, value)
    if (issue !== undefined) issues.push(issue)
  }
  const declaredIds = new Set(fields.map(field => field.id))
  for (const key of Object.keys(values).sort()) {
    if (!declaredIds.has(key)) issues.push({ code: 'unknown-field', fieldId: key })
  }
  const bytes = jsonByteLength(values) + (note === undefined ? 0 : new TextEncoder().encode(note).length)
  if (bytes > limits.maxSubmissionBytes) issues.push({ code: 'too-large', bytes, maxBytes: limits.maxSubmissionBytes })
  return issues
}

/** Resolve one option's label, falling back to the raw id. */
function optionLabel(options: readonly TaskSurfaceOption[], id: string): string {
  return options.find(option => option.id === id)?.label ?? id
}

/** Render one raw list value as joined option labels; foreign shapes stringify. */
function renderOptionIdList(options: readonly TaskSurfaceOption[], value: JsonValue, separator: string): string {
  if (!Array.isArray(value)) return JSON.stringify(value)
  return value.map(item => (typeof item === 'string' ? optionLabel(options, item) : JSON.stringify(item))).join(separator)
}

/** Render one field's effective value for the transcript; `undefined` renders nothing. */
function renderFieldValue(field: TaskSurfaceField, raw: JsonValue | undefined): string | undefined {
  const value = raw === undefined ? field.initial : raw
  if (value === undefined) return undefined
  switch (field.kind) {
    case 'text':
      return typeof value === 'string' ? value : JSON.stringify(value)
    case 'choice':
      return typeof value === 'string' ? optionLabel(field.options, value) : JSON.stringify(value)
    case 'multi-choice':
      return renderOptionIdList(field.options, value, ', ')
    case 'toggle':
      return value ? 'on' : 'off'
    case 'order':
      return renderOptionIdList(field.options, value, ' → ')
    default:
      /* v8 ignore next -- the field-kind union is closed; this arm only makes adding a kind a compile error. */
      return assertNever(field)
  }
}

/**
 * Render one submission as the model-visible transcript text: the surface
 * title, one `label: value` line per declared field in declared order, and the
 * note after a blank line. Absent values fall back to declared initials;
 * fields with neither render nothing. Never throws.
 * @param model - the surface model the submission answers.
 * @param values - the submitted field values keyed by field id.
 * @param note - the optional free-form note.
 * @returns the formatted submission text.
 */
export function formatTaskSurfaceSubmission(model: TaskSurfaceModelV1, values: Record<string, JsonValue>, note?: string): string {
  const lines = [model.title]
  for (const field of model.fields ?? []) {
    const rendered = renderFieldValue(field, values[field.id])
    if (rendered !== undefined) lines.push(`${field.label}: ${rendered}`)
  }
  const trimmedNote = note?.trim()
  if (trimmedNote) lines.push('', trimmedNote)
  return lines.join('\n')
}
