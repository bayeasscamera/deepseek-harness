/**
 * Delimited text read as rows: the RFC 4180 rules a spreadsheet export follows.
 *
 * Quoted fields carry the delimiter, line breaks, and doubled quotes; everything
 * else ends at the next delimiter or line break. A trailing line break ends the
 * last row rather than opening an empty one, and CRLF and CR are accepted beside
 * LF because exports carry all three.
 */

/** One row's cells, in file order. */
export type Row = readonly string[]

/**
 * Split delimited text into rows of cells.
 * @param text - the file's decoded text.
 * @param delimiter - the field separator, one character.
 * @returns the rows in file order; an empty file yields no rows.
 */
export function parseDelimited(text: string, delimiter: string): Row[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text.charAt(index)
    if (quoted) {
      if (character !== '"') {
        field += character
        continue
      }
      if (text[index + 1] === '"') {
        field += '"'
        index += 1
        continue
      }
      quoted = false
      continue
    }
    if (character === '"' && field === '') {
      quoted = true
      continue
    }
    if (character === delimiter) {
      row.push(field)
      field = ''
      continue
    }
    if (character === '\n' || character === '\r') {
      // A CRLF pair is one break; the LF branch consumes the CR before it.
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      continue
    }
    field += character
  }
  // A trailing line break already closed its row; anything else ends the last one.
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}
