// @vitest-environment jsdom
/**
 * A Word document read as static HTML: the blocks a reader recognises, with
 * every piece of text escaped.
 */
import { describe, expect, it } from 'vitest'
import { documentHtml } from '../src/client/docx.ts'
import { readParts, type OoxmlParts } from '../src/client/ooxml.ts'
import { archive, wordDocument } from './ooxml-fixtures.client.ts'

/** The archive's parts, through the module under test's own reader. */
function partsOf(bytes: Uint8Array): OoxmlParts {
  const parts = readParts(bytes)
  if (parts === undefined) throw new Error('fixture is not a readable archive')
  return parts
}

describe('documentHtml', () => {
  it('reads paragraphs, heading styles, and runs with their emphasis', () => {
    const html = documentHtml(partsOf(wordDocument(
      '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Title</w:t></w:r></w:p>'
      + '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>italic</w:t></w:r>'
      + '<w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>plain</w:t></w:r><w:r><w:br/><w:t>after</w:t></w:r></w:p>',
    )))
    expect(html).toBe('<h2>Title</h2>\n<p><strong>bold</strong><em>italic</em>plain<br>after</p>')
  })

  it('reads a table, its cells holding their own paragraphs', () => {
    const html = documentHtml(partsOf(wordDocument(
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
    )))
    expect(html).toBe('<table><tr><td><p>a</p></td><td><p>b</p></td></tr></table>')
  })

  it('escapes text that would otherwise change the document', () => {
    const html = documentHtml(partsOf(wordDocument('<w:p><w:r><w:t>&lt;a href="x"&gt;&amp;</w:t></w:r></w:p>')))
    expect(html).toBe('<p>&lt;a href=&quot;x&quot;&gt;&amp;</p>')
  })

  it('drops an empty paragraph, a run with no text, and a body child that is not a block', () => {
    const html = documentHtml(partsOf(wordDocument('<w:p/><w:p><w:r><w:rPr><w:b/></w:rPr></w:r></w:p><w:sectPr/>')))
    expect(html).toBe('')
  })

  it('ignores a run child that is neither text nor a break, and an empty table', () => {
    const html = documentHtml(partsOf(wordDocument(
      '<w:p><w:r><w:drawing/></w:r><w:r><w:t>kept</w:t></w:r></w:p><w:tbl/>',
    )))
    expect(html).toBe('<p>kept</p>')
  })

  it('answers undefined when the document part or its body is absent', () => {
    expect(documentHtml(partsOf(archive({ 'word/styles.xml': '<styles/>' })))).toBeUndefined()
    expect(documentHtml(partsOf(archive({ 'word/document.xml': '<w:document xmlns:w="x"/>' })))).toBeUndefined()
  })
})
