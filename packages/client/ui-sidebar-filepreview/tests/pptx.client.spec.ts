// @vitest-environment jsdom
/**
 * A deck read as slide text: slides in their own order, paragraphs joined from
 * their runs, and nothing drawn for a slide the file cannot give.
 */
import { describe, expect, it } from 'vitest'
import { readParts, type OoxmlParts } from '../src/client/ooxml.ts'
import { deckSlides } from '../src/client/pptx.ts'
import { archive, deck, drawingParagraph } from './ooxml-fixtures.client.ts'

/** The archive's parts, through the module under test's own reader. */
function partsOf(bytes: Uint8Array): OoxmlParts {
  const parts = readParts(bytes)
  if (parts === undefined) throw new Error('fixture is not a readable archive')
  return parts
}

describe('deckSlides', () => {
  it('reads the slides in numeric order, joining each paragraph from its runs', () => {
    const slides = deckSlides(partsOf(deck({
      10: '<a:p><a:r><a:t>Last</a:t></a:r></a:p>',
      2: '<a:p><a:r><a:t>First </a:t></a:r><a:r><a:t>slide</a:t></a:r></a:p>',
    })))
    expect(slides).toEqual([['First slide'], ['Last']])
  })

  it('keeps a slide that holds no text, and drops empty paragraphs', () => {
    const slides = deckSlides(partsOf(deck({
      1: '<a:p><a:r><a:t>  </a:t></a:r></a:p><a:p/>',
      2: drawingParagraph('Second'),
    })))
    expect(slides).toEqual([[], ['Second']])
  })

  it('skips a slide part that is not XML', () => {
    const bytes = archive({
      'ppt/slides/slide1.xml': '<a:p><a:t>broken',
      'ppt/slides/slide2.xml': '<sld xmlns:a="x"><a:p><a:r><a:t>ok</a:t></a:r></a:p></sld>',
    })
    expect(deckSlides(partsOf(bytes))).toEqual([['ok']])
  })

  it('answers undefined for a deck with no readable slide', () => {
    expect(deckSlides(partsOf(archive({ 'ppt/presentation.xml': '<p:presentation/>' })))).toBeUndefined()
    expect(deckSlides(partsOf(archive({ 'ppt/slides/slide1.xml': '<not-xml' })))).toBeUndefined()
  })
})
