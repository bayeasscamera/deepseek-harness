/**
 * What the writer puts in the package: every part a reader needs, the
 * relationships that bind them, the layout each slide names, and text that
 * cannot break the XML it sits in.
 */
import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { buildPresentation, type Deck } from '../src/pptx.ts'

const DECK: Deck = {
  title: 'Rapport & suite',
  subtitle: 'Semaine 40',
  template: 'default',
  slides: [
    { layout: 'section', title: 'Chiffres clés' },
    { layout: 'bullets', title: 'Ventes', bullets: ['+12% vs S39', 'Pic le mardi'] },
    { layout: 'bullets', title: 'Vide' },
  ],
}

const AT = new Date('2026-10-03T12:00:00Z')

/** The package's parts, decoded as text. */
function partsOf(deck: Deck = DECK): Record<string, string> {
  const files = unzipSync(buildPresentation(deck, AT))
  return Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, strFromU8(bytes)]))
}

describe('buildPresentation', () => {
  it('paints each template\'s scheme, fonts, and background', () => {
    const dark = partsOf({ title: 'T', template: 'dark', slides: [] })
    expect(dark['ppt/theme/theme1.xml']).toContain('<a:lt1><a:srgbClr val="14181D"/></a:lt1>')
    expect(dark['ppt/theme/theme1.xml']).toContain('<a:dk1><a:srgbClr val="F0F3F6"/></a:dk1>')
    expect(dark['ppt/theme/theme1.xml']).toContain('name="DeepSeek Harness dark"')

    const print = partsOf({ title: 'T', template: 'print', slides: [] })
    expect(print['ppt/theme/theme1.xml']).toContain('<a:latin typeface="Georgia"/>')
    expect(print['ppt/theme/theme1.xml']).toContain('<a:accent1><a:srgbClr val="1A1A1A"/></a:accent1>')

    // Every template paints the master's background from the scheme's light slot.
    for (const template of ['default', 'dark', 'print'] as const) {
      expect(partsOf({ title: 'T', template, slides: [] })['ppt/slideMasters/slideMaster1.xml'])
        .toContain('<p:bg><p:bgPr><a:solidFill><a:schemeClr val="lt1"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>')
    }
  })

  it('draws a section heading in the template\'s accent', () => {
    const parts = partsOf({ title: 'T', template: 'dark', slides: [{ layout: 'section', title: 'Section' }] })
    expect(parts['ppt/slides/slide2.xml']).toContain('<a:solidFill><a:schemeClr val="accent1"/></a:solidFill>')
  })

  it('writes every part the presentation references, and nothing else', () => {
    expect(Object.keys(partsOf()).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'docProps/app.xml',
      'docProps/core.xml',
      'ppt/_rels/presentation.xml.rels',
      'ppt/presentation.xml',
      'ppt/slideLayouts/slideLayout1.xml',
      'ppt/slideLayouts/slideLayout2.xml',
      'ppt/slideLayouts/slideLayout3.xml',
      'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      'ppt/slideMasters/slideMaster1.xml',
      'ppt/slides/_rels/slide1.xml.rels',
      'ppt/slides/_rels/slide2.xml.rels',
      'ppt/slides/_rels/slide3.xml.rels',
      'ppt/slides/_rels/slide4.xml.rels',
      'ppt/slides/slide1.xml',
      'ppt/slides/slide2.xml',
      'ppt/slides/slide3.xml',
      'ppt/slides/slide4.xml',
      'ppt/theme/theme1.xml',
    ])
  })

  it('declares a content type for every slide, layout, and part it writes', () => {
    const types = partsOf()['[Content_Types].xml'] ?? ''
    expect(types).toContain('/ppt/slides/slide4.xml')
    expect(types).toContain('/ppt/slideLayouts/slideLayout3.xml')
    expect(types).toContain('/ppt/slideMasters/slideMaster1.xml')
    expect(types).toContain('/ppt/theme/theme1.xml')
    expect(types).toContain('/docProps/core.xml')
  })

  it('lists the title slide and every content slide in the presentation, with the master and the theme', () => {
    const presentation = partsOf()['ppt/presentation.xml'] ?? ''
    expect(presentation).toContain('<p:sldMasterId id="2147483648" r:id="rId1"/>')
    expect(presentation).toContain('<p:sldId id="256" r:id="rId2"/>')
    expect(presentation).toContain('<p:sldId id="259" r:id="rId5"/>')
    expect(presentation).toContain('<p:sldSz cx="12192000" cy="6858000" type="screen16x9"/>')
    const rels = partsOf()['ppt/_rels/presentation.xml.rels'] ?? ''
    expect(rels).toContain('Target="slideMasters/slideMaster1.xml"')
    expect(rels).toContain('Target="slides/slide4.xml"')
    expect(rels).toContain('Target="theme/theme1.xml"')
  })

  it('gives each slide the layout it names: title, section, then bullets', () => {
    const parts = partsOf()
    expect(parts['ppt/slides/_rels/slide1.xml.rels']).toContain('../slideLayouts/slideLayout1.xml')
    expect(parts['ppt/slides/_rels/slide2.xml.rels']).toContain('../slideLayouts/slideLayout2.xml')
    expect(parts['ppt/slides/_rels/slide3.xml.rels']).toContain('../slideLayouts/slideLayout3.xml')
    expect(parts['ppt/slides/_rels/slide4.xml.rels']).toContain('../slideLayouts/slideLayout3.xml')
  })

  it('draws the deck title and subtitle on the first slide, and each slide its own text', () => {
    const parts = partsOf()
    expect(parts['ppt/slides/slide1.xml']).toContain('type="ctrTitle"')
    expect(parts['ppt/slides/slide1.xml']).toContain('Rapport &amp; suite')
    expect(parts['ppt/slides/slide1.xml']).toContain('Semaine 40')
    expect(parts['ppt/slides/slide2.xml']).toContain('Chiffres clés')
    expect(parts['ppt/slides/slide3.xml']).toContain('+12% vs S39')
    expect(parts['ppt/slides/slide3.xml']).toContain('<a:buChar char="&#8226;"/>')
  })

  it('escapes text that would otherwise change the XML', () => {
    const parts = partsOf({ title: '<b>&"x"</b>', template: 'default', slides: [] })
    expect(parts['ppt/slides/slide1.xml']).toContain('&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;')
    expect(parts['ppt/slides/slide1.xml']).not.toContain('<b>')
  })

  it('holds one empty paragraph for a bullet slide with no bullets, and for a slide with no title', () => {
    const parts = partsOf({ title: 'T', template: 'default', slides: [{ layout: 'bullets', title: '' }] })
    expect(parts['ppt/slides/slide2.xml']).toContain('<a:p><a:endParaRPr lang="en-US" dirty="0"/></a:p>')
  })

  it('states the deck title and slide count in the document properties', () => {
    const parts = partsOf()
    expect(parts['docProps/core.xml']).toContain('<dc:title>Rapport &amp; suite</dc:title>')
    expect(parts['docProps/core.xml']).toContain('<dcterms:created xsi:type="dcterms:W3CDTF">2026-10-03T12:00:00Z</dcterms:created>')
    expect(parts['docProps/app.xml']).toContain('<Slides>4</Slides>')
  })

  it('produces the same bytes for the same deck and instant', () => {
    expect(buildPresentation(DECK, AT)).toEqual(buildPresentation(DECK, AT))
  })

  it('writes a deck with no content slides as its title slide alone', () => {
    const parts = partsOf({ title: 'Seule', template: 'default', slides: [] })
    expect(parts['ppt/slides/slide1.xml']).toBeDefined()
    expect(parts['ppt/slides/slide2.xml']).toBeUndefined()
    expect(parts['ppt/_rels/presentation.xml.rels']).toContain('rId3')
  })
})
