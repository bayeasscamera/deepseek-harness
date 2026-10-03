// @vitest-environment jsdom
/**
 * A workbook read as sheets of rows: value types resolved, columns placed by
 * their reference, and the caps reported instead of hiding cells.
 */
import { describe, expect, it } from 'vitest'
import { readParts, type OoxmlParts } from '../src/client/ooxml.ts'
import { MAX_SHEET_COLUMNS, MAX_SHEET_ROWS, parseWorkbook } from '../src/client/xlsx.ts'
import { archive, str, workbook } from './ooxml-fixtures.client.ts'

/** The archive's parts, through the module under test's own reader. */
function partsOf(bytes: Uint8Array): OoxmlParts {
  const parts = readParts(bytes)
  if (parts === undefined) throw new Error('fixture is not a readable archive')
  return parts
}

/** The spreadsheet column name for a 1-based index. */
function columnName(index: number): string {
  let name = ''
  for (let value = index; value > 0; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name
  }
  return name
}

describe('parseWorkbook', () => {
  it('resolves shared and inline strings, numbers, and booleans, placing cells by reference', () => {
    const bytes = workbook(
      '<row r="1"><c r="A1" t="s"><v>1</v></c><c r="B1"><v>42</v></c><c r="C1" t="b"><v>1</v></c><c r="E1" t="inlineStr"><is><t>inline</t></is></c></row>',
    )
    expect(parseWorkbook(partsOf(bytes))).toEqual([
      { name: 'Data', rows: [['Ada', '42', 'TRUE', '', 'inline']], truncated: false },
    ])
  })

  it('appends a cell without a reference after the cells already placed', () => {
    const sheets = parseWorkbook(partsOf(workbook('<row><c><v>1</v></c><c><v>2</v></c></row>')))
    expect(sheets?.[0]?.rows).toEqual([['1', '2']])
  })

  it('reads a boolean false, and an unknown shared-string index as empty', () => {
    const sheets = parseWorkbook(partsOf(workbook('<row><c t="b"><v>0</v></c><c t="s"><v>99</v></c></row>')))
    expect(sheets?.[0]?.rows).toEqual([['FALSE', '']])
  })

  it('reports a sheet capped by rows, and one capped by columns', () => {
    const rows = Array.from({ length: MAX_SHEET_ROWS + 1 }, (_, index) => `<row><c><v>${index}</v></c></row>`).join('')
    const capped = parseWorkbook(partsOf(workbook(rows)))?.[0]
    expect(capped?.truncated).toBe(true)
    expect(capped?.rows).toHaveLength(MAX_SHEET_ROWS)

    const wide = `<row>${Array.from({ length: MAX_SHEET_COLUMNS + 1 }, (_, index) => `<c r="${columnName(index + 1)}1"><v>${index}</v></c>`).join('')}</row>`
    const sheet = parseWorkbook(partsOf(workbook(wide)))?.[0]
    expect(sheet?.truncated).toBe(true)
    expect(sheet?.rows[0]).toHaveLength(MAX_SHEET_COLUMNS)
  })

  it('skips a sheet whose relationship or worksheet part is missing', () => {
    const noRelationship = workbook(
      '<row><c><v>1</v></c></row>',
      '<sheet name="Data" sheetId="1" r:id="rId1"/><sheet name="Gone" sheetId="2" r:id="rId9"/>',
    )
    expect(parseWorkbook(partsOf(noRelationship))?.map(sheet => sheet.name)).toEqual(['Data'])

    const noWorksheet = archive({
      'xl/workbook.xml': '<workbook xmlns:r="urn:r"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/gone.xml"/></Relationships>',
    })
    expect(parseWorkbook(partsOf(noWorksheet))).toBeUndefined()
  })

  it('reads a sheet with no reference against a relationship with no id, and names an unnamed sheet', () => {
    const bytes = archive({
      'xl/workbook.xml': '<workbook><sheets><sheet sheetId="1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c><v>7</v></c></row></sheetData></worksheet>',
    })
    expect(parseWorkbook(partsOf(bytes))).toEqual([{ name: '', rows: [['7']], truncated: false }])
  })

  it('skips a relationship with no target, and keeps reading the next sheet', () => {
    const bytes = archive({
      'xl/workbook.xml': '<workbook xmlns:r="urn:r"><sheets><sheet name="Empty" sheetId="1" r:id="rId1"/><sheet name="Data" sheetId="2" r:id="rId2"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
      'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row><c><v>1</v></c></row></sheetData></worksheet>',
    })
    expect(parseWorkbook(partsOf(bytes))?.map(sheet => sheet.name)).toEqual(['Data'])
  })

  it('answers undefined when the workbook or its relationships are absent', () => {
    expect(parseWorkbook(partsOf(archive({ 'xl/sharedStrings.xml': '<sst/>' })))).toBeUndefined()
  })

  it('reads a workbook without shared strings, and one whose target is spelled from the archive root', () => {
    const bytes = archive({
      'xl/workbook.xml': '<workbook xmlns:r="urn:r"><sheets><sheet name="Only" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="/xl/worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c t="s"><v>0</v></c></row></sheetData></worksheet>',
    })
    expect(parseWorkbook(partsOf(bytes))).toEqual([{ name: 'Only', rows: [['']], truncated: false }])
  })

  it('answers undefined for an archive that is not a workbook at all', () => {
    expect(parseWorkbook(partsOf(archive({ 'xl/styles.xml': '<styleSheet/>' })))).toBeUndefined()
    expect(readParts(str('nope'))).toBeUndefined()
  })
})
