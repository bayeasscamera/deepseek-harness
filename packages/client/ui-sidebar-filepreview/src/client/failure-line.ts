/**
 * The failure line one Remote code deserves.
 *
 * Kept apart from the component so the mapping is testable on its own. Codes
 * this viewer does not name fall to the generic line carrying the carrier's
 * message.
 */
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'

/** Render a byte count the way a person reads one. */
function humanBytes(bytes: number): string {
  const units = [[1024 * 1024, 'MB'], [1024, 'KB'], [1, 'B']] as const
  const [scale, unit] = units.find(([size]) => bytes >= size) ?? [1, 'B']
  return `${Math.round(bytes / scale)} ${unit}`
}

/**
 * Say what went wrong, in terms of the file rather than of the transport.
 * @param t - namespace-bound translate.
 * @param failure - the settled Remote failure.
 * @returns the line to show in place of the file.
 */
export function failureLine(t: TranslateNS<'sidebarFilepreview'>, failure: RemoteFailure): string {
  switch (failure.code) {
    case 'workspace-file/not-found': return t('error.notFound')
    case 'workspace-file/outside-workspace': return t('error.outsideWorkspace')
    case 'workspace-file/not-regular-file': return t('error.notRegularFile')
    // The Host's window cap: this viewer asks for a position, never a length,
    // so this is the cap in force being smaller than one window of the file.
    case 'workspace-file/too-large':
      return t('error.tooLargeWindow', { limit: humanBytes(failure.details.limit) })
    case 'file-preview/too-large':
      return t('error.tooLargePreview', { limit: humanBytes(failure.details.limit) })
    case 'file-preview/unsupported': return t('error.unsupported')
    case 'file-preview/unreadable': return t('error.unreadable')
    case 'file-preview/malformed': return t('error.malformed')
    // Carrier and unclassified host failures reach the reader as themselves:
    // this panel knows nothing useful to add to a transport-level message.
    default: return t('error.unavailable', { message: failure.message })
  }
}
