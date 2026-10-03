/**
 * The preview's own state: what the bytes became, and how they are shown.
 *
 * The `file` resource carries metadata only, so the content is this type's to
 * fetch and keep — as one object URL for the formats the browser draws, or as
 * the rows, HTML, or slide text this package converted them into. A bucket
 * lives as long as its tab record: the face's first load of a tab arms one
 * listener on the owner's `signal` that revokes the URL and forgets the bucket
 * when the record ends, and a tab that never loaded has no bucket to forget.
 */
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { PreviewContent } from './content.ts'
import type { PreviewFormat } from './media.ts'

/** One tab's load and its outcome. */
export interface PreviewTabState {
  /** A load is in flight; the previous content, if any, is already gone. */
  loading: boolean
  /** Why the load failed; cleared by the next load. */
  failure: RemoteFailure | undefined
  /** What to draw, known before the first byte arrives. */
  format: PreviewFormat | undefined
  /** What the loaded bytes became; absent until they arrive. */
  content: PreviewContent | undefined
  /** Bytes loaded so far, for the size the reader is told about. */
  bytes: number
}

/** Every tab's state, keyed by tab id. */
export interface PreviewState {
  byTab: Record<TabId, PreviewTabState>
}

/**
 * A tab's state before it loads anything.
 * @returns the empty bucket.
 */
export function fresh(): PreviewTabState {
  return { loading: false, failure: undefined, format: undefined, content: undefined, bytes: 0 }
}

/** The bucket for one tab, created on first write. */
function bucket(state: PreviewState, tabId: TabId): PreviewTabState {
  return state.byTab[tabId] ??= fresh()
}

/** The preview store's write set; every action names the tab it writes. */
type PreviewActions = {
  loading: (draft: PreviewState, tabId: TabId, format: PreviewFormat) => void
  loaded: (draft: PreviewState, tabId: TabId, content: PreviewContent, bytes: number) => void
  failed: (draft: PreviewState, tabId: TabId, failure: RemoteFailure) => void
  reset: (draft: PreviewState, tabId: TabId) => void
  forget: (draft: PreviewState, tabId: TabId) => void
}

/**
 * Declare the preview's store.
 *
 * Constructed once in apply and shared by the body registration, which the
 * slot runtime allows because the seat is session-scoped.
 * @returns the store handle to declare on the registration.
 */
export function createPreviewStore(): EngineStoreHandle<PreviewState, PreviewActions> {
  return defineStore({
    init: (): PreviewState => ({ byTab: {} }),
    actions: {
      /**
       * Mark a load as in flight and record what will be drawn.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param format - the renderer and conversion the path resolved to.
       */
      loading: (d, tabId: TabId, format: PreviewFormat) => {
        const state = bucket(d, tabId)
        state.loading = true
        state.failure = undefined
        state.format = format
        state.content = undefined
        state.bytes = 0
      },
      /**
       * Keep what the loaded bytes became.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param content - the URL or the converted content.
       * @param bytes - total bytes loaded.
       */
      loaded: (d, tabId: TabId, content: PreviewContent, bytes: number) => {
        const state = bucket(d, tabId)
        state.loading = false
        state.failure = undefined
        state.content = content
        state.bytes = bytes
      },
      /**
       * Record why a load failed; whatever was loaded before is already gone.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param failure - the settled Remote failure.
       */
      failed: (d, tabId: TabId, failure: RemoteFailure) => {
        const state = bucket(d, tabId)
        state.loading = false
        state.failure = failure
        state.content = undefined
        state.bytes = 0
      },
      /**
       * Drop the loaded content, keeping the format, for a re-read.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      reset: (d, tabId: TabId) => {
        const state = bucket(d, tabId)
        state.loading = false
        state.failure = undefined
        state.content = undefined
        state.bytes = 0
      },
      /**
       * Drop one tab's state, for a tab record that is gone.
       * @param d - draft state.
       * @param tabId - the tab that went away.
       */
      forget: (d, tabId: TabId) => {
        const byTab: PreviewState['byTab'] = {}
        // Keys were written from tab ids; reading them back as ids is exact.
        for (const [id, state] of Object.entries(d.byTab) as [TabId, PreviewTabState][]) {
          if (id !== tabId) byTab[id] = state
        }
        d.byTab = byTab
      },
    },
  })
}

/** The store handle type the registration declares. */
export type PreviewStore = ReturnType<typeof createPreviewStore>
