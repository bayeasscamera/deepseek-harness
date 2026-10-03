/**
 * What the bytes become before a renderer can draw them.
 *
 * The blob formats need nothing from this module: the face publishes their bytes
 * under an object URL. Everything else is converted here — delimited text into
 * rows, and the OOXML documents out of their ZIP containers — and a conversion
 * that cannot read the file answers `undefined`, which the face turns into the
 * viewer's own failure line.
 */
import type { Row } from './delimited.ts'
import { parseDelimited } from './delimited.ts'
import { documentHtml } from './docx.ts'
import type { PreviewConversion } from './media.ts'
import { readParts } from './ooxml.ts'
import { deckSlides } from './pptx.ts'
import { MAX_SHEET_COLUMNS, MAX_SHEET_ROWS, parseWorkbook } from './xlsx.ts'

/** One sheet of a table preview. */
export interface PreviewSheet {
  /** The sheet's name: the workbook's own, or the delimited file's basename. */
  readonly name: string
  /** The rows read, capped. */
  readonly rows: readonly Row[]
  /** Whether rows or cells were dropped to fit the caps. */
  readonly truncated: boolean
}

/** What one loaded preview holds, keyed by how it is drawn. */
export type PreviewContent =
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'table'; readonly sheets: readonly PreviewSheet[] }
  | { readonly kind: 'document'; readonly html: string }
  | { readonly kind: 'slides'; readonly slides: readonly (readonly string[])[] }

/** The name a delimited file's single sheet carries. */
function sheetNameOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return name === '' ? path : name
}

/**
 * Apply the table caps to parsed rows.
 * @param rows - every row the file holds.
 * @returns the capped rows and whether anything was dropped.
 */
function capped(rows: Row[]): { rows: Row[]; truncated: boolean } {
  let truncated = rows.length > MAX_SHEET_ROWS
  const kept = rows.slice(0, MAX_SHEET_ROWS).map((row) => {
    if (row.length <= MAX_SHEET_COLUMNS) return row
    truncated = true
    return row.slice(0, MAX_SHEET_COLUMNS)
  })
  return { rows: kept, truncated }
}

/**
 * Convert one file's bytes for its renderer.
 * @param bytes - the file's whole content.
 * @param conversion - the conversion the format declares, never `blob`.
 * @param path - the workspace path, used to name a delimited file's sheet.
 * @returns the content to draw, or `undefined` when the file cannot be read as its format.
 */
export function convertPreview(
  bytes: Uint8Array,
  conversion: Exclude<PreviewConversion, 'blob'>,
  path: string,
): PreviewContent | undefined {
  if (conversion === 'csv' || conversion === 'tsv') {
    const { rows, truncated } = capped(parseDelimited(new TextDecoder().decode(bytes), conversion === 'csv' ? ',' : '\t'))
    return { kind: 'table', sheets: [{ name: sheetNameOf(path), rows, truncated }] }
  }
  const parts = readParts(bytes)
  if (parts === undefined) return undefined
  if (conversion === 'xlsx') {
    const sheets = parseWorkbook(parts)
    return sheets === undefined ? undefined : { kind: 'table', sheets }
  }
  if (conversion === 'docx') {
    const html = documentHtml(parts)
    return html === undefined ? undefined : { kind: 'document', html }
  }
  const slides = deckSlides(parts)
  return slides === undefined ? undefined : { kind: 'slides', slides }
}
