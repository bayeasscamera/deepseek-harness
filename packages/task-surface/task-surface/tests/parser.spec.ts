import { describe, expect, it } from 'vitest'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  DEFAULT_TASK_SURFACE_LIMITS,
  parseTaskSurfaceCorrelation,
  parseTaskSurfaceModel,
  parseTaskSurfacePresentationMeta,
  recognizeTaskSurfacePresentationMeta,
  TASK_SURFACE_PRESENTATION_META_KIND,
  TaskSurfaceId,
  TaskSurfaceSubmissionId,
} from '../src/index.ts'
import { ToolCallId } from '@deepseek-ai/dsh-llm'

/** Assert that one strict parse throws the exact positional message. */
function expectReject(parse: () => unknown, message: string | RegExp): void {
  expect(parse).toThrow(message)
}

const minimalModel: Record<string, JsonValue> = {
  version: 1,
  title: 'Deploy',
  sections: [],
  submit: { label: 'Go' },
}

const fullModel: Record<string, JsonValue> = {
  version: 1,
  title: 'Deploy',
  description: 'Full coverage fixture',
  sections: [
    {
      id: 'overview',
      title: 'Overview',
      layout: { kind: 'stack' },
      blocks: [
        { kind: 'markdown', text: '# Deploy' },
        {
          kind: 'metrics',
          items: [
            { label: 'Latency', value: '120ms' },
            { label: 'Errors', value: '0', detail: 'last hour' },
          ],
        },
        {
          kind: 'table',
          columns: [
            { id: 'env', label: 'Env' },
            { id: 'url', label: 'URL' },
          ],
          rows: [
            { env: 'staging', url: 'https://staging.example' },
            { env: 'prod', url: 'https://prod.example' },
          ],
        },
        { kind: 'diff', path: 'config.yaml', before: 'a: 1', after: 'a: 2', language: 'yaml' },
        { kind: 'notice', tone: 'warning', text: 'Prod deploy is irreversible.' },
      ],
    },
    {
      id: 'aside',
      blocks: [
        { kind: 'markdown', text: 'Notes' },
        { kind: 'diff', before: null, after: 'b: 2' },
      ],
    },
  ],
  fields: [
    { kind: 'text', id: 'name', label: 'Name', multiline: true, required: true, initial: 'Ada' },
    {
      kind: 'choice',
      id: 'env',
      label: 'Environment',
      options: [{ id: 'staging', label: 'Staging' }, { id: 'prod', label: 'Prod', detail: 'live traffic' }],
      initial: 'staging',
    },
    {
      kind: 'multi-choice',
      id: 'flags',
      label: 'Flags',
      options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }],
      initial: ['a', 'c'],
    },
    { kind: 'toggle', id: 'dry', label: 'Dry run', initial: false },
    {
      kind: 'order',
      id: 'steps',
      label: 'Steps',
      options: [{ id: 'build', label: 'Build' }, { id: 'test', label: 'Test' }],
      initial: ['build', 'test'],
    },
  ],
  submit: { label: 'Go' },
}

describe('parseTaskSurfaceModel', () => {
  it('parses the full model with every block and field kind', () => {
    const model = parseTaskSurfaceModel(fullModel)
    expect(model).toEqual(JSON.parse(JSON.stringify(fullModel)))
    expect('title' in model.sections[1]!).toBe(false)
    expect('layout' in model.sections[1]!).toBe(false)
    expect(model.fields![3]!.initial).toBe(false)
  })

  it('omits absent optional members and normalizes key order', () => {
    const a = parseTaskSurfaceModel(minimalModel)
    const b = parseTaskSurfaceModel({ submit: { label: 'Go' }, sections: [], title: 'Deploy', version: 1 })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect('description' in a).toBe(false)
    expect('fields' in a).toBe(false)
    expect(a.sections).toEqual([])
  })

  it('accepts grid layouts with 2 or 3 columns', () => {
    for (const columns of [2, 3]) {
      expect(() => parseTaskSurfaceModel({
        ...minimalModel,
        sections: [{ id: 's', layout: { kind: 'grid', columns }, blocks: [] }],
      })).not.toThrow()
    }
  })

  it('rejects non-object models', () => {
    expectReject(() => parseTaskSurfaceModel(42), 'invalid task-surface model: expected a JSON object')
    expectReject(() => parseTaskSurfaceModel(null), 'invalid task-surface model: expected a JSON object')
    expectReject(() => parseTaskSurfaceModel([]), 'invalid task-surface model: expected a JSON object')
  })

  it('rejects unknown model keys and unsupported versions', () => {
    expectReject(() => parseTaskSurfaceModel({ ...minimalModel, extra: 1 }), 'invalid task-surface model: unknown field "extra"')
    expectReject(() => parseTaskSurfaceModel({ ...minimalModel, version: 2 }), 'invalid task-surface model: unsupported version 2')
  })

  it('rejects empty or whitespace-only titles and descriptions', () => {
    expectReject(() => parseTaskSurfaceModel({ ...minimalModel, title: '' }), 'invalid task-surface model title: expected a non-empty string')
    expectReject(() => parseTaskSurfaceModel({ ...minimalModel, title: '   ' }), 'invalid task-surface model title: expected visible text, got whitespace only')
    expectReject(() => parseTaskSurfaceModel({ ...minimalModel, description: '  ' }), 'invalid task-surface model description: expected visible text, got whitespace only')
  })

  it('rejects malformed sections', () => {
    expectReject(() => parseTaskSurfaceModel({ ...minimalModel, sections: 'x' }), 'invalid task-surface model sections: expected a JSON array')
    expectReject(() => parseTaskSurfaceModel({ ...minimalModel, sections: [42] }), 'invalid task-surface section: expected a JSON object')
    expectReject(() => parseTaskSurfaceModel({
      ...minimalModel,
      sections: [{ id: 's', blocks: [], extra: 1 }],
    }), 'invalid task-surface section: unknown field "extra"')
    expectReject(() => parseTaskSurfaceModel({
      ...minimalModel,
      sections: [{ id: '', blocks: [] }],
    }), 'invalid task-surface section id: expected a non-empty string')
    expectReject(() => parseTaskSurfaceModel({
      ...minimalModel,
      sections: [{ id: 's', title: '  ', blocks: [] }],
    }), 'invalid task-surface section title: expected visible text, got whitespace only')
    expectReject(() => parseTaskSurfaceModel({
      ...minimalModel,
      sections: [{ id: 's1', blocks: [] }, { id: 's1', blocks: [] }],
    }), 'invalid task-surface model section ids: duplicate ids')
  })

  it('rejects malformed layouts', () => {
    const section = (layout: JsonValue): Record<string, JsonValue> => ({
      ...minimalModel,
      sections: [{ id: 's', blocks: [], layout }],
    })
    expectReject(() => parseTaskSurfaceModel(section(42)), 'invalid task-surface layout: expected a JSON object')
    expectReject(() => parseTaskSurfaceModel(section({ kind: 'stack', gap: 1 })), 'invalid task-surface layout: unknown field "gap"')
    expectReject(() => parseTaskSurfaceModel(section({ kind: 'rows' })), 'invalid task-surface layout: unknown kind "rows"')
    expectReject(() => parseTaskSurfaceModel(section({ kind: 'grid', columns: 4 })), 'invalid task-surface grid layout columns: expected 2 or 3')
  })

  it('rejects malformed blocks', () => {
    const blocks = (...items: JsonValue[]): Record<string, JsonValue> => ({
      ...minimalModel,
      sections: [{ id: 's', blocks: items }],
    })
    expectReject(() => parseTaskSurfaceModel({ ...minimalModel, sections: [{ id: 's', blocks: 'x' }] }), 'invalid task-surface section blocks: expected a JSON array')
    expectReject(() => parseTaskSurfaceModel(blocks(42)), 'invalid task-surface block: expected a JSON object')
    expectReject(() => parseTaskSurfaceModel(blocks({ kind: 42 })), 'invalid task-surface block kind: expected a non-empty string')
    expectReject(() => parseTaskSurfaceModel(blocks({ kind: 'chart' })), 'invalid task-surface block: unknown kind "chart"')
  })

  it('rejects malformed markdown blocks', () => {
    const blocks = (...items: JsonValue[]): Record<string, JsonValue> => ({
      ...minimalModel,
      sections: [{ id: 's', blocks: items }],
    })
    expectReject(() => parseTaskSurfaceModel(blocks({ kind: 'markdown', text: 'x', extra: 1 })), 'invalid task-surface markdown block: unknown field "extra"')
    expectReject(() => parseTaskSurfaceModel(blocks({ kind: 'markdown', text: '' })), 'invalid task-surface markdown text: expected a non-empty string')
  })

  it('rejects malformed metrics blocks', () => {
    const blocks = (...items: JsonValue[]): Record<string, JsonValue> => ({
      ...minimalModel,
      sections: [{ id: 's', blocks: items }],
    })
    expectReject(() => parseTaskSurfaceModel(blocks({ kind: 'metrics', items: 'x' })), 'invalid task-surface metrics items: expected a JSON array')
    expectReject(() => parseTaskSurfaceModel(blocks({ kind: 'metrics', items: [] })), 'invalid task-surface metrics items: expected at least one metric')
    expectReject(() => parseTaskSurfaceModel(blocks({ kind: 'metrics', items: [42] })), 'invalid task-surface metric: expected a JSON object')
    expectReject(() => parseTaskSurfaceModel(blocks({ kind: 'metrics', items: [{ label: 'L', value: '1', extra: 1 }] })), 'invalid task-surface metric: unknown field "extra"')
    expectReject(() => parseTaskSurfaceModel(blocks({ kind: 'metrics', items: [{ label: '', value: '1' }] })), 'invalid task-surface metric label: expected a non-empty string')
    expectReject(() => parseTaskSurfaceModel(blocks({ kind: 'metrics', items: [{ label: 'L', value: '1', detail: '  ' }] })), 'invalid task-surface metric detail: expected visible text, got whitespace only')
  })

  it('rejects malformed table blocks', () => {
    const blocks = (...items: JsonValue[]): Record<string, JsonValue> => ({
      ...minimalModel,
      sections: [{ id: 's', blocks: items }],
    })
    expectReject(() => parseTaskSurfaceModel(blocks({ kind: 'table', columns: 'x', rows: [] })), 'invalid task-surface table columns: expected a JSON array')
    expectReject(() => parseTaskSurfaceModel(blocks({ kind: 'table', columns: [], rows: [] })), 'invalid task-surface table columns: expected at least one column')
    expectReject(() => parseTaskSurfaceModel(blocks({ kind: 'table', columns: [42], rows: [] })), 'invalid task-surface table column: expected a JSON object')
    expectReject(() => parseTaskSurfaceModel(blocks({ kind: 'table', columns: [{ id: 'c', label: 'C', extra: 1 }], rows: [] })), 'invalid task-surface table column: unknown field "extra"')
    expectReject(() => parseTaskSurfaceModel(blocks({ kind: 'table', columns: [{ id: '', label: 'C' }], rows: [] })), 'invalid task-surface table column id: expected a non-empty string')
    expectReject(() => parseTaskSurfaceModel(blocks({
      kind: 'table',
      columns: [{ id: 'c1', label: 'C' }, { id: 'c1', label: 'C' }],
      rows: [],
    })), 'invalid task-surface table column id: duplicate id "c1"')
    expectReject(() => parseTaskSurfaceModel(blocks({ kind: 'table', columns: [{ id: 'c', label: ' ' }], rows: [] })), 'invalid task-surface table column label: expected visible text, got whitespace only')
    expectReject(() => parseTaskSurfaceModel(blocks({ kind: 'table', columns: [{ id: 'c', label: 'C' }], rows: 'x' })), 'invalid task-surface table rows: expected a JSON array')
    expectReject(() => parseTaskSurfaceModel(blocks({ kind: 'table', columns: [{ id: 'c', label: 'C' }], rows: [42] })), 'invalid task-surface table row: expected a JSON object')
    expectReject(() => parseTaskSurfaceModel(blocks({ kind: 'table', columns: [{ id: 'c', label: 'C' }], rows: [{ other: 'x' }] })), 'invalid task-surface table row: row keys must be exactly the declared column ids')
    expectReject(() => parseTaskSurfaceModel(blocks({ kind: 'table', columns: [{ id: 'c', label: 'C' }], rows: [{ c: { nested: true } }] })), 'invalid task-surface table row: cell "c" must be a scalar (string, number, boolean, or null)')
    expectReject(() => parseTaskSurfaceModel(blocks({ kind: 'table', columns: [{ id: 'c', label: 'C' }], rows: [{ c: [1, 2] }] })), 'invalid task-surface table row: cell "c" must be a scalar (string, number, boolean, or null)')
  })

  it('enforces the table row budget', () => {
    const limits = { ...DEFAULT_TASK_SURFACE_LIMITS, maxTableRows: 1 }
    expectReject(() => parseTaskSurfaceModel({
      ...minimalModel,
      sections: [{
        id: 's',
        blocks: [{
          kind: 'table',
          columns: [{ id: 'c', label: 'C' }],
          rows: [{ c: '1' }, { c: '2' }],
        }],
      }],
    }, limits), 'invalid task-surface table rows: more than 1 rows')
  })

  it('rejects malformed diff blocks', () => {
    const blocks = (...items: JsonValue[]): Record<string, JsonValue> => ({
      ...minimalModel,
      sections: [{ id: 's', blocks: items }],
    })
    expectReject(() => parseTaskSurfaceModel(blocks({ kind: 'diff', before: 42, after: 'a' })), 'invalid task-surface diff before: expected a string or null')
    expectReject(() => parseTaskSurfaceModel(blocks({ kind: 'diff', path: '', before: null, after: 'a' })), 'invalid task-surface diff path: expected a non-empty string')
    expectReject(() => parseTaskSurfaceModel(blocks({ kind: 'diff', before: null, after: '' })), 'invalid task-surface diff after: expected a non-empty string')
    expectReject(() => parseTaskSurfaceModel(blocks({ kind: 'diff', before: null, after: 'a', extra: 1 })), 'invalid task-surface diff block: unknown field "extra"')
  })

  it('rejects malformed notice blocks', () => {
    const blocks = (...items: JsonValue[]): Record<string, JsonValue> => ({
      ...minimalModel,
      sections: [{ id: 's', blocks: items }],
    })
    expectReject(() => parseTaskSurfaceModel(blocks({ kind: 'notice', tone: 'loud', text: 'x' })), 'invalid task-surface notice tone: unknown tone "loud"')
    expectReject(() => parseTaskSurfaceModel(blocks({ kind: 'notice', tone: 'info', text: '' })), 'invalid task-surface notice text: expected a non-empty string')
    expectReject(() => parseTaskSurfaceModel(blocks({ kind: 'notice', tone: 'neutral', text: 'x', extra: 1 })), 'invalid task-surface notice block: unknown field "extra"')
  })

  it('enforces the block budget across sections', () => {
    const limits = { ...DEFAULT_TASK_SURFACE_LIMITS, maxBlocks: 1 }
    expectReject(() => parseTaskSurfaceModel({
      ...minimalModel,
      sections: [{ id: 's', blocks: [{ kind: 'markdown', text: 'a' }, { kind: 'markdown', text: 'b' }] }],
    }, limits), 'invalid task-surface model: more than 1 blocks')
  })

  it('rejects malformed fields', () => {
    expectReject(() => parseTaskSurfaceModel({ ...minimalModel, fields: 'x' }), 'invalid task-surface model fields: expected a JSON array')
    expectReject(() => parseTaskSurfaceModel({ ...minimalModel, fields: [42] }), 'invalid task-surface field: expected a JSON object')
    expectReject(() => parseTaskSurfaceModel({ ...minimalModel, fields: [{ kind: 42, id: 'f', label: 'F' }] }), 'invalid task-surface field kind: expected a non-empty string')
    expectReject(() => parseTaskSurfaceModel({ ...minimalModel, fields: [{ kind: 'text', id: '', label: 'F' }] }), 'invalid task-surface field id: expected a non-empty string')
    expectReject(() => parseTaskSurfaceModel({ ...minimalModel, fields: [{ kind: 'text', id: 'f', label: '  ' }] }), 'invalid task-surface field label: expected visible text, got whitespace only')
    expectReject(() => parseTaskSurfaceModel({ ...minimalModel, fields: [{ kind: 'rating', id: 'f', label: 'F' }] }), 'invalid task-surface field: unknown kind "rating"')
    expectReject(() => parseTaskSurfaceModel({
      ...minimalModel,
      fields: [{ kind: 'text', id: 'a', label: 'A' }, { kind: 'text', id: 'a', label: 'B' }],
    }), 'invalid task-surface model field ids: duplicate ids')
  })

  it('rejects malformed text fields', () => {
    const fields = (field: JsonValue): Record<string, JsonValue> => ({ ...minimalModel, fields: [field] })
    expectReject(() => parseTaskSurfaceModel(fields({ kind: 'text', id: 'f', label: 'F', extra: 1 })), 'invalid task-surface text field: unknown field "extra"')
    expectReject(() => parseTaskSurfaceModel(fields({ kind: 'text', id: 'f', label: 'F', multiline: 'yes' })), 'invalid task-surface text field multiline: expected a boolean')
    expectReject(() => parseTaskSurfaceModel(fields({ kind: 'text', id: 'f', label: 'F', required: 'yes' })), 'invalid task-surface text field required: expected a boolean')
    expectReject(() => parseTaskSurfaceModel(fields({ kind: 'text', id: 'f', label: 'F', initial: '' })), 'invalid task-surface text field initial: expected a non-empty string')
  })

  it('rejects malformed options', () => {
    const fields = (field: JsonValue): Record<string, JsonValue> => ({ ...minimalModel, fields: [field] })
    expectReject(() => parseTaskSurfaceModel(fields({ kind: 'choice', id: 'f', label: 'F', options: 'x' })), 'invalid task-surface choice field options: expected a JSON array')
    expectReject(() => parseTaskSurfaceModel(fields({ kind: 'choice', id: 'f', label: 'F', options: [] })), 'invalid task-surface choice field options: expected at least one option')
    expectReject(() => parseTaskSurfaceModel(fields({ kind: 'choice', id: 'f', label: 'F', options: [42] })), 'invalid task-surface option: expected a JSON object')
    expectReject(() => parseTaskSurfaceModel(fields({ kind: 'choice', id: 'f', label: 'F', options: [{ id: 'a', label: 'A', extra: 1 }] })), 'invalid task-surface option: unknown field "extra"')
    expectReject(() => parseTaskSurfaceModel(fields({ kind: 'choice', id: 'f', label: 'F', options: [{ id: '', label: 'A' }] })), 'invalid task-surface option id: expected a non-empty string')
    expectReject(() => parseTaskSurfaceModel(fields({ kind: 'choice', id: 'f', label: 'F', options: [{ id: 'a', label: ' ' }] })), 'invalid task-surface option label: expected visible text, got whitespace only')
    expectReject(() => parseTaskSurfaceModel(fields({ kind: 'choice', id: 'f', label: 'F', options: [{ id: 'a', label: 'A', detail: '  ' }] })), 'invalid task-surface option detail: expected visible text, got whitespace only')
    expectReject(() => parseTaskSurfaceModel(fields({
      kind: 'choice',
      id: 'f',
      label: 'F',
      options: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }],
    })), 'invalid task-surface choice field options option ids: duplicate ids')
  })

  it('rejects unknown choice initials', () => {
    expectReject(() => parseTaskSurfaceModel({
      ...minimalModel,
      fields: [{ kind: 'choice', id: 'f', label: 'F', options: [{ id: 'a', label: 'A' }], initial: 'ghost' }],
    }), 'invalid task-surface choice field initial: unknown option id "ghost"')
  })

  it('rejects malformed multi-choice initials', () => {
    const field = (initial: JsonValue): Record<string, JsonValue> => ({
      ...minimalModel,
      fields: [{
        kind: 'multi-choice',
        id: 'f',
        label: 'F',
        options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
        initial,
      }],
    })
    expectReject(() => parseTaskSurfaceModel(field('a')), 'invalid task-surface multi-choice field initial: expected a JSON array')
    expectReject(() => parseTaskSurfaceModel(field([42])), 'invalid task-surface multi-choice field initial: expected a non-empty string')
    expectReject(() => parseTaskSurfaceModel(field(['a', 'a'])), 'invalid task-surface multi-choice field initial: duplicate ids')
    expectReject(() => parseTaskSurfaceModel(field(['a', 'z'])), 'invalid task-surface multi-choice field initial: unknown option id "z"')
  })

  it('rejects non-boolean toggle initials', () => {
    expectReject(() => parseTaskSurfaceModel({
      ...minimalModel,
      fields: [{ kind: 'toggle', id: 'f', label: 'F', initial: 'yes' }],
    }), 'invalid task-surface toggle field initial: expected a boolean')
  })

  it('rejects text-field-only keys on toggles', () => {
    expectReject(() => parseTaskSurfaceModel({
      ...minimalModel,
      fields: [{ kind: 'toggle', id: 'f', label: 'F', required: true }],
    }), 'invalid task-surface toggle field: unknown field "required"')
    expectReject(() => parseTaskSurfaceModel({
      ...minimalModel,
      fields: [{ kind: 'toggle', id: 'f', label: 'F', multiline: true }],
    }), 'invalid task-surface toggle field: unknown field "multiline"')
  })

  it('rejects malformed order initials', () => {
    const field = (initial: JsonValue): Record<string, JsonValue> => ({
      ...minimalModel,
      fields: [{
        kind: 'order',
        id: 'f',
        label: 'F',
        options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
        initial,
      }],
    })
    expectReject(() => parseTaskSurfaceModel(field(['a', 'a'])), 'invalid task-surface order field initial: duplicate ids')
    expectReject(() => parseTaskSurfaceModel(field(['a', 'z'])), 'invalid task-surface order field initial: unknown option id "z"')
    expectReject(() => parseTaskSurfaceModel(field(['a'])), 'invalid task-surface order field initial: expected an exact permutation of the option ids')
  })

  it('enforces the field budget', () => {
    const limits = { ...DEFAULT_TASK_SURFACE_LIMITS, maxFields: 1 }
    expectReject(() => parseTaskSurfaceModel({
      ...minimalModel,
      fields: [{ kind: 'text', id: 'a', label: 'A' }, { kind: 'text', id: 'b', label: 'B' }],
    }, limits), 'invalid task-surface model fields: more than 1 fields')
  })

  it('rejects malformed submit declarations', () => {
    expectReject(() => parseTaskSurfaceModel({ version: 1, title: 'T', sections: [] }), 'invalid task-surface submit: expected a JSON object')
    expectReject(() => parseTaskSurfaceModel({ ...minimalModel, submit: 42 }), 'invalid task-surface submit: expected a JSON object')
    expectReject(() => parseTaskSurfaceModel({ ...minimalModel, submit: { label: 'Go', extra: 1 } }), 'invalid task-surface submit: unknown field "extra"')
    expectReject(() => parseTaskSurfaceModel({ ...minimalModel, submit: { label: '' } }), 'invalid task-surface submit label: expected a non-empty string')
    expectReject(() => parseTaskSurfaceModel({ ...minimalModel, submit: { label: '  ' } }), 'invalid task-surface submit label: expected visible text, got whitespace only')
  })

  it('enforces the serialized model byte budget', () => {
    const limits = { ...DEFAULT_TASK_SURFACE_LIMITS, maxModelBytes: 16 }
    expectReject(() => parseTaskSurfaceModel(minimalModel, limits), /serialized size \d+ exceeds the 16-byte limit/)
  })
})

describe('parseTaskSurfacePresentationMeta', () => {
  it('parses a tagged meta carrying a model', () => {
    const meta = { kind: TASK_SURFACE_PRESENTATION_META_KIND, version: 1, surfaceId: 's1', model: minimalModel }
    expect(parseTaskSurfacePresentationMeta(meta)).toEqual(meta)
  })

  it('rejects malformed metas', () => {
    const meta = (patch: Record<string, JsonValue>): Record<string, JsonValue> => ({
      kind: TASK_SURFACE_PRESENTATION_META_KIND,
      version: 1,
      surfaceId: 's1',
      model: minimalModel,
      ...patch,
    })
    expectReject(() => parseTaskSurfacePresentationMeta(42), 'invalid task-surface presentation meta: expected a JSON object')
    expectReject(() => parseTaskSurfacePresentationMeta([]), 'invalid task-surface presentation meta: expected a JSON object')
    expectReject(() => parseTaskSurfacePresentationMeta(meta({ extra: 1 })), 'invalid task-surface presentation meta: unknown field "extra"')
    expectReject(() => parseTaskSurfacePresentationMeta(meta({ kind: 'dsh/other' })), 'invalid task-surface presentation meta: unknown kind "dsh/other"')
    expectReject(() => parseTaskSurfacePresentationMeta(meta({ version: 2 })), 'invalid task-surface presentation meta: unsupported version 2')
    expectReject(() => parseTaskSurfacePresentationMeta(meta({ surfaceId: '' })), 'invalid task-surface presentation meta surfaceId: expected a non-empty string')
    expectReject(() => parseTaskSurfacePresentationMeta(meta({ model: [] })), 'invalid task-surface presentation meta model: expected a JSON object')
  })
})

describe('recognizeTaskSurfacePresentationMeta', () => {
  it('returns undefined for anything absent, untagged, or malformed', () => {
    expect(recognizeTaskSurfacePresentationMeta(undefined)).toBeUndefined()
    expect(recognizeTaskSurfacePresentationMeta(42)).toBeUndefined()
    expect(recognizeTaskSurfacePresentationMeta('dsh/task-surface')).toBeUndefined()
    expect(recognizeTaskSurfacePresentationMeta(null)).toBeUndefined()
    expect(recognizeTaskSurfacePresentationMeta([])).toBeUndefined()
    expect(recognizeTaskSurfacePresentationMeta({})).toBeUndefined()
    expect(recognizeTaskSurfacePresentationMeta({ kind: 'dsh/other', version: 1 })).toBeUndefined()
    expect(recognizeTaskSurfacePresentationMeta({ kind: TASK_SURFACE_PRESENTATION_META_KIND, version: 1 })).toBeUndefined()
  })

  it('returns the parsed meta for a tagged valid payload', () => {
    const meta = { kind: TASK_SURFACE_PRESENTATION_META_KIND, version: 1, surfaceId: 's1', model: minimalModel }
    expect(recognizeTaskSurfacePresentationMeta(meta)).toEqual(parseTaskSurfacePresentationMeta(meta))
  })
})

describe('parseTaskSurfaceCorrelation', () => {
  it('parses a correlation with branded ids', () => {
    const correlation = { version: 1, submissionId: 'sub-1', callId: 'call-1', surfaceId: 's1', values: { name: 'Ann' } }
    expect(parseTaskSurfaceCorrelation(correlation)).toEqual({
      version: 1,
      submissionId: TaskSurfaceSubmissionId('sub-1'),
      callId: ToolCallId('call-1'),
      surfaceId: TaskSurfaceId('s1'),
      values: { name: 'Ann' },
    })
  })

  it('rejects malformed correlations', () => {
    const correlation = (patch: Record<string, JsonValue>): Record<string, JsonValue> => ({
      version: 1,
      submissionId: 'sub-1',
      callId: 'call-1',
      surfaceId: 's1',
      values: {},
      ...patch,
    })
    expectReject(() => parseTaskSurfaceCorrelation(42), 'invalid task-surface submission correlation: expected a JSON object')
    expectReject(() => parseTaskSurfaceCorrelation(correlation({ extra: 1 })), 'invalid task-surface submission correlation: unknown field "extra"')
    expectReject(() => parseTaskSurfaceCorrelation(correlation({ version: 2 })), 'invalid task-surface submission correlation: unsupported version 2')
    expectReject(() => parseTaskSurfaceCorrelation(correlation({ submissionId: '' })), 'invalid task-surface correlation submissionId: expected a non-empty string')
    expectReject(() => parseTaskSurfaceCorrelation(correlation({ callId: '' })), 'invalid task-surface correlation callId: expected a non-empty string')
    expectReject(() => parseTaskSurfaceCorrelation(correlation({ surfaceId: '' })), 'invalid task-surface correlation surfaceId: expected a non-empty string')
    expectReject(() => parseTaskSurfaceCorrelation(correlation({ values: [] })), 'invalid task-surface correlation values: expected a JSON object')
    expectReject(() => parseTaskSurfaceCorrelation({
      version: 1,
      submissionId: 'sub-1',
      callId: 'call-1',
      surfaceId: 's1',
    }), 'invalid task-surface correlation values: expected a JSON object')
  })
})
