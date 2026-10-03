/**
 * One sentence per endpoint code, and the transport's own words for anything else.
 */
import { describe, expect, it } from 'vitest'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
// The namespace declaration `TranslateNS<'sidebarFilepreview'>` resolves against.
import type {} from '../src/client/index.ts'
import { failureLine } from '../src/client/failure-line.ts'

/** Key-echoing translate that also shows its parameters, so a formatted value is visible. */
const t: TranslateNS<'sidebarFilepreview'> = (key, params) =>
  params === undefined ? key : `${key}(${Object.entries(params).map(([k, v]) => `${k}=${String(v)}`).join(',')})`

function failure(code: string, details: Record<string, unknown> = {}, message = 'boom'): RemoteFailure {
  return { code, message, details } as unknown as RemoteFailure
}

describe('failureLine', () => {
  it('names each code this viewer can meet', () => {
    expect(failureLine(t, failure('workspace-file/not-found'))).toBe('error.notFound')
    expect(failureLine(t, failure('workspace-file/outside-workspace'))).toBe('error.outsideWorkspace')
    expect(failureLine(t, failure('workspace-file/not-regular-file'))).toBe('error.notRegularFile')
    expect(failureLine(t, failure('file-preview/unsupported'))).toBe('error.unsupported')
    expect(failureLine(t, failure('file-preview/unreadable'))).toBe('error.unreadable')
    expect(failureLine(t, failure('file-preview/malformed'))).toBe('error.malformed')
  })

  it('states the Host window cap and the preview total the way a person reads a byte count', () => {
    expect(failureLine(t, failure('workspace-file/too-large', { limit: 512 }))).toBe('error.tooLargeWindow(limit=512 B)')
    expect(failureLine(t, failure('workspace-file/too-large', { limit: 4096 }))).toBe('error.tooLargeWindow(limit=4 KB)')
    expect(failureLine(t, failure('file-preview/too-large', { limit: 0 }))).toBe('error.tooLargePreview(limit=0 B)')
    expect(failureLine(t, failure('file-preview/too-large', { limit: 3 * 1024 * 1024 }))).toBe('error.tooLargePreview(limit=3 MB)')
  })

  it('passes any other failure through in its own words', () => {
    expect(failureLine(t, failure('gateway/internal', {}, 'socket closed'))).toBe('error.unavailable(message=socket closed)')
  })
})
