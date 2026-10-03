/**
 * The standalone HTML documents the static frames are handed.
 *
 * A frame with no scripts is an opaque origin: it cannot read the application's
 * style tokens, so its sheet is written here, and it follows the reader's colour
 * scheme through `prefers-color-scheme`. The builders live in a module of their
 * own because they are markup, not UI copy: the body renders them, it does not
 * write them.
 */
import { escapeHtml } from './ooxml.ts'

/** Typography inside the static document frames. */
const DOCUMENT_STYLE = [
  'body{margin:0;padding:14px 16px;font:13px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1f2328;background:#fff}',
  'h1,h2,h3,h4,h5,h6{margin:1.1em 0 .4em;line-height:1.3}',
  'p{margin:.5em 0}',
  'table{border-collapse:collapse;margin:.6em 0}',
  'td{border:1px solid #d0d7de;padding:3px 6px;vertical-align:top}',
  'section+section{margin-top:1.4em;padding-top:1em;border-top:1px solid #d0d7de}',
  '@media (prefers-color-scheme:dark){body{color:#e6edf3;background:#0d1117}td{border-color:#30363d}section+section{border-top-color:#30363d}}',
].join('')

/**
 * Wrap one HTML fragment as a standalone static document.
 * @param fragment - the fragment this package built.
 * @returns the document handed to the frame.
 */
export function staticDocument(fragment: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${DOCUMENT_STYLE}</style></head><body>${fragment}</body></html>`
}

/**
 * One deck's slides as a static document, each under its numbered heading.
 * @param slides - one entry per slide, holding its paragraphs.
 * @param label - the localized slide label, given the 1-based number.
 * @returns the document handed to the frame.
 */
export function slidesDocument(slides: readonly (readonly string[])[], label: (position: number) => string): string {
  const sections = slides.map((paragraphs, index) => {
    const heading = ['<h2>', escapeHtml(label(index + 1)), '</h2>'].join('')
    const body = paragraphs.map(text => ['<p>', escapeHtml(text), '</p>'].join('')).join('')
    return ['<section>', heading, body, '</section>'].join('')
  }).join('')
  return staticDocument(sections)
}
