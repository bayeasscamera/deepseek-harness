/**
 * A presentation's slides read as text lines.
 *
 * A deck's value in a preview is its words in order, so each slide yields its
 * paragraphs as they are stored and nothing else: shapes, positions, themes,
 * notes, and speaker layout are dropped. The slide number the reader sees is
 * the renderer's to write, because it is copy.
 */
import { elements, joinedText, xmlPart, type OoxmlParts } from './ooxml.ts'

/** One slide part's path, from which the slide number is read. */
const SLIDE = /^ppt\/slides\/slide(\d+)\.xml$/u

/**
 * Every slide's paragraphs, in slide order.
 * @param parts - the archive's parts.
 * @returns one entry per slide holding its non-empty paragraphs, or `undefined` when the deck has no readable slide.
 */
export function deckSlides(parts: OoxmlParts): string[][] | undefined {
  const slideParts = Array.from(parts.keys())
    .map(name => ({ name, number: Number(SLIDE.exec(name)?.[1] ?? Number.NaN) }))
    .filter(slide => !Number.isNaN(slide.number))
    .sort((left, right) => left.number - right.number)
  const slides: string[][] = []
  for (const slide of slideParts) {
    const document = xmlPart(parts, slide.name)
    if (document === undefined) continue
    const paragraphs = elements(document, 'a:p')
      .map(paragraph => joinedText(paragraph, 'a:t').trim())
      .filter(text => text !== '')
    slides.push(paragraphs)
  }
  return slides.length === 0 ? undefined : slides
}
