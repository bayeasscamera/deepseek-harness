// @vitest-environment jsdom
/**
 * The face's contract with the store: a load in flight is visible, its outcome
 * lands as a published URL or a conversion, windows are walked until end of
 * file, a load outlived by its tab writes nothing and its URL is revoked, a
 * reload starts over and retires the reads still out, and the file's own format
 * bounds what is read at all. The read runs under the session the file names,
 * not the one the face was injected for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceFileBytes } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { previewFace } from '../src/client/face.ts'
import type { ReadWorkspaceFileBytes } from '../src/client/rpc.ts'
import { createPreviewStore } from '../src/client/store.ts'
import { FILE, PATH, SESSION, TINY_LIMIT, failed, harness, page, pageOfBytes } from './fixtures.client.ts'
import type { Target } from './fixtures.client.ts'
import { deck, drawingParagraph, wordDocument, workbook } from './ooxml-fixtures.client.ts'

const TAB_1 = 'tab-1' as TabId
const target = (path: string): Target => ({ address: `dsh-resource://file/session/s-1/${path}`, path, title: path })

/** One read awaiting the spec's answer. */
interface PendingRead {
  readonly offset: number
  resolve(result: RemoteResult<WorkspaceFileBytes>): void
}

const created: string[] = []
const revoked: string[] = []
const published: Blob[] = []

beforeEach(() => {
  created.length = 0
  revoked.length = 0
  published.length = 0
  // jsdom has no object URLs; the specs record what the face publishes and revokes.
  if (typeof URL.createObjectURL !== 'function') {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: () => '' })
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: () => {} })
  }
  vi.spyOn(URL, 'createObjectURL').mockImplementation((obj: Blob | MediaSource) => {
    const url = `blob:mock-${created.length}`
    created.push(url)
    if (obj instanceof Blob) published.push(obj)
    return url
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => { revoked.push(url) })
})

afterEach(() => { vi.restoreAllMocks() })

function bench(limit = 64 * 1024) {
  const instance = createPreviewStore().create()
  const pending: PendingRead[] = []
  const read = vi.fn<ReadWorkspaceFileBytes>((_session, _path, offset) =>
    new Promise((resolve) => { pending.push({ offset, resolve }) }))
  // The store's own `forget`, counted: the record's end must forget a tab exactly once.
  const forget = vi.fn(instance.actions.forget)
  // Injected for another session on purpose: the address's session must win.
  const face = previewFace(read, limit)('other-session' as SessionId, { ...instance.actions, forget })
  /** Settle the oldest outstanding read, or the oldest one for `offset`. */
  const settle = (result: RemoteResult<WorkspaceFileBytes>, offset?: number): void => {
    const at = offset === undefined ? 0 : pending.findIndex(call => call.offset === offset)
    const [call] = pending.splice(at, 1)
    if (call === undefined) throw new Error('no outstanding read to settle')
    call.resolve(result)
  }
  return {
    instance, read, face, forget, settle,
    outstanding: () => pending.map(call => call.offset),
    tab: () => instance.getSnapshot().byTab[TAB_1],
  }
}

const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0) })

describe('previewFace', () => {
  it('marks the load in flight, then publishes the bytes under a Blob of the format\'s type', async () => {
    const { read, face, settle, tab } = bench()
    const controller = new AbortController()
    face.load(TAB_1, FILE, controller.signal)
    expect(read).toHaveBeenCalledWith(SESSION, PATH, 0, controller.signal)
    expect(tab()).toMatchObject({ loading: true, format: { renderer: 'image', conversion: 'blob', mediaType: 'image/png' } })
    settle(page(0, btoa('hello'), true))
    await flush()
    expect(tab()).toMatchObject({ loading: false, failure: undefined, content: { kind: 'url', url: 'blob:mock-0' }, bytes: 5 })
    const blob = published[0]
    expect(blob).toBeInstanceOf(Blob)
    expect(blob?.type).toBe('image/png')
    expect(blob?.size).toBe(5)
    expect(created).toEqual(['blob:mock-0'])
  })

  it('walks windows until end of file, asking for the position past the bytes held', async () => {
    const { read, face, settle, outstanding, tab } = bench()
    face.load(TAB_1, FILE, new AbortController().signal)
    settle(page(0, btoa('AAAA'), false))
    await flush()
    expect(outstanding()).toEqual([4])
    settle(page(4, btoa('BB'), true))
    await flush()
    expect(read).toHaveBeenCalledTimes(2)
    expect(tab()?.bytes).toBe(6)
  })

  it('records a failed window', async () => {
    const { face, settle, tab } = bench()
    face.load(TAB_1, FILE, new AbortController().signal)
    settle(failed('workspace-file/outside-workspace', { path: PATH }))
    await flush()
    expect(tab()).toMatchObject({ loading: false, failure: { code: 'workspace-file/outside-workspace' }, content: undefined })
    expect(created).toEqual([])
  })

  it('refuses a file this viewer does not render without calling the Host', async () => {
    const { read, face, tab } = bench()
    const txt = target('work/notes.txt')
    face.load(TAB_1, { sessionId: SESSION, path: txt.path }, new AbortController().signal)
    await flush()
    expect(read).not.toHaveBeenCalled()
    expect(tab()?.failure?.code).toBe('file-preview/unsupported')
    expect(created).toEqual([])
  })

  it('refuses a file past the preview total', async () => {
    const { face, settle, tab } = bench(TINY_LIMIT)
    face.load(TAB_1, FILE, new AbortController().signal)
    settle(page(0, btoa('x'.repeat(40)), false))
    await flush()
    expect(tab()?.failure).toMatchObject({ code: 'file-preview/too-large', details: { path: PATH, limit: TINY_LIMIT } })
    expect(created).toEqual([])
  })

  it('refuses a window that makes no progress', async () => {
    const { face, settle, tab } = bench()
    face.load(TAB_1, FILE, new AbortController().signal)
    settle(page(0, '', false))
    await flush()
    expect(tab()?.failure?.code).toBe('file-preview/unreadable')
  })

  it('converts a delimited file into rows instead of publishing a URL', async () => {
    const { face, settle, tab } = bench()
    const csv = target('work/data.csv')
    face.load(TAB_1, { sessionId: SESSION, path: csv.path }, new AbortController().signal)
    settle(page(0, btoa('a,b\n1,2\n'), true))
    await flush()
    expect(tab()?.content).toEqual({
      kind: 'table',
      sheets: [{ name: 'data.csv', rows: [['a', 'b'], ['1', '2']], truncated: false }],
    })
    expect(created).toEqual([])
  })

  it('converts a Word document and a deck into their own content kinds', async () => {
    const { face, settle, tab } = bench()
    const docx = target('work/letter.docx')
    face.load(TAB_1, { sessionId: SESSION, path: docx.path }, new AbortController().signal)
    settle(pageOfBytes(0, wordDocument('<w:p><w:r><w:t>hi</w:t></w:r></w:p>')))
    await flush()
    expect(tab()?.content).toEqual({ kind: 'document', html: '<p>hi</p>' })

    const pptx = target('work/deck.pptx')
    face.load(TAB_1, { sessionId: SESSION, path: pptx.path }, new AbortController().signal)
    settle(pageOfBytes(0, deck({ 1: drawingParagraph('Title') })))
    await flush()
    expect(tab()?.content).toEqual({ kind: 'slides', slides: [['Title']] })
  })

  it('refuses bytes that are not the container the extension claims', async () => {
    const { face, settle, tab } = bench()
    const xlsx = target('work/book.xlsx')
    face.load(TAB_1, { sessionId: SESSION, path: xlsx.path }, new AbortController().signal)
    settle(page(0, btoa('not a zip'), true))
    await flush()
    expect(tab()?.failure?.code).toBe('file-preview/malformed')
    expect(tab()?.content).toBeUndefined()
  })

  it('reads a workbook into its sheets', async () => {
    const { face, settle, tab } = bench()
    const xlsx = target('work/book.xlsx')
    face.load(TAB_1, { sessionId: SESSION, path: xlsx.path }, new AbortController().signal)
    settle(pageOfBytes(0, workbook('<row><c t="s"><v>1</v></c></row>')))
    await flush()
    expect(tab()?.content).toEqual({ kind: 'table', sheets: [{ name: 'Data', rows: [['Ada']], truncated: false }] })
  })

  it('reloads from the start, revoking the URL it had published', async () => {
    const { read, face, settle, tab } = bench()
    const controller = new AbortController()
    face.load(TAB_1, FILE, controller.signal)
    settle(page(0, btoa('hello'), true))
    await flush()
    face.reload(TAB_1, FILE, controller.signal)
    expect(revoked).toEqual(['blob:mock-0'])
    expect(tab()).toMatchObject({ loading: true, content: undefined, bytes: 0 })
    expect(read).toHaveBeenLastCalledWith(SESSION, PATH, 0, controller.signal)
    settle(page(0, btoa('world'), true))
    await flush()
    expect(tab()?.content).toEqual({ kind: 'url', url: 'blob:mock-1' })
  })

  it('reloads a tab that never loaded without revoking anything', async () => {
    const { face, settle, tab } = bench()
    const controller = new AbortController()
    face.reload(TAB_1, FILE, controller.signal)
    expect(revoked).toEqual([])
    settle(page(0, btoa('hi'), true))
    await flush()
    expect(tab()?.content).toEqual({ kind: 'url', url: 'blob:mock-0' })
  })

  it('drops a settlement a reload retired', async () => {
    const { face, settle, tab } = bench()
    const controller = new AbortController()
    face.load(TAB_1, FILE, controller.signal)
    face.reload(TAB_1, FILE, controller.signal)
    settle(page(0, btoa('stale'), true))
    await flush()
    expect(tab()?.content).toBeUndefined()
    expect(created).toEqual([])
    settle(page(0, btoa('fresh'), true))
    await flush()
    expect(tab()?.content).toEqual({ kind: 'url', url: 'blob:mock-0' })
  })

  it('revokes the URL it published when the record ends, forgetting the tab once', async () => {
    const { face, forget, settle, tab } = bench()
    const controller = new AbortController()
    face.load(TAB_1, FILE, controller.signal)
    settle(page(0, btoa('hello'), true))
    await flush()
    expect(tab()?.content).toEqual({ kind: 'url', url: 'blob:mock-0' })
    controller.abort()
    expect(revoked).toEqual(['blob:mock-0'])
    expect(forget).toHaveBeenCalledExactlyOnceWith(TAB_1)
    expect(tab()).toBeUndefined()
  })

  it('arms one abort listener however many loads a tab performs, and reads nothing for an ended record', async () => {
    const { read, face, settle } = bench()
    const controller = new AbortController()
    const armed = vi.spyOn(controller.signal, 'addEventListener')
    face.load(TAB_1, FILE, controller.signal)
    settle(page(0, btoa('hello'), true))
    await flush()
    face.load(TAB_1, FILE, controller.signal)
    face.reload(TAB_1, FILE, controller.signal)
    expect(armed.mock.calls.filter(([type]) => type === 'abort')).toHaveLength(1)
    controller.abort()
    face.load(TAB_1, FILE, controller.signal)
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('writes nothing when a load in flight is aborted with its record', async () => {
    const { face, forget, settle, tab } = bench()
    const controller = new AbortController()
    face.load(TAB_1, FILE, controller.signal)
    controller.abort()
    expect(forget).toHaveBeenCalledExactlyOnceWith(TAB_1)
    settle(page(0, btoa('late'), true))
    await flush()
    expect(tab()).toBeUndefined()
    expect(created).toEqual([])
  })

  it('does nothing for a record that already ended before any load', async () => {
    const { read, face, forget } = bench()
    const controller = new AbortController()
    controller.abort()
    face.load(TAB_1, FILE, controller.signal)
    face.reload(TAB_1, FILE, controller.signal)
    await flush()
    expect(read).not.toHaveBeenCalled()
    expect(forget).not.toHaveBeenCalled()
  })

  it('renders the tab already loaded from the harness without reading again', async () => {
    const h = harness({ 0: page(0, btoa('hello'), true) })
    h.face.load(TAB_1, FILE, new AbortController().signal)
    await flush()
    expect(h.read).toHaveBeenCalledTimes(1)
    expect(h.instance.getSnapshot().byTab[TAB_1]?.content).toEqual({ kind: 'url', url: 'blob:mock-0' })
  })
})
