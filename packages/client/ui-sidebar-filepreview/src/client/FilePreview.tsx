/**
 * The preview's body: what the loaded bytes became, or the reason they are not
 * showing.
 *
 * The standard `useResource` hook gives the file's metadata — its absolute path
 * for the header — while this type's store holds the content its face published
 * or converted. Three shapes are drawn here: the formats the browser renders
 * itself (a picture, an HTML page in a scripts-only sandbox, a PDF), rows as a
 * table, and the static HTML this package builds from a Word document or a
 * deck, in a frame that runs no scripts. The type's controls live in its own
 * header row; the Sidebar's strip carries none of them.
 *
 * An HTML page keeps its scripts because it is the page the user asked for; a
 * converted document gets none, because its HTML is this package's own output.
 * Neither frame can reach the application: both are opaque origins.
 */
import { useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PreviewSheet } from './content.ts'
import { slidesDocument, staticDocument } from './document-html.ts'
import type { PreviewInjected } from './face.ts'
import { failureLine } from './failure-line.ts'
import type { PreviewRenderer } from './media.ts'
import { hostFileOf } from './rpc.ts'
import type { PreviewStore, PreviewTabState } from './store.ts'
import css from './FilePreview.module.css'

/** The body's composed props: the tab, the shared store and face, and copy. */
export type FilePreviewProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsStore<PreviewStore>
  & InjectFace<PreviewInjected>
  & PropsLocale<'sidebarFilepreview'>

/** How each browser-drawn format is drawn from its object URL. */
const RENDERERS: Readonly<Record<Extract<PreviewRenderer, 'image' | 'html' | 'pdf'>, (url: string, mediaType: string, title: string) => ReactNode>> = {
  image: (url, _mediaType, title) => <img className={css.media} src={url} alt={title} data-filepreview-media="image" />,
  // Scripts only: no same-origin, forms, popups, or modals, so the page cannot
  // reach this application or navigate it.
  html: (url, _mediaType, title) => (
    <iframe className={css.frame} src={url} sandbox="allow-scripts" title={title} data-filepreview-media="html" />
  ),
  pdf: (url, mediaType) => <embed className={css.frame} src={url} type={mediaType} data-filepreview-media="pdf" />,
}

/**
 * One sheet's rows, its first row read as the header.
 * @param sheets - the sheets to draw.
 * @param truncated - the localized line a capped sheet carries.
 * @returns the tables, each under its sheet name.
 */
function tables(sheets: readonly PreviewSheet[], truncated: string): ReactNode {
  return sheets.map((sheet, index) => (
    // A sheet's position is its identity in the workbook; names may repeat.
    <section key={index} className={css.sheet} data-filepreview-sheet={sheet.name}>
      <div className={css.sheetName}>{sheet.name}</div>
      <div className={css.tableScroll}>
        <table className={css.table}>
          <tbody>
            {sheet.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => rowIndex === 0
                  ? <th key={cellIndex}>{cell}</th>
                  : <td key={cellIndex}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sheet.truncated && <p className={css.statusLine} data-filepreview-truncated>{truncated}</p>}
    </section>
  ))
}

/**
 * What the body currently shows, as the `data-filepreview-state` value.
 * @param state - the tab's store bucket.
 * @returns the renderer once content is drawn, `failed` after a failed load, otherwise `pending`.
 */
function phaseOf(state: PreviewTabState): string {
  if (state.content !== undefined) return state.format?.renderer ?? 'pending'
  return state.failure !== undefined ? 'failed' : 'pending'
}

/**
 * The drawn content, or the line that stands in for it.
 * @param state - the tab's store bucket.
 * @param title - the tab's title, used as the picture's alternative text and a frame's name.
 * @param retry - what the failure line's button does.
 * @param t - namespace-bound translate.
 * @returns the body's content.
 */
function bodyOf(state: PreviewTabState, title: string, retry: () => void, t: TranslateNS<'sidebarFilepreview'>): ReactNode {
  const { content, format } = state
  if (content === undefined) {
    if (state.failure === undefined) return <p className={css.statusLine} data-filepreview-loading>{t('loading')}</p>
    return (
      <p className={css.statusLine} data-filepreview-failed={state.failure.code}>
        <span>{failureLine(t, state.failure)}</span>
        <button type="button" className={css.action} data-filepreview-retry onClick={retry}>{t('retry')}</button>
      </p>
    )
  }
  if (content.kind === 'url') {
    // The face publishes a URL only for the blob formats, so a bucket holding
    // one without them is a caller's own write; it stays pending.
    return format !== undefined && format.conversion === 'blob'
      ? RENDERERS[format.renderer](content.url, format.mediaType, title)
      : <p className={css.statusLine} data-filepreview-loading>{t('loading')}</p>
  }
  if (content.kind === 'table') return tables(content.sheets, t('table.truncated'))
  if (content.kind === 'document') {
    return content.html === ''
      ? <p className={css.statusLine} data-filepreview-empty>{t('document.empty')}</p>
      : <iframe className={css.frame} srcDoc={staticDocument(content.html)} sandbox="" title={title} data-filepreview-media="document" />
  }
  return (
    <iframe
      className={css.frame}
      srcDoc={slidesDocument(content.slides, position => t('slide', { n: position }))}
      sandbox=""
      title={title}
      data-filepreview-media="slides"
    />
  )
}

/**
 * The preview type's body, registered under `sidebar.right.pane.tab` as `preview`.
 * @param props - composed slot props.
 * @returns the loaded file, or a progress or failure line.
 */
export function FilePreview({
  useTabInfo, sessionId, useResource, useStore, load, reload, t,
}: FilePreviewProps): ReactNode {
  const { tab } = useTabInfo()
  const { signal } = tab
  const meta = useResource<'file'>(tab.contentId)
  const file = useMemo(() => hostFileOf(tab.contentId, sessionId), [tab.contentId, sessionId])
  const state = useStore(s => s.byTab[tab.id])
  const started = state !== undefined

  // The first mount loads; a body coming back to a tab that already loaded
  // reads nothing, because the store outlives the body.
  useEffect(() => {
    if (!started) load(tab.id, file, signal)
  }, [started, tab.id, file, signal, load])

  if (state === undefined) {
    return (
      <div className={css.status} data-filepreview-state="loading">
        <p className={css.statusLine}>{t('loading')}</p>
      </div>
    )
  }
  const displayPath = meta.value?.absolutePath ?? file.path
  const redraw = (): void => { reload(tab.id, file, signal) }
  const renderer = state.content === undefined ? undefined : state.format?.renderer
  return (
    <div className={css.preview} data-filepreview-state={phaseOf(state)} data-filepreview-url={tab.contentId}>
      <div className={css.header}>
        <div className={css.path} title={displayPath} data-filepreview-path>{displayPath}</div>
        <button
          type="button"
          className={css.tool}
          aria-label={t('reload')}
          title={t('reload')}
          data-filepreview-tool="reload"
          onClick={redraw}
        >
          <IconRefreshOutline16 />
        </button>
      </div>
      <div className={clsx(css.body, renderer === 'image' && css.bodyMedia, renderer === 'table' && css.bodyTable)}>
        {bodyOf(state, tab.title, redraw, t)}
      </div>
    </div>
  )
}
