/**
 * Delimited text read as rows: quoting, separators, and the line breaks
 * exports carry.
 */
import { describe, expect, it } from 'vitest'
import { parseDelimited } from '../src/client/delimited.ts'

describe('parseDelimited', () => {
  it('splits fields and rows on the delimiter and the line break', () => {
    expect(parseDelimited('a,b\nc,d\n', ',')).toEqual([['a', 'b'], ['c', 'd']])
    expect(parseDelimited('a\tb\nc\td', '\t')).toEqual([['a', 'b'], ['c', 'd']])
  })

  it('reads CRLF and CR as one break each', () => {
    expect(parseDelimited('a,b\r\nc,d', ',')).toEqual([['a', 'b'], ['c', 'd']])
    expect(parseDelimited('a,b\rc,d', ',')).toEqual([['a', 'b'], ['c', 'd']])
  })

  it('keeps a quoted field whole, including delimiters and line breaks', () => {
    expect(parseDelimited('"a,b",c', ',')).toEqual([['a,b', 'c']])
    expect(parseDelimited('"line\nbreak",c', ',')).toEqual([['line\nbreak', 'c']])
  })

  it('unescapes a doubled quote inside a quoted field', () => {
    expect(parseDelimited('"say ""hi""",c', ',')).toEqual([['say "hi"', 'c']])
  })

  it('reads a quote that does not open a field as an ordinary character', () => {
    expect(parseDelimited('a"b,c', ',')).toEqual([['a"b', 'c']])
    expect(parseDelimited('a,b"', ',')).toEqual([['a', 'b"']])
  })

  it('keeps empty fields and an empty last field', () => {
    expect(parseDelimited('a,,c', ',')).toEqual([['a', '', 'c']])
    expect(parseDelimited('a,', ',')).toEqual([['a', '']])
  })

  it('answers no rows for an empty file, and one empty row for a bare break', () => {
    expect(parseDelimited('', ',')).toEqual([])
    expect(parseDelimited('\n', ',')).toEqual([['']])
  })

  it('keeps a quoted field open to the end when the file ends inside it', () => {
    expect(parseDelimited('"unfinished', ',')).toEqual([['unfinished']])
  })
})
