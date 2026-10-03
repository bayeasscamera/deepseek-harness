/**
 * Shared harness for the specs: a real store instance and a real face over a
 * scripted byte read, behind one documented cast, so the body specs exercise the
 * component and not the slot runtime.
 */
import { vi } from 'vitest'
import type { Mock } from 'vitest'
import { useSyncExternalStore } from 'react'
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { ResourceSnapshot } from '@deepseek-ai/dsh-client-resources/client'
import type { WorkspaceFileResource } from '@deepseek-ai/dsh-api-workspace-files/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceFileBytes } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { FilePreviewProps } from '../src/client/FilePreview.tsx'
import { previewFace } from '../src/client/face.ts'
import type { PreviewInjected } from '../src/client/face.ts'
import type { ReadWorkspaceFileBytes, SessionFile } from '../src/client/rpc.ts'
import { createPreviewStore } from '../src/client/store.ts'
import type { PreviewStore } from '../src/client/store.ts'

export const TAB_ID = 'tab-1' as TabId
export const SESSION = 's-1' as SessionId
/** The path relative to the session's workspace root, as the Host receives it. */
export const PATH = 'work/picture.png'
export const ABSOLUTE_PATH = '/host/project/work/picture.png'
/** The tab's address: the file under this session's scope. */
export const ADDRESS = 'dsh-resource://file/session/s-1/work/picture.png'
/** What one address names, as the face receives it. */
export const FILE: SessionFile = { sessionId: SESSION, path: PATH }
/** A total bound small enough that a spec can exceed it with one short window. */
export const TINY_LIMIT = 32

/** The total bound the harness gives a tab by default: room for a real fixture file. */
export const LIMIT = 64 * 1024

/** One address's session and path, spelled the way `hostFileOf` reads them. */
export interface Target {
  /** The tab's full `dsh-resource://file/…` address. */
  readonly address: string
  /** The path handed to the Host. */
  readonly path: string
  /** The tab chip's title. */
  readonly title: string
}

/** The default target: a picture under this session's scope. */
export const PICTURE: Target = { address: ADDRESS, path: PATH, title: 'picture.png' }

/** One byte window the Host would return: base64 data and the end-of-file flag. */
export function page(offset: number, data: string, eof: boolean, version = 'v1'): RemoteResult<WorkspaceFileBytes> {
  return { ok: true, value: { absolutePath: ABSOLUTE_PATH, version, offset, data, eof, bytes: data.length } }
}

/** One byte window holding a whole fixture file. */
export function pageOfBytes(offset: number, bytes: Uint8Array, eof = true, version = 'v1'): RemoteResult<WorkspaceFileBytes> {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return page(offset, btoa(binary), eof, version)
}

/** One failed byte read. */
export function failed(code: string, details: Record<string, unknown> = {}): RemoteResult<WorkspaceFileBytes> {
  return { ok: false, error: { code, message: 'boom', details } as unknown as RemoteFailure }
}

/** The `file` resource's metadata frame. */
function meta(value: WorkspaceFileResource | undefined, reload: () => void): ResourceSnapshot<WorkspaceFileResource> {
  return { status: 'live', value, failure: undefined, reload }
}

/** Test-local selector hook over a framework-neutral store instance. */
function hookOf<T>(inst: { subscribe: (fn: () => void) => () => void; getSnapshot: () => T }) {
  return function useSelector<S>(sel: (s: T) => S): S {
    return sel(useSyncExternalStore(inst.subscribe, inst.getSnapshot))
  }
}

/** Key-echoing translate that also shows its parameters. */
export function t(key: string, params?: Record<string, unknown>): string {
  return params === undefined ? key : `${key}(${Object.entries(params).map(([k, v]) => `${k}=${String(v)}`).join(',')})`
}

/** What one tab record's harness hands a spec. */
export interface Harness {
  /** The live store instance the body reads. */
  instance: ReturnType<PreviewStore['create']>
  /** The face bound to the scripted read. */
  face: PreviewInjected
  /** The scripted byte read. */
  read: Mock<ReadWorkspaceFileBytes>
  /** The resource's `reload`. */
  reload: Mock<() => void>
  /** The tab record's lifetime. */
  controller: AbortController
  /** Script the window each offset resolves to from now on; an unscripted offset fails `not-found`. */
  script(offset: number, result: RemoteResult<WorkspaceFileBytes>): void
  /** Script the metadata frame the resource reports: its value, or no value at all. */
  setMeta(value: WorkspaceFileResource | undefined): void
  /** Composed props for the body. */
  props: () => FilePreviewProps
}

/**
 * One tab record's harness.
 * @param script - the window each offset resolves to; an unscripted offset fails `not-found`.
 * @param target - the address, path, and title the tab carries.
 * @param limit - total bytes the face may load for the tab.
 * @returns the store, the scripted faces, and a props builder.
 */
export function harness(
  script: Record<number, RemoteResult<WorkspaceFileBytes>> = {},
  target: Target = PICTURE,
  limit = LIMIT,
): Harness {
  const instance = createPreviewStore().create()
  const pages: Record<number, RemoteResult<WorkspaceFileBytes>> = { ...script }
  const read = vi.fn<ReadWorkspaceFileBytes>((_session, _path, offset) =>
    Promise.resolve(pages[offset] ?? failed('workspace-file/not-found', { path: target.path })))
  const face = previewFace(read, limit)(SESSION, instance.actions)
  const reload = vi.fn<() => void>()
  const current = { value: { absolutePath: ABSOLUTE_PATH, version: 'v1', bytes: 100, changed: false } as WorkspaceFileResource | undefined }
  const useResource = vi.fn<() => ResourceSnapshot<WorkspaceFileResource>>(() => meta(current.value, reload))
  const controller = new AbortController()
  const tabActions = { openResource: vi.fn(), openTab: vi.fn(), close: vi.fn(), replace: vi.fn() }
  const props = () => ({
    useTabInfo: () => ({
      sidebar: { expanded: true, fullscreen: false },
      panel: { id: 'pane-1' },
      tab: {
        id: TAB_ID, kind: 'preview', contentId: target.address, title: target.title, visible: true,
        navigation: { address: target.address, params: undefined, revision: 1 },
        signal: controller.signal,
        actions: tabActions,
      },
    }),
    sessionId: SESSION,
    useResource,
    useStore: hookOf(instance),
    actions: instance.actions,
    load: face.load,
    reload: face.reload,
    t,
  }) as unknown as FilePreviewProps
  return {
    instance,
    face,
    read,
    reload,
    controller,
    props,
    script(offset, result) { pages[offset] = result },
    setMeta(value) { current.value = value },
  }
}
