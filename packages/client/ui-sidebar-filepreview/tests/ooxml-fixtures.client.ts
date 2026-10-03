/**
 * Minimal OOXML containers for the parser specs.
 *
 * Each builder writes exactly the parts the preview reads, so a spec states the
 * mapping it pins rather than reproducing a real office file. The namespaces
 * are declared because an XML parser rejects a prefix it cannot resolve.
 */
import { zipSync } from 'fflate'

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const RELATIONSHIPS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/** One part's bytes, from its text. */
export function str(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/**
 * One ZIP container from named text parts.
 * @param parts - part path to its text.
 * @returns the archive's bytes.
 */
export function archive(parts: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(parts).map(([name, text]) => [name, str(text)])))
}

/** One workbook holding the given worksheet rows. */
export function workbook(rows: string, sheets = '<sheet name="Data" sheetId="1" r:id="rId1"/>'): Uint8Array {
  return archive({
    'xl/workbook.xml': `<workbook xmlns:r="${RELATIONSHIPS}"><sheets>${sheets}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>Name</t></si><si><t>Ada</t></si></sst>',
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${rows}</sheetData></worksheet>`,
  })
}

/** One Word document holding the given body. */
export function wordDocument(body: string): Uint8Array {
  return archive({ 'word/document.xml': `<w:document xmlns:w="${WORD}"><w:body>${body}</w:body></w:document>` })
}

/** One deck holding the given slides, numbered as written. */
export function deck(slides: Record<number, string>): Uint8Array {
  return archive(Object.fromEntries(Object.entries(slides).map(([number, body]) => [
    `ppt/slides/slide${number}.xml`,
    `<sld xmlns:a="${DRAWING}">${body}</sld>`,
  ])))
}

/** One paragraph of drawing text, as a deck stores it. */
export function drawingParagraph(text: string): string {
  return `<a:p><a:r><a:t>${text}</a:t></a:r></a:p>`
}
