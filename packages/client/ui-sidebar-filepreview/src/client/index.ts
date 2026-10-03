/**
 * Browser half: register `preview` as a right-Sidebar tab type.
 *
 * The type reaches the Sidebar through its public path only: the definition into
 * `ctx.sidebarRightTabs` and the body into the keyed `sidebar.right.pane.tab`
 * seat under the definition's `id`. Nothing here reaches into the Sidebar's store, its
 * panes, or its sequence. The file's metadata comes from the standard
 * `useResource`, served by the `file` provider; the bytes are this type's own
 * business, read window by window through its face. Every import from another
 * client plugin is a type.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-workspace-files/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { FilePreview } from './FilePreview.tsx'
import { PREVIEW_ID, previewDefinition } from './definition.ts'
import { MAX_PREVIEW_BYTES, previewFace } from './face.ts'
import { createReadBytes } from './rpc.ts'
import { createPreviewStore } from './store.ts'
import { en, zh } from './locales.ts'

// Values stay package-private unless another package needs them; the plugin
// surface is `apply`, `inject`, and the store factory another registration may
// share, plus the types a consumer of the seat or the store names.
export type { SidebarFilepreviewKey } from './locales.ts'
export type { FilePreviewProps } from './FilePreview.tsx'
export type { PreviewInjected } from './face.ts'
export type { ReadWorkspaceFileBytes, SessionFile, WorkspaceFilesBytesRemote } from './rpc.ts'
export type { PreviewFormat, PreviewRenderer, PreviewConversion } from './media.ts'
export type { PreviewContent, PreviewSheet } from './content.ts'
export type { Row } from './delimited.ts'
export type { PreviewState, PreviewStore, PreviewTabState } from './store.ts'

/** This package's copy namespace. */
const NS = 'sidebarFilepreview'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** File-preview progress, control, and failure lines. */
    sidebarFilepreview: import('./locales.ts').SidebarFilepreviewKey
  }
}

/**
 * Required browser services: the tab registry, the slot registry, copy, and the
 * Remote carrier with its `workspaceFiles` namespace.
 */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'remote', 'remote.workspaceFiles']

/**
 * Client plugin body: register the type, its dictionaries, and its body.
 * @param ctx - client root context carrying the registry, the slots, copy, and the Remote face.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.sidebarRightTabs.register(previewDefinition()), 'ui-sidebar-filepreview: preview type')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar-filepreview: dictionaries')

  const store = createPreviewStore()
  const face = previewFace(createReadBytes(ctx.remote), MAX_PREVIEW_BYTES)
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: PREVIEW_ID, locale: NS, store, inject: face },
    FilePreview,
  )), 'ui-sidebar-filepreview: preview body')
}
