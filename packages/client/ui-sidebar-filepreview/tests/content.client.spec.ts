// @vitest-environment jsdom
/**
 * What each format's bytes become: rows for the delimited and workbook files,
 * static HTML for a document, slide text for a deck, and `undefined` — never a
 * throw — for bytes that cannot be read as the extension claims.
 */
import { describe, expect, it } from 'vitest'
import { convertPreview } from '../src/client/content.ts'
import { MAX_SHEET_ROWS } from '../src/client/xlsx.ts'
import { archive, deck, drawingParagraph, str, wordDocument, workbook } from './ooxml-fixtures.client.ts'

const text = (value: string): Uint8Array => str(value)

describe('convertPreview', () => {
  it('reads a CSV into one sheet named by the file', () => {
    expect(convertPreview(text('a,b\n1,2\n'), 'csv', 'work/data.csv')).toEqual({
      kind: 'table',
      sheets: [{ name: 'data.csv', rows: [['a', 'b'], ['1', '2']], truncated: false }],
    })
  })

  it('reads a TSV on its own delimiter, and names a sheet after a path with no basename', () => {
    expect(convertPreview(text('a\tb'), 'tsv', '/')).toEqual({
      kind: 'table',
      sheets: [{ name: '/', rows: [['a', 'b']], truncated: false }],
    })
  })

  it('caps a delimited file by rows, reporting it', () => {
    const rows = Array.from({ length: MAX_SHEET_ROWS + 1 }, () => 'a,b').join('\n')
    const content = convertPreview(text(rows), 'csv', 'big.csv')
    expect(content?.kind).toBe('table')
    expect(content?.kind === 'table' ? content.sheets[0]?.truncated : false).toBe(true)
    expect(content?.kind === 'table' ? content.sheets[0]?.rows : []).toHaveLength(MAX_SHEET_ROWS)
  })

  it('caps a delimited file by columns, reporting it', () => {
    const wide = Array.from({ length: 41 }, (_, index) => `c${index}`).join(',')
    const content = convertPreview(text(wide), 'csv', 'wide.csv')
    expect(content?.kind === 'table' ? content.sheets[0]?.truncated : false).toBe(true)
    expect(content?.kind === 'table' ? content.sheets[0]?.rows[0] : undefined).toHaveLength(40)
  })

  it('reads a workbook into its sheets', () => {
    const content = convertPreview(workbook('<row><c t="s"><v>1</v></c></row>'), 'xlsx', 'book.xlsx')
    expect(content).toEqual({ kind: 'table', sheets: [{ name: 'Data', rows: [['Ada']], truncated: false }] })
  })

  it('reads a Word document into an HTML fragment', () => {
    const content = convertPreview(wordDocument('<w:p><w:r><w:t>hi</w:t></w:r></w:p>'), 'docx', 'a.docx')
    expect(content).toEqual({ kind: 'document', html: '<p>hi</p>' })
  })

  it('reads a deck into its slides', () => {
    const content = convertPreview(deck({ 1: drawingParagraph('Title') }), 'pptx', 'a.pptx')
    expect(content).toEqual({ kind: 'slides', slides: [['Title']] })
  })

  it('answers undefined for a readable container missing the parts its format needs', () => {
    expect(convertPreview(archive({ 'xl/styles.xml': '<styleSheet/>' }), 'xlsx', 'a.xlsx')).toBeUndefined()
    expect(convertPreview(archive({ 'word/styles.xml': '<styles/>' }), 'docx', 'a.docx')).toBeUndefined()
    expect(convertPreview(archive({ 'ppt/presentation.xml': '<sld/>' }), 'pptx', 'a.pptx')).toBeUndefined()
  })

  it('answers undefined for bytes that are not the container the extension claims', () => {
    for (const conversion of ['xlsx', 'docx', 'pptx'] as const) {
      expect(convertPreview(text('not a zip'), conversion, `a.${conversion}`)).toBeUndefined()
    }
  })
})
