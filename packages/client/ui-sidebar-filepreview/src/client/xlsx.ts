/**
 * A workbook's sheets read as rows.
 *
 * The first sheet of a real workbook is what a reader opens it for, so every
 * sheet is read in workbook order and capped rather than paged: a preview draws
 * a bounded table, and the cap is reported instead of silently hiding cells.
 * Cell values follow the file's own typing — shared and inline strings are
 * resolved, booleans read as words, and everything else keeps the stored text
 * (a date stays the serial number the cell holds, because the number format
 * that would interpret it is not read here).
 */
import type { Row } from './delimited.ts'
import type { PreviewSheet } from './content.ts'
import { elements, joinedText, xmlPart, type OoxmlParts } from './ooxml.ts'

/** Rows one sheet is read to; the rest are dropped and reported. */
export const MAX_SHEET_ROWS = 500

/** Columns one sheet is read to; cells past it are dropped and reported. */
export const MAX_SHEET_COLUMNS = 40

/**
 * The column one cell reference names, counting from zero.
 * @param reference - a cell reference such as `B3`; only its letters are read.
 * @returns the zero-based column index.
 */
function columnIndex(reference: string): number {
  let index = 0
  for (const character of reference) {
    const code = character.toUpperCase().charCodeAt(0)
    if (code < 65 || code > 90) break
    index = index * 26 + (code - 64)
  }
  return index - 1
}

/**
 * The strings a workbook shares across its sheets.
 * @param parts - the archive's parts.
 * @returns one entry per shared string, in index order; empty when the part is absent.
 */
function sharedStrings(parts: OoxmlParts): string[] {
  const document = xmlPart(parts, 'xl/sharedStrings.xml')
  return document === undefined ? [] : elements(document, 'si').map(entry => joinedText(entry, 't'))
}

/**
 * One cell's value as text.
 * @param cell - the `c` element.
 * @param shared - the workbook's shared strings.
 * @returns the value the cell holds.
 */
function cellValue(cell: Element, shared: readonly string[]): string {
  const type = cell.getAttribute('t')
  if (type === 'inlineStr') return joinedText(cell, 'is')
  const stored = joinedText(cell, 'v')
  if (type === 's') return shared[Number(stored)] ?? ''
  if (type === 'b') return stored === '1' ? 'TRUE' : 'FALSE'
  return stored
}

/**
 * One worksheet's rows, capped.
 * @param sheet - the parsed worksheet document.
 * @param shared - the workbook's shared strings.
 * @returns the rows and whether anything was dropped.
 */
function rowsOf(sheet: Document, shared: readonly string[]): { rows: Row[]; truncated: boolean } {
  const rows: Row[] = []
  let truncated = false
  for (const row of elements(sheet, 'row')) {
    if (rows.length >= MAX_SHEET_ROWS) {
      truncated = true
      break
    }
    const cells: string[] = []
    for (const cell of elements(row, 'c')) {
      const reference = cell.getAttribute('r')
      const index = reference === null ? cells.length : columnIndex(reference)
      if (index >= MAX_SHEET_COLUMNS) {
        truncated = true
        continue
      }
      while (cells.length < index) cells.push('')
      cells[index] = cellValue(cell, shared)
    }
    rows.push(cells)
  }
  return { rows, truncated }
}

/**
 * Every sheet of one workbook, in workbook order.
 * @param parts - the archive's parts.
 * @returns the sheets, or `undefined` when the workbook's own parts are absent or unreadable.
 */
export function parseWorkbook(parts: OoxmlParts): PreviewSheet[] | undefined {
  const workbook = xmlPart(parts, 'xl/workbook.xml')
  const relationships = xmlPart(parts, 'xl/_rels/workbook.xml.rels')
  if (workbook === undefined || relationships === undefined) return undefined
  const targets = new Map(elements(relationships, 'Relationship')
    .map(relationship => [relationship.getAttribute('Id') ?? '', relationship.getAttribute('Target') ?? '']))
  const shared = sharedStrings(parts)
  const sheets: PreviewSheet[] = []
  for (const sheet of elements(workbook, 'sheet')) {
    const target = targets.get(sheet.getAttribute('r:id') ?? '')
    if (target === undefined) continue
    // Relationship targets are relative to the workbook's own directory.
    const document = xmlPart(parts, `xl/${target.replace(/^\/?xl\//, '')}`)
    if (document === undefined) continue
    const { rows, truncated } = rowsOf(document, shared)
    sheets.push({ name: sheet.getAttribute('name') ?? '', rows, truncated })
  }
  return sheets.length === 0 ? undefined : sheets
}
