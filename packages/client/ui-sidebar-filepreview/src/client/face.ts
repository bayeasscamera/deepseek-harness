/**
 * The preview's asynchronous half: reading byte windows, then publishing or
 * converting them.
 *
 * The component never awaits anything. It asks for a load and this face walks
 * the file's byte windows — the window size is the Host's, so the read asks for
 * a position and never for a length — then hands the bytes to the format's own
 * step: an object URL for the formats the browser draws itself, or the rows,
 * HTML, or slide text this package converts. Both outcomes land in the store
 * through its own actions. The session the read runs under comes from the
 * file's address, not from the slot's session: the address is the read's whole
 * authority.
 *
 * Windows are bounded twice: by the Host's window cap, and by this face's
 * total, above which a file is refused rather than loaded into memory. Cleanup
 * rides the owner's `signal`, armed once per tab by its first load: the abort
 * revokes the object URL, forgets the tab's bucket and this bookkeeping, and a
 * settlement arriving after the record is gone has nothing left to write to.
 */
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { BoundActions } from '@deepseek-ai/dsh-client-store'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { convertPreview, type PreviewContent } from './content.ts'
import { previewFormatOf, type PreviewFormat } from './media.ts'
import type { ReadWorkspaceFileBytes, SessionFile } from './rpc.ts'
import type { PreviewStore } from './store.ts'

/**
 * Total bytes one preview loads before it is refused.
 *
 * The whole file is held while a preview is live — as the bytes read and, for
 * the blob formats, as the Blob built from them — so the bound is about what a
 * tab may cost the page, not about the file. A larger file is still reachable
 * through the text viewer (when it is text) or outside the app.
 */
export const MAX_PREVIEW_BYTES = 32 * 1024 * 1024

/** The preview's injected business face, as the body receives it. */
export interface PreviewInjected {
  /**
   * Load one tab's bytes, unless the record already ended. The first load arms
   * the abort listener that revokes the tab's object URL and forgets its bucket
   * when the record ends.
   * @param tabId - the tab being drawn.
   * @param file - the session and workspace path the tab's address names.
   * @param signal - the tab record's lifetime.
   */
  readonly load: (tabId: TabId, file: SessionFile, signal: AbortSignal) => void
  /**
   * Drop the loaded content and load it again: the object URL is revoked before
   * the new read starts. A read still in flight for the previous attempt writes
   * nothing when it settles.
   * @param tabId - the tab being drawn.
   * @param file - the session and workspace path the tab's address names.
   * @param signal - the tab record's lifetime.
   */
  readonly reload: (tabId: TabId, file: SessionFile, signal: AbortSignal) => void
}

/**
 * What the face remembers of one tab: the load generation a settlement must
 * match, and the object URL currently published. Created by the tab's first
 * load, which also arms the one abort listener that forgets the tab.
 */
interface TabLoads {
  generation: number
  published: string | undefined
}

/**
 * Decode one base64 window into the bytes it carries.
 * @param base64 - the window's data, as the Host encoded it.
 * @returns the bytes.
 */
function bytesOf(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/**
 * Join the windows of one file into its bytes.
 * @param chunks - the windows, in read order.
 * @returns one array holding them end to end.
 */
function joined(chunks: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

/**
 * Bind the preview's face to one byte read.
 * @param read - the bound `workspaceFiles.readBytes` call.
 * @param maxBytes - total bytes one preview may load, above which the file is refused.
 * @returns the Slot `inject` factory: bound actions in, face out. The slot's session id is unused because the address carries its own.
 */
export function previewFace(
  read: ReadWorkspaceFileBytes,
  maxBytes: number,
): (sessionId: SessionId, actions: BoundActions<PreviewStore>) => PreviewInjected {
  return (_sessionId: SessionId, actions: BoundActions<PreviewStore>): PreviewInjected => {
    const tabs = new Map<TabId, TabLoads>()
    // Reached with a live signal only: the record's end revokes the URL and
    // forgets the bucket and this bookkeeping in one listener, however often
    // the tab's body mounts.
    const loadsOf = (tabId: TabId, signal: AbortSignal): TabLoads => {
      const held = tabs.get(tabId)
      if (held !== undefined) return held
      const created: TabLoads = { generation: 0, published: undefined }
      tabs.set(tabId, created)
      signal.addEventListener('abort', () => {
        if (created.published !== undefined) URL.revokeObjectURL(created.published)
        tabs.delete(tabId)
        actions.forget(tabId)
      }, { once: true })
      return created
    }
    const load = async (tabId: TabId, file: SessionFile, signal: AbortSignal): Promise<void> => {
      const loads = loadsOf(tabId, signal)
      const generation = loads.generation
      const format = previewFormatOf(file.path)
      if (format === undefined) {
        actions.failed(tabId, new RemoteError('file-preview/unsupported', `no preview for "${file.path}"`, { path: file.path }))
        return
      }
      actions.loading(tabId, format)
      const chunks: Uint8Array[] = []
      let offset = 0
      let total = 0
      for (;;) {
        const result = await read(file.sessionId, file.path, offset, signal)
        if (signal.aborted || loads.generation !== generation) return
        if (!result.ok) {
          actions.failed(tabId, result.error)
          return
        }
        const bytes = bytesOf(result.value.data)
        if (bytes.length === 0 && !result.value.eof) {
          actions.failed(tabId, new RemoteError('file-preview/unreadable', `the read of "${file.path}" made no progress`, { path: file.path }))
          return
        }
        chunks.push(bytes)
        total += bytes.length
        offset += bytes.length
        if (total > maxBytes) {
          actions.failed(tabId, new RemoteError('file-preview/too-large', `"${file.path}" is past the preview limit`, { path: file.path, limit: maxBytes }))
          return
        }
        if (result.value.eof) break
      }
      const content = contentOf(joined(chunks), format, file.path)
      if (content === undefined) {
        actions.failed(tabId, new RemoteError('file-preview/malformed', `"${file.path}" is not readable as its format`, { path: file.path }))
        return
      }
      loads.published = content.kind === 'url' ? content.url : undefined
      actions.loaded(tabId, content, total)
    }
    const start = (tabId: TabId, file: SessionFile, signal: AbortSignal, fresh: boolean): void => {
      if (signal.aborted) return
      const loads = loadsOf(tabId, signal)
      if (fresh) {
        loads.generation += 1
        if (loads.published !== undefined) {
          URL.revokeObjectURL(loads.published)
          loads.published = undefined
        }
        actions.reset(tabId)
      }
      void load(tabId, file, signal)
    }
    return {
      load: (tabId, file, signal) => { start(tabId, file, signal, false) },
      reload: (tabId, file, signal) => { start(tabId, file, signal, true) },
    }
  }
}

/**
 * What one file's bytes become for its format: a published object URL, or the
 * conversion this package performs.
 * @param bytes - the file's whole content.
 * @param format - the format the extension resolved to.
 * @param path - the workspace path, used to name a delimited file's sheet.
 * @returns the content to draw, or `undefined` when the conversion cannot read the file.
 */
function contentOf(bytes: Uint8Array, format: PreviewFormat, path: string): PreviewContent | undefined {
  if (format.conversion === 'blob') {
    return { kind: 'url', url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: format.mediaType })) }
  }
  return convertPreview(bytes, format.conversion, path)
}
