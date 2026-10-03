/**
 * The byte reads this type performs, bound to the Client Remote.
 *
 * Content is the consumer's business: the `file` resource carries metadata
 * only, and the bytes arrive here one window at a time — the window size is the
 * Host's configured cap, which this package neither knows nor needs, because a
 * byte window above it is refused rather than shortened. The endpoint takes a
 * session and a workspace path while a tab carries a `dsh-resource://file/`
 * address in one of two scopes, so this module also owns that translation.
 */
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceByteRange, WorkspaceFileBytes } from '@deepseek-ai/dsh-api-workspace-files/types'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import type {} from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /**
     * The file's bytes exceed the total this viewer loads into one preview.
     * Raised by the Client viewer; the Host never emits it.
     */
    'file-preview/too-large': { readonly path: string; readonly limit: number }
    /**
     * The address names an extension this viewer does not render, reached only
     * by a caller that named the kind for such a file. Raised by the Client
     * viewer; the Host never emits it.
     */
    'file-preview/unsupported': { readonly path: string }
    /**
     * The Host answered a byte window past the loaded range with no bytes and
     * no end of file, so the read cannot make progress. Raised by the Client
     * viewer; the Host never emits it.
     */
    'file-preview/unreadable': { readonly path: string }
    /**
     * The loaded bytes could not be read as the format the extension claims:
     * a container that is not a readable ZIP, or one missing the parts the
     * document needs. Raised by the Client viewer; the Host never emits it.
     */
    'file-preview/malformed': { readonly path: string }
  }
}

/** The slice of the Client Remote this package calls. */
export interface WorkspaceFilesBytesRemote {
  readonly workspaceFiles: {
    /**
     * Read one window of bytes.
     * @param sessionId - the session whose workspace resolves `path`.
     * @param path - workspace path, absolute or relative to the workspace root.
     * @param range - byte offset; the Host's window cap applies when `length` is absent.
     * @param signal - cancels the call.
     * @returns the base64 window, or the failure the Host declares.
     */
    readBytes(
      sessionId: SessionId,
      path: string,
      range: WorkspaceByteRange,
      signal?: AbortSignal,
    ): Promise<RemoteResult<WorkspaceFileBytes>>
  }
}

/**
 * The read one byte window performs, injected so the face stays host-free.
 *
 * The session travels with the call because the endpoint resolves the workspace
 * root from it: the same path means different files in different sessions. A
 * Remote call does not reject: the result carries the failure.
 */
export type ReadWorkspaceFileBytes = (
  sessionId: SessionId,
  path: string,
  offset: number,
  signal: AbortSignal,
) => Promise<RemoteResult<WorkspaceFileBytes>>

/** The file one tab reads: the session the read runs under and the path handed to the Host. */
export interface SessionFile {
  /** The session whose workspace confines the read. */
  readonly sessionId: SessionId
  /** The path the Host receives: workspace-relative for a `session` address, absolute for an `absolute` one. */
  readonly path: string
}

/**
 * The session and path one `dsh-resource://file/…` address names.
 *
 * A `session` address names its own session and a workspace-relative path, so
 * a tab addressed into another session reads from that session. An `absolute`
 * address carries no session and is read through the seat's own, which the
 * Host confines to that session's workspace. The registry routes parseable
 * `file` addresses it matched to this type, so an address `parseFileAddress`
 * rejects is a programming error and throws.
 * @param address - a tab's `dsh-resource://file/…` address.
 * @param sessionId - the seat's session, which an `absolute` address is read through.
 * @returns the session and the path to hand the endpoint.
 */
export function hostFileOf(address: string, sessionId: SessionId): SessionFile {
  const parsed = parseFileAddress(address)
  if (parsed === undefined) throw new Error(`ui-sidebar-filepreview: not a file address "${address}"`)
  // The address is a string boundary: its id segment is the Session id it names.
  return parsed.scope === 'session'
    ? { sessionId: parsed.sessionId as SessionId, path: parsed.path }
    : { sessionId, path: parsed.path }
}

/**
 * Bind the byte read to one Remote face. The window length is the Host's
 * configured cap, so no `length` travels and no page is ever refused for
 * asking above it.
 * @param remote - the Client Remote carrying the `workspaceFiles` namespace.
 * @returns the read the face performs.
 */
export function createReadBytes(remote: WorkspaceFilesBytesRemote): ReadWorkspaceFileBytes {
  return (sessionId, path, offset, signal) => remote.workspaceFiles.readBytes(sessionId, path, { offset }, signal)
}
