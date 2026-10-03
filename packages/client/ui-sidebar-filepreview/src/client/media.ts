/**
 * Which preview a workspace file gets, decided by its extension.
 *
 * The extension is the only signal available before reading: the Host serves
 * bytes with no media type on the wire, and sniffing a page would either guess
 * or need the whole file. Every extension the tab type claims appears here, so
 * an address this package claimed always resolves; `undefined` is the
 * defensive answer for a caller that names the kind for a file this package
 * does not render.
 *
 * A format also says what the bytes must become before they can be drawn: a
 * blob published under an object URL for the formats the browser renders
 * itself, or a conversion this package performs (delimited text and the OOXML
 * documents, which are ZIP containers of XML).
 */

/** How one file's bytes are drawn. */
export type PreviewRenderer = 'image' | 'html' | 'pdf' | 'table' | 'document'

/** What the bytes must be turned into before the renderer can draw them. */
export type PreviewConversion = 'blob' | 'csv' | 'tsv' | 'xlsx' | 'docx' | 'pptx'

/** One preview: the renderer, and what it is fed. */
export type PreviewFormat =
  /** The browser draws the bytes itself from an object URL of this media type. */
  | { readonly renderer: 'image' | 'html' | 'pdf'; readonly conversion: 'blob'; readonly mediaType: string }
  /** Rows this package parses out of delimited text or a workbook. */
  | { readonly renderer: 'table'; readonly conversion: 'csv' | 'tsv' | 'xlsx' }
  /** Static HTML this package builds from a Word document or a deck. */
  | { readonly renderer: 'document'; readonly conversion: 'docx' | 'pptx' }

/** Renderer and conversion by lower-case extension, without its dot. */
const FORMATS: Readonly<Record<string, PreviewFormat>> = {
  png: { renderer: 'image', conversion: 'blob', mediaType: 'image/png' },
  jpg: { renderer: 'image', conversion: 'blob', mediaType: 'image/jpeg' },
  jpeg: { renderer: 'image', conversion: 'blob', mediaType: 'image/jpeg' },
  gif: { renderer: 'image', conversion: 'blob', mediaType: 'image/gif' },
  webp: { renderer: 'image', conversion: 'blob', mediaType: 'image/webp' },
  avif: { renderer: 'image', conversion: 'blob', mediaType: 'image/avif' },
  bmp: { renderer: 'image', conversion: 'blob', mediaType: 'image/bmp' },
  ico: { renderer: 'image', conversion: 'blob', mediaType: 'image/x-icon' },
  svg: { renderer: 'image', conversion: 'blob', mediaType: 'image/svg+xml' },
  html: { renderer: 'html', conversion: 'blob', mediaType: 'text/html' },
  htm: { renderer: 'html', conversion: 'blob', mediaType: 'text/html' },
  pdf: { renderer: 'pdf', conversion: 'blob', mediaType: 'application/pdf' },
  csv: { renderer: 'table', conversion: 'csv' },
  tsv: { renderer: 'table', conversion: 'tsv' },
  xlsx: { renderer: 'table', conversion: 'xlsx' },
  docx: { renderer: 'document', conversion: 'docx' },
  pptx: { renderer: 'document', conversion: 'pptx' },
}

/**
 * The extensions this package renders, lower-case, without their dots.
 *
 * The tab type's address patterns are derived from this list, so a format is
 * added in exactly one place.
 */
export const PREVIEW_EXTENSIONS: readonly string[] = Object.freeze(Object.keys(FORMATS))

/**
 * The preview one workspace path gets, by its extension.
 * @param path - the workspace path (or any path-shaped string) to classify.
 * @returns the renderer and conversion, or `undefined` for an extension this package does not render.
 */
export function previewFormatOf(path: string): PreviewFormat | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return undefined
  return FORMATS[name.slice(dot + 1).toLowerCase()]
}
