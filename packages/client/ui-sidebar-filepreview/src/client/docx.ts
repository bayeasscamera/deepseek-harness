/**
 * A Word document read as static HTML.
 *
 * The preview keeps what a reader needs to recognise the document — paragraph
 * breaks, headings, bold and italic runs, tables — and drops what only a full
 * layout engine could honour: numbering, styles, images, footnotes, and
 * positioning. Every piece of text is escaped, so the result is safe to hand to
 * a frame that runs no scripts.
 */
import { elements, escapeHtml, xmlPart, type OoxmlParts } from './ooxml.ts'

/** Heading levels the paragraph style name may select. */
const HEADING = /^Heading([1-6])$/u

/**
 * One run's text with its emphasis.
 * @param run - the `w:r` element.
 * @returns the escaped run, wrapped in its emphasis tags.
 */
function runHtml(run: Element): string {
  const properties = elements(run, 'w:rPr')[0]
  const on = (tag: string): boolean => {
    const property = properties === undefined ? undefined : elements(properties, tag)[0]
    return property !== undefined && property.getAttribute('w:val') !== '0'
  }
  let html = ''
  for (const child of Array.from(run.children)) {
    if (child.tagName === 'w:t') html += escapeHtml(child.textContent)
    else if (child.tagName === 'w:br') html += '<br>'
  }
  if (html === '') return ''
  if (on('w:i')) html = `<em>${html}</em>`
  if (on('w:b')) html = `<strong>${html}</strong>`
  return html
}

/**
 * One paragraph, as a heading when its style names one.
 * @param paragraph - the `w:p` element.
 * @returns the paragraph's HTML.
 */
function paragraphHtml(paragraph: Element): string {
  const style = elements(paragraph, 'w:pStyle')[0]?.getAttribute('w:val') ?? ''
  const heading = HEADING.exec(style)
  const tag = heading === null ? 'p' : `h${heading[1]}`
  const inner = elements(paragraph, 'w:r').map(runHtml).join('')
  return inner === '' ? '' : `<${tag}>${inner}</${tag}>`
}

/**
 * One table, its cells holding their own paragraphs.
 * @param table - the `w:tbl` element.
 * @returns the table's HTML.
 */
function tableHtml(table: Element): string {
  const rows = elements(table, 'w:tr').map((row) => {
    const cells = elements(row, 'w:tc').map((cell) => {
      const inner = elements(cell, 'w:p').map(paragraphHtml).join('')
      return `<td>${inner}</td>`
    }).join('')
    return `<tr>${cells}</tr>`
  }).join('')
  return rows === '' ? '' : `<table>${rows}</table>`
}

/**
 * The document's body as an HTML fragment.
 * @param parts - the archive's parts.
 * @returns the fragment, or `undefined` when the document's own part is absent.
 */
export function documentHtml(parts: OoxmlParts): string | undefined {
  const document = xmlPart(parts, 'word/document.xml')
  if (document === undefined) return undefined
  const body = elements(document, 'w:body')[0]
  if (body === undefined) return undefined
  return Array.from(body.children)
    .map(child => child.tagName === 'w:p' ? paragraphHtml(child) : child.tagName === 'w:tbl' ? tableHtml(child) : '')
    .filter(block => block !== '')
    .join('\n')
}
