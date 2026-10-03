/**
 * How a tab address becomes the session and path the Host receives, and what
 * the bound read passes on: a position only, because the window length belongs
 * to the Host.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createReadBytes, hostFileOf } from '../src/client/rpc.ts'
import type { WorkspaceFilesBytesRemote } from '../src/client/rpc.ts'

const SEAT_SESSION = 'seat-session' as SessionId

describe('hostFileOf', () => {
  it('reads a session address through the session it names', () => {
    expect(hostFileOf('dsh-resource://file/session/s-9/work/picture.png', SEAT_SESSION))
      .toEqual({ sessionId: 's-9', path: 'work/picture.png' })
  })

  it('reads an absolute address through the seat session', () => {
    expect(hostFileOf('dsh-resource://file/absolute/home/me/picture.png', SEAT_SESSION))
      .toEqual({ sessionId: SEAT_SESSION, path: '/home/me/picture.png' })
  })

  it('throws for an address the grammar rejects, because the router never sends one', () => {
    expect(() => hostFileOf('dsh-resource://file/shared/team/a.png', SEAT_SESSION))
      .toThrow('not a file address')
  })
})

describe('createReadBytes', () => {
  it('asks for a position and never a length, so the Host window cap decides', async () => {
    const readBytes = vi.fn(() => Promise.resolve({ ok: true as const, value: {} as never }))
    const remote = { workspaceFiles: { readBytes } } as unknown as WorkspaceFilesBytesRemote
    const signal = new AbortController().signal
    const read = createReadBytes(remote)
    await read('s-1' as SessionId, 'work/picture.png', 4096, signal)
    expect(readBytes).toHaveBeenCalledWith('s-1', 'work/picture.png', { offset: 4096 }, signal)
  })
})
