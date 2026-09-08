/**
 * Strict parsers for the task-surface durable payloads: the surface model
 * carried by `tool/result` presentation meta and the submission correlation
 * carried by a `taskSurface` message source. Strict parsing is the write side's
 * decision; the projection fold reads through the tolerant
 * `recognizeTaskSurfacePresentationMeta` and the package invariant fails loud
 * on these same parsers where it is installed. Every parse returns the
 * normalized model in declared field order, so equal inputs serialize
 * identically.
 * @module @deepseek-ai/dsh-task-surface/parser
 */

import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { DEFAULT_TASK_SURFACE_LIMITS, jsonByteLength } from './limits.ts'
import type { TaskSurfaceLimits } from './limits.ts'
import {
  TASK_SURFACE_PRESENTATION_META_KIND,
  TaskSurfaceId,
  TaskSurfaceSubmissionId,
} from './runtime.ts'
import type {
  TaskSurfaceBlock,
  TaskSurfaceCorrelation,
  TaskSurfaceField,
  TaskSurfaceLayout,
  TaskSurfaceModelV1,
  TaskSurfaceOption,
  TaskSurfacePresentationMeta,
  TaskSurfaceSubmit,
  TaskSurfaceTableRow,
} from './types.ts'

/** Reject one payload element with a positional message. */
function fail(what: string, reason: string): never {
  throw new Error(`invalid task-surface ${what}: ${reason}`)
}

/** Read a JSON value that must be a plain object (never an array or null). */
function readObject(input: JsonValue | undefined, what: string): Record<string, JsonValue> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) fail(what, 'expected a JSON object')
  return input
}

/** Read a JSON value that must be an array. */
function readArray(input: JsonValue | undefined, what: string): readonly JsonValue[] {
  if (!Array.isArray(input)) fail(what, 'expected a JSON array')
  return input
}

/** Read a JSON value that must be a non-empty string. */
function readString(input: JsonValue | undefined, what: string): string {
  if (typeof input !== 'string' || input.length === 0) fail(what, 'expected a non-empty string')
  return input
}

/** Read a JSON value that must be visible text: non-empty after trimming. */
function readDisplayString(input: JsonValue | undefined, what: string): string {
  const text = readString(input, what)
  if (text.trim().length === 0) fail(what, 'expected visible text, got whitespace only')
  return text
}

/** Read a JSON value that must be a boolean. */
function readBoolean(input: JsonValue | undefined, what: string): boolean {
  if (typeof input !== 'boolean') fail(what, 'expected a boolean')
  return input
}

/** Reject every key outside the declared set. */
function checkKeys(record: Record<string, JsonValue>, allowed: readonly string[], what: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) fail(what, `unknown field ${JSON.stringify(key)}`)
  }
}

/** Read an optional object member as visible text. */
function optionalDisplayString(record: Record<string, JsonValue>, key: string, what: string): string | undefined {
  const value = record[key]
  return value === undefined ? undefined : readDisplayString(value, `${what} ${key}`)
}

/** Read an optional object member as a boolean. */
function optionalBoolean(record: Record<string, JsonValue>, key: string, what: string): boolean | undefined {
  const value = record[key]
  return value === undefined ? undefined : readBoolean(value, `${what} ${key}`)
}

const MODEL_KEYS = ['version', 'title', 'description', 'sections', 'fields', 'submit'] as const
const SECTION_KEYS = ['id', 'title', 'layout', 'blocks'] as const
const LAYOUT_KEYS = ['kind', 'columns'] as const
const MARKDOWN_KEYS = ['kind', 'text'] as const
const METRICS_KEYS = ['kind', 'items'] as const
const METRIC_KEYS = ['label', 'value', 'detail'] as const
const TABLE_KEYS = ['kind', 'columns', 'rows'] as const
const COLUMN_KEYS = ['id', 'label'] as const
const DIFF_KEYS = ['kind', 'path', 'before', 'after', 'language'] as const
const NOTICE_KEYS = ['kind', 'tone', 'text'] as const
const TEXT_FIELD_KEYS = ['kind', 'id', 'label', 'multiline', 'required', 'initial'] as const
const SELECT_FIELD_KEYS = ['kind', 'id', 'label', 'options', 'initial'] as const
const TOGGLE_FIELD_KEYS = ['kind', 'id', 'label', 'initial'] as const
const OPTION_KEYS = ['id', 'label', 'detail'] as const
const SUBMIT_KEYS = ['label'] as const
const META_KEYS = ['kind', 'version', 'surfaceId', 'model'] as const
const CORRELATION_KEYS = ['version', 'submissionId', 'callId', 'surfaceId', 'values'] as const

/** Parse one layout declaration. */
function parseLayout(input: JsonValue): TaskSurfaceLayout {
  const layout = readObject(input, 'layout')
  checkKeys(layout, LAYOUT_KEYS, 'layout')
  switch (layout.kind) {
    case 'stack':
      return { kind: 'stack' }
    case 'grid': {
      if (layout.columns !== 2 && layout.columns !== 3) fail('grid layout columns', 'expected 2 or 3')
      return { kind: 'grid', columns: layout.columns }
    }
    default:
      fail('layout', `unknown kind ${JSON.stringify(layout.kind)}`)
  }
}

/** Parse one read-only block and count it against the model-wide block budget. */
function parseBlock(input: JsonValue, limits: TaskSurfaceLimits, blocks: { total: number }): TaskSurfaceBlock {
  blocks.total += 1
  if (blocks.total > limits.maxBlocks) fail('model', `more than ${limits.maxBlocks} blocks`)
  const block = readObject(input, 'block')
  const kind = readString(block.kind, 'block kind')
  switch (kind) {
    case 'markdown':
      checkKeys(block, MARKDOWN_KEYS, 'markdown block')
      return { kind: 'markdown', text: readString(block.text, 'markdown text') }
    case 'metrics': {
      checkKeys(block, METRICS_KEYS, 'metrics block')
      const items = readArray(block.items, 'metrics items').map((item) => {
        const metric = readObject(item, 'metric')
        checkKeys(metric, METRIC_KEYS, 'metric')
        return {
          label: readDisplayString(metric.label, 'metric label'),
          value: readDisplayString(metric.value, 'metric value'),
          ...(metric.detail === undefined ? {} : { detail: readDisplayString(metric.detail, 'metric detail') }),
        }
      })
      if (items.length === 0) fail('metrics items', 'expected at least one metric')
      return { kind: 'metrics', items }
    }
    case 'table': {
      checkKeys(block, TABLE_KEYS, 'table block')
      const columnIds: string[] = []
      const columns = readArray(block.columns, 'table columns').map((item) => {
        const column = readObject(item, 'table column')
        checkKeys(column, COLUMN_KEYS, 'table column')
        const id = readString(column.id, 'table column id')
        if (columnIds.includes(id)) fail('table column id', `duplicate id ${JSON.stringify(id)}`)
        columnIds.push(id)
        return { id, label: readDisplayString(column.label, 'table column label') }
      })
      if (columns.length === 0) fail('table columns', 'expected at least one column')
      const columnIdSet = new Set(columnIds)
      const rows = readArray(block.rows, 'table rows').map((item) => {
        const row = readObject(item, 'table row')
        const keys = Object.keys(row)
        if (keys.length !== columnIds.length || keys.some(key => !columnIdSet.has(key))) {
          fail('table row', 'row keys must be exactly the declared column ids')
        }
        for (const key of columnIds) {
          const value = row[key]
          if (value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
            fail('table row', `cell ${JSON.stringify(key)} must be a scalar (string, number, boolean, or null)`)
          }
        }
        return row as TaskSurfaceTableRow
      })
      if (rows.length > limits.maxTableRows) fail('table rows', `more than ${limits.maxTableRows} rows`)
      return { kind: 'table', columns, rows }
    }
    case 'diff': {
      checkKeys(block, DIFF_KEYS, 'diff block')
      const before = block.before
      if (before !== null && typeof before !== 'string') fail('diff before', 'expected a string or null')
      return {
        kind: 'diff',
        ...(block.path === undefined ? {} : { path: readString(block.path, 'diff path') }),
        before: before === null ? null : before,
        after: readString(block.after, 'diff after'),
        ...(block.language === undefined ? {} : { language: readString(block.language, 'diff language') }),
      }
    }
    case 'notice': {
      checkKeys(block, NOTICE_KEYS, 'notice block')
      const tone = readString(block.tone, 'notice tone')
      if (tone !== 'neutral' && tone !== 'info' && tone !== 'warning') fail('notice tone', `unknown tone ${JSON.stringify(tone)}`)
      return { kind: 'notice', tone, text: readDisplayString(block.text, 'notice text') }
    }
    default:
      fail('block', `unknown kind ${JSON.stringify(kind)}`)
  }
}

/** Parse one labelled option of a choice-like field. */
function parseOption(input: JsonValue): TaskSurfaceOption {
  const option = readObject(input, 'option')
  checkKeys(option, OPTION_KEYS, 'option')
  return {
    id: readString(option.id, 'option id'),
    label: readDisplayString(option.label, 'option label'),
    ...(option.detail === undefined ? {} : { detail: readDisplayString(option.detail, 'option detail') }),
  }
}

/** Parse the shared options member of a choice-like field, checking uniqueness. */
function parseOptions(input: JsonValue | undefined, what: string): TaskSurfaceOption[] {
  const options = readArray(input, what).map(parseOption)
  if (options.length === 0) fail(what, 'expected at least one option')
  const ids = options.map(option => option.id)
  if (new Set(ids).size !== ids.length) fail(`${what} option ids`, 'duplicate ids')
  return options
}

/** Read an optional string[] member whose values must be unique known option ids. */
function optionalOptionIdList(
  record: Record<string, JsonValue>,
  key: string,
  optionIds: Set<string>,
  exact: boolean,
  optionCount: number,
  what: string,
): string[] | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  const items = readArray(value, `${what} ${key}`).map(item => readString(item, `${what} ${key}`))
  if (new Set(items).size !== items.length) fail(`${what} ${key}`, 'duplicate ids')
  for (const item of items) {
    if (!optionIds.has(item)) fail(`${what} ${key}`, `unknown option id ${JSON.stringify(item)}`)
  }
  if (exact && items.length !== optionCount) fail(`${what} ${key}`, 'expected an exact permutation of the option ids')
  return items
}

/** Parse one input field declaration. */
function parseField(input: JsonValue): TaskSurfaceField {
  const field = readObject(input, 'field')
  const kind = readString(field.kind, 'field kind')
  const id = readString(field.id, 'field id')
  const label = readDisplayString(field.label, 'field label')
  switch (kind) {
    case 'text': {
      checkKeys(field, TEXT_FIELD_KEYS, 'text field')
      const multiline = optionalBoolean(field, 'multiline', 'text field')
      const required = optionalBoolean(field, 'required', 'text field')
      return {
        kind: 'text',
        id,
        label,
        ...(multiline === undefined ? {} : { multiline }),
        ...(required === undefined ? {} : { required }),
        ...(field.initial === undefined ? {} : { initial: readString(field.initial, 'text field initial') }),
      }
    }
    case 'choice': {
      checkKeys(field, SELECT_FIELD_KEYS, 'choice field')
      const options = parseOptions(field.options, 'choice field options')
      const optionIds = new Set(options.map(option => option.id))
      const initial = field.initial === undefined ? undefined : readString(field.initial, 'choice field initial')
      if (initial !== undefined && !optionIds.has(initial)) fail('choice field initial', `unknown option id ${JSON.stringify(initial)}`)
      return {
        kind: 'choice',
        id,
        label,
        options,
        ...(initial === undefined ? {} : { initial }),
      }
    }
    case 'multi-choice': {
      checkKeys(field, SELECT_FIELD_KEYS, 'multi-choice field')
      const options = parseOptions(field.options, 'multi-choice field options')
      const optionIds = new Set(options.map(option => option.id))
      const initial = optionalOptionIdList(field, 'initial', optionIds, false, options.length, 'multi-choice field')
      return {
        kind: 'multi-choice',
        id,
        label,
        options,
        ...(initial === undefined ? {} : { initial }),
      }
    }
    case 'toggle': {
      checkKeys(field, TOGGLE_FIELD_KEYS, 'toggle field')
      const initial = optionalBoolean(field, 'initial', 'toggle field')
      return {
        kind: 'toggle',
        id,
        label,
        ...(initial === undefined ? {} : { initial }),
      }
    }
    case 'order': {
      checkKeys(field, SELECT_FIELD_KEYS, 'order field')
      const options = parseOptions(field.options, 'order field options')
      const optionIds = new Set(options.map(option => option.id))
      const initial = optionalOptionIdList(field, 'initial', optionIds, true, options.length, 'order field')
      return {
        kind: 'order',
        id,
        label,
        options,
        ...(initial === undefined ? {} : { initial }),
      }
    }
    default:
      fail('field', `unknown kind ${JSON.stringify(kind)}`)
  }
}

/** Parse the submit affordance. */
function parseSubmit(input: JsonValue | undefined): TaskSurfaceSubmit {
  const submit = readObject(input, 'submit')
  checkKeys(submit, SUBMIT_KEYS, 'submit')
  return { label: readDisplayString(submit.label, 'submit label') }
}

/**
 * Parse and normalize one surface model with unknown fields rejected and the
 * configured limits enforced.
 * @param input - the candidate model JSON value.
 * @param limits - size and count ceilings; defaults to the package defaults.
 * @returns the normalized model.
 */
export function parseTaskSurfaceModel(input: JsonValue, limits: TaskSurfaceLimits = DEFAULT_TASK_SURFACE_LIMITS): TaskSurfaceModelV1 {
  const model = readObject(input, 'model')
  checkKeys(model, MODEL_KEYS, 'model')
  if (model.version !== 1) fail('model', `unsupported version ${JSON.stringify(model.version)}`)
  const title = readDisplayString(model.title, 'model title')
  const description = optionalDisplayString(model, 'description', 'model')
  const blocks = { total: 0 }
  const sections = readArray(model.sections, 'model sections').map((item) => {
    const section = readObject(item, 'section')
    checkKeys(section, SECTION_KEYS, 'section')
    const sectionTitle = optionalDisplayString(section, 'title', 'section')
    return {
      id: readString(section.id, 'section id'),
      ...(sectionTitle === undefined ? {} : { title: sectionTitle }),
      ...(section.layout === undefined ? {} : { layout: parseLayout(section.layout) }),
      blocks: readArray(section.blocks, 'section blocks').map(block => parseBlock(block, limits, blocks)),
    }
  })
  const sectionIds = sections.map(section => section.id)
  if (new Set(sectionIds).size !== sectionIds.length) fail('model section ids', 'duplicate ids')
  const fields = model.fields === undefined ? undefined : readArray(model.fields, 'model fields').map(parseField)
  const fieldIds = (fields ?? []).map(field => field.id)
  if (new Set(fieldIds).size !== fieldIds.length) fail('model field ids', 'duplicate ids')
  if (fieldIds.length > limits.maxFields) fail('model fields', `more than ${limits.maxFields} fields`)
  const submit = parseSubmit(model.submit)
  const normalized: TaskSurfaceModelV1 = {
    version: 1,
    title,
    ...(description === undefined ? {} : { description }),
    sections,
    ...(fields === undefined ? {} : { fields }),
    submit,
  }
  // The model is assembled from already-validated scalars and objects, so the
  // cast only bridges the missing index signature to JsonValue.
  const bytes = jsonByteLength(normalized as unknown as JsonValue)
  if (bytes > limits.maxModelBytes) fail('model', `serialized size ${bytes} exceeds the ${limits.maxModelBytes}-byte limit`)
  return normalized
}

/**
 * Parse one presentation-meta payload in full. Unknown kinds or unsupported
 * versions are rejected here; the projection fold filters them earlier through
 * `recognizeTaskSurfacePresentationMeta`.
 * @param input - the candidate presentation meta JSON value.
 * @param limits - size and count ceilings applied to the model; defaults to the package defaults.
 * @returns the parsed presentation meta.
 */
export function parseTaskSurfacePresentationMeta(
  input: JsonValue,
  limits: TaskSurfaceLimits = DEFAULT_TASK_SURFACE_LIMITS,
): TaskSurfacePresentationMeta {
  const meta = readObject(input, 'presentation meta')
  checkKeys(meta, META_KEYS, 'presentation meta')
  if (meta.kind !== TASK_SURFACE_PRESENTATION_META_KIND) fail('presentation meta', `unknown kind ${JSON.stringify(meta.kind)}`)
  if (meta.version !== 1) fail('presentation meta', `unsupported version ${JSON.stringify(meta.version)}`)
  return {
    kind: TASK_SURFACE_PRESENTATION_META_KIND,
    version: 1,
    surfaceId: TaskSurfaceId(readString(meta.surfaceId, 'presentation meta surfaceId')),
    model: parseTaskSurfaceModel(readObject(meta.model, 'presentation meta model'), limits),
  }
}

/**
 * Tolerant projection-grade read of the `tool/result` meta: return the parsed
 * presentation meta when the payload carries the task-surface tag and parses
 * clean, `undefined` for anything absent, untagged, or malformed. Malformed
 * tagged payloads never open a surface through this path; the write side and
 * the package invariant reject them on their own paths.
 * @param input - the `tool/result` meta, if any.
 * @returns the recognized presentation meta, or `undefined`.
 */
export function recognizeTaskSurfacePresentationMeta(input: JsonValue | undefined): TaskSurfacePresentationMeta | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined
  if ((input as { kind?: unknown }).kind !== TASK_SURFACE_PRESENTATION_META_KIND) return undefined
  try {
    return parseTaskSurfacePresentationMeta(input)
  } catch {
    // Projection-grade tolerance over the durable log: the strict parse and the
    // package invariant reject this same payload fail-loud on their paths.
    return undefined
  }
}

/**
 * Parse one submission correlation carried by a `taskSurface` message source.
 * @param input - the candidate correlation JSON value.
 * @returns the parsed correlation with branded ids.
 */
export function parseTaskSurfaceCorrelation(input: JsonValue): TaskSurfaceCorrelation {
  const correlation = readObject(input, 'submission correlation')
  checkKeys(correlation, CORRELATION_KEYS, 'submission correlation')
  if (correlation.version !== 1) fail('submission correlation', `unsupported version ${JSON.stringify(correlation.version)}`)
  return {
    version: 1,
    submissionId: TaskSurfaceSubmissionId(readString(correlation.submissionId, 'correlation submissionId')),
    callId: ToolCallId(readString(correlation.callId, 'correlation callId')),
    surfaceId: TaskSurfaceId(readString(correlation.surfaceId, 'correlation surfaceId')),
    values: readObject(correlation.values, 'correlation values'),
  }
}
