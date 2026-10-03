/**
 * The store's write set: each action names its tab, and the bucket for a tab
 * that never wrote is created on first write and dropped whole on `forget`.
 */
import { describe, expect, it } from 'vitest'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { PreviewContent } from '../src/client/content.ts'
import { createPreviewStore, fresh } from '../src/client/store.ts'

const TAB = 'tab-1' as TabId
const OTHER = 'tab-2' as TabId
const FORMAT = { renderer: 'image', conversion: 'blob', mediaType: 'image/png' } as const
const CONTENT: PreviewContent = { kind: 'url', url: 'blob:new' }
const FAILURE = { code: 'workspace-file/not-found', message: 'gone', details: { path: 'a.png' } } as unknown as RemoteFailure

describe('fresh', () => {
  it('starts a tab with nothing loaded', () => {
    expect(fresh()).toEqual({ loading: false, failure: undefined, format: undefined, content: undefined, bytes: 0 })
  })
})

describe('preview store', () => {
  it('records a load in flight, clearing whatever the previous one left', () => {
    const store = createPreviewStore().create()
    store.actions.loaded(TAB, CONTENT, 12)
    store.actions.loading(TAB, FORMAT)
    expect(store.getSnapshot().byTab[TAB]).toEqual({ loading: true, failure: undefined, format: FORMAT, content: undefined, bytes: 0 })
  })

  it('keeps what the bytes became and their size', () => {
    const store = createPreviewStore().create()
    store.actions.loading(TAB, FORMAT)
    store.actions.loaded(TAB, CONTENT, 34)
    expect(store.getSnapshot().byTab[TAB]).toEqual({ loading: false, failure: undefined, format: FORMAT, content: CONTENT, bytes: 34 })
  })

  it('records a failure without content', () => {
    const store = createPreviewStore().create()
    store.actions.loading(TAB, FORMAT)
    store.actions.failed(TAB, FAILURE)
    expect(store.getSnapshot().byTab[TAB]).toEqual({ loading: false, failure: FAILURE, format: FORMAT, content: undefined, bytes: 0 })
  })

  it('resets to nothing loaded while keeping the format', () => {
    const store = createPreviewStore().create()
    store.actions.loading(TAB, FORMAT)
    store.actions.loaded(TAB, CONTENT, 34)
    store.actions.reset(TAB)
    expect(store.getSnapshot().byTab[TAB]).toEqual({ loading: false, failure: undefined, format: FORMAT, content: undefined, bytes: 0 })
  })

  it('forgets one tab and leaves its siblings alone', () => {
    const store = createPreviewStore().create()
    store.actions.loaded(TAB, CONTENT, 1)
    store.actions.loaded(OTHER, { kind: 'table', sheets: [] }, 2)
    store.actions.forget(TAB)
    expect(store.getSnapshot().byTab[TAB]).toBeUndefined()
    expect(store.getSnapshot().byTab[OTHER]?.bytes).toBe(2)
  })

  it('creates a bucket on first write and forgets a tab that never wrote', () => {
    const store = createPreviewStore().create()
    store.actions.forget(TAB)
    expect(store.getSnapshot().byTab).toEqual({})
    store.actions.reset(TAB)
    expect(store.getSnapshot().byTab[TAB]).toEqual(fresh())
  })
})
