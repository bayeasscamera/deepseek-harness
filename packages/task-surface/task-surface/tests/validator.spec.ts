import { describe, expect, it } from 'vitest'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  DEFAULT_TASK_SURFACE_LIMITS,
  formatTaskSurfaceSubmission,
  jsonByteLength,
  parseTaskSurfaceModel,
  validateTaskSurfaceSubmission,
} from '../src/index.ts'

const model = parseTaskSurfaceModel({
  version: 1,
  title: 'Deploy check',
  sections: [{ id: 's', blocks: [{ kind: 'markdown', text: 'Review the plan.' }] }],
  fields: [
    { kind: 'text', id: 'name', label: 'Name' },
    { kind: 'text', id: 'greeting', label: 'Greeting', initial: 'hello' },
    {
      kind: 'choice',
      id: 'env',
      label: 'Environment',
      options: [
        { id: 'staging', label: 'Staging' },
        { id: 'prod', label: 'Prod' },
      ],
      initial: 'staging',
    },
    {
      kind: 'multi-choice',
      id: 'flags',
      label: 'Flags',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
      ],
    },
    { kind: 'toggle', id: 'dry', label: 'Dry run', initial: false },
    {
      kind: 'order',
      id: 'steps',
      label: 'Steps',
      options: [
        { id: 'build', label: 'Build' },
        { id: 'test', label: 'Test' },
      ],
    },
  ],
  submit: { label: 'Submit' },
})

const acceptedValues: Record<string, JsonValue> = {
  name: 'Ann',
  greeting: 'hi',
  env: 'prod',
  flags: ['a', 'c'],
  dry: true,
  steps: ['test', 'build'],
}

describe('validateTaskSurfaceSubmission', () => {
  it('accepts a fully valid submission', () => {
    expect(validateTaskSurfaceSubmission(model, acceptedValues)).toEqual([])
  })

  it('reports absent fields without a declared initial as missing-required in declared order', () => {
    expect(validateTaskSurfaceSubmission(model, {})).toEqual([
      { code: 'missing-required', fieldId: 'name' },
      { code: 'missing-required', fieldId: 'flags' },
      { code: 'missing-required', fieldId: 'steps' },
    ])
  })

  it('maps each field kind mismatch to its issue code', () => {
    expect(validateTaskSurfaceSubmission(model, { ...acceptedValues, name: 42 })).toEqual([{ code: 'invalid-text', fieldId: 'name' }])
    expect(validateTaskSurfaceSubmission(model, { ...acceptedValues, env: 'ghost' })).toEqual([{ code: 'invalid-choice', fieldId: 'env' }])
    expect(validateTaskSurfaceSubmission(model, { ...acceptedValues, flags: 'a' })).toEqual([{ code: 'invalid-multi-choice', fieldId: 'flags' }])
    expect(validateTaskSurfaceSubmission(model, { ...acceptedValues, flags: ['a', 'a'] })).toEqual([{ code: 'invalid-multi-choice', fieldId: 'flags' }])
    expect(validateTaskSurfaceSubmission(model, { ...acceptedValues, flags: ['z'] })).toEqual([{ code: 'invalid-multi-choice', fieldId: 'flags' }])
    expect(validateTaskSurfaceSubmission(model, { ...acceptedValues, dry: 'yes' })).toEqual([{ code: 'invalid-toggle', fieldId: 'dry' }])
    expect(validateTaskSurfaceSubmission(model, { ...acceptedValues, steps: ['build'] })).toEqual([{ code: 'invalid-order', fieldId: 'steps' }])
    expect(validateTaskSurfaceSubmission(model, { ...acceptedValues, steps: ['test', 'test'] })).toEqual([{ code: 'invalid-order', fieldId: 'steps' }])
  })

  it('preserves declared field order across multiple invalid values', () => {
    const values: Record<string, JsonValue> = { name: 42, greeting: 43, env: 'ghost', flags: 'x', dry: 'y', steps: 'z' }
    expect(validateTaskSurfaceSubmission(model, values)).toEqual([
      { code: 'invalid-text', fieldId: 'name' },
      { code: 'invalid-text', fieldId: 'greeting' },
      { code: 'invalid-choice', fieldId: 'env' },
      { code: 'invalid-multi-choice', fieldId: 'flags' },
      { code: 'invalid-toggle', fieldId: 'dry' },
      { code: 'invalid-order', fieldId: 'steps' },
    ])
  })

  it('sorts unknown fields by key after the field issues', () => {
    const values: Record<string, JsonValue> = { ...acceptedValues, zeta: 1, alpha: 2 }
    expect(validateTaskSurfaceSubmission(model, values)).toEqual([
      { code: 'unknown-field', fieldId: 'alpha' },
      { code: 'unknown-field', fieldId: 'zeta' },
    ])
  })

  it('enforces the submission byte budget over the values plus the note', () => {
    expect(jsonByteLength({ name: 'ab' })).toBe(13)
    const values: Record<string, JsonValue> = {
      name: 'ab',
      greeting: 'hi',
      env: 'staging',
      flags: ['a'],
      dry: false,
      steps: ['build', 'test'],
    }
    const limits = { ...DEFAULT_TASK_SURFACE_LIMITS, maxSubmissionBytes: jsonByteLength(values) + 1 }
    expect(validateTaskSurfaceSubmission(model, values, undefined, limits)).toEqual([])
    expect(validateTaskSurfaceSubmission(model, values, 'nn', limits)).toEqual([
      { code: 'too-large', bytes: jsonByteLength(values) + 2, maxBytes: jsonByteLength(values) + 1 },
    ])
  })
})

describe('formatTaskSurfaceSubmission', () => {
  it('renders the title, each present field as label: value, and the trimmed note', () => {
    expect(formatTaskSurfaceSubmission(model, acceptedValues, '  ship it  ')).toBe(
      ['Deploy check', 'Name: Ann', 'Greeting: hi', 'Environment: Prod', 'Flags: A, C', 'Dry run: on', 'Steps: Test → Build', '', 'ship it'].join('\n'),
    )
  })

  it('falls back to declared initials and omits fields with neither value nor initial', () => {
    expect(formatTaskSurfaceSubmission(model, {})).toBe(
      ['Deploy check', 'Greeting: hello', 'Environment: Staging', 'Dry run: off'].join('\n'),
    )
  })

  it('omits a whitespace-only note', () => {
    expect(formatTaskSurfaceSubmission(model, {}, '   ')).toBe(
      ['Deploy check', 'Greeting: hello', 'Environment: Staging', 'Dry run: off'].join('\n'),
    )
  })

  it('renders foreign values without throwing', () => {
    const values: Record<string, JsonValue> = { name: 42, env: 'ghost', flags: 'weird', dry: 'yes', steps: [1, 'test'] }
    expect(formatTaskSurfaceSubmission(model, values, 'note')).toBe(
      ['Deploy check', 'Name: 42', 'Greeting: hello', 'Environment: ghost', 'Flags: "weird"', 'Dry run: on', 'Steps: 1 → Test', '', 'note'].join('\n'),
    )
  })
})
