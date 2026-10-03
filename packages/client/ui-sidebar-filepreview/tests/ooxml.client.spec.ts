// @vitest-environment jsdom
/**
 * The ZIP and XML reading the OOXML previews share: parts by name, decoded on
 * demand, and `undefined` — never a throw — for bytes that are not an archive
 * or not XML.
 */
import { describe, expect, it } from 'vitest'
import { elements, escapeHtml, joinedText, readParts, textPart, xmlPart } from '../src/client/ooxml.ts'
import { archive, str } from './ooxml-fixtures.client.ts'

describe('readParts', () => {
  it('opens a ZIP and keeps its parts by name', () => {
    const parts = readParts(archive({ 'a.xml': '<a/>', 'dir/b.xml': '<b/>' }))
    expect(parts).toBeDefined()
    expect(Array.from(parts?.keys() ?? [])).toEqual(['a.xml', 'dir/b.xml'])
  })

  it('answers undefined for bytes that are not a readable archive', () => {
    expect(readParts(str('not a zip'))).toBeUndefined()
    expect(readParts(new Uint8Array())).toBeUndefined()
  })
})

describe('xmlPart', () => {
  it('parses one part', () => {
    const parts = readParts(archive({ 'a.xml': '<root><child>x</child></root>' }))
    expect(xmlPart(parts as never, 'a.xml')?.documentElement.tagName).toBe('root')
  })

  it('answers undefined for an absent part', () => {
    const parts = readParts(archive({ 'a.xml': '<root/>' }))
    expect(xmlPart(parts as never, 'missing.xml')).toBeUndefined()
  })

  it('answers undefined for a part that is not XML', () => {
    const parts = readParts(archive({ 'a.xml': '<root><unclosed></root>' }))
    expect(xmlPart(parts as never, 'a.xml')).toBeUndefined()
  })
})

describe('textPart', () => {
  it('decodes one part and answers undefined for an absent one', () => {
    const parts = readParts(archive({ 'a.txt': 'hello' }))
    expect(textPart(parts as never, 'a.txt')).toBe('hello')
    expect(textPart(parts as never, 'b.txt')).toBeUndefined()
  })
})

describe('elements and joinedText', () => {
  const document = new DOMParser().parseFromString(
    '<r xmlns:w="urn:w"><w:p><w:t>a</w:t><w:t>b</w:t></w:p><w:p><w:t>c</w:t></w:p></r>',
    'application/xml',
  )

  it('returns the elements one qualified tag names, in document order', () => {
    expect(elements(document, 'w:p')).toHaveLength(2)
    expect(elements(document, 'w:t')).toHaveLength(3)
    expect(elements(document, 'nope')).toEqual([])
  })

  it('joins the text under one element', () => {
    expect(joinedText(elements(document, 'w:p')[0] as Element, 'w:t')).toBe('ab')
    expect(joinedText(elements(document, 'w:p')[0] as Element, 'nope')).toBe('')
  })

  it('reads an element with no text as an empty string', () => {
    const empty = new DOMParser().parseFromString('<r xmlns:w="urn:w"><w:t/></r>', 'application/xml')
    expect(joinedText(elements(empty, 'w:t')[0] as Element, 'w:t')).toBe('')
  })
})

describe('escapeHtml', () => {
  it('escapes the five structural characters', () => {
    expect(escapeHtml('<a href="x" title=\'y\'>&</a>'))
      .toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;')
  })
})
