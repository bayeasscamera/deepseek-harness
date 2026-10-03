/**
 * The ZIP container and XML reading shared by the OOXML previews.
 *
 * A `.docx`, `.xlsx`, or `.pptx` is a ZIP of XML parts. This module opens the
 * archive and hands out the parts by name; it never interprets them, and it
 * decodes text lazily so a part nobody reads (an embedded image, a theme) costs
 * nothing. A malformed archive answers `undefined` rather than throwing: the
 * caller turns that into the viewer's own failure line.
 */
// The browser subpath, not the bare specifier: the default export map answers
// a CJS bundle with fflate's Node build, which imports `module` and
// `worker_threads` and cannot load in a browser.
import { unzipSync } from 'fflate/browser'

/** One archive's parts by their path inside it, still compressed-shaped bytes. */
export type OoxmlParts = ReadonlyMap<string, Uint8Array>

/**
 * Open one OOXML container.
 * @param bytes - the file's whole content.
 * @returns the parts by name, or `undefined` when the bytes are not a readable ZIP.
 */
export function readParts(bytes: Uint8Array): OoxmlParts | undefined {
  try {
    return new Map(Object.entries(unzipSync(bytes)))
  } catch {
    // A file that is not a ZIP at all, or a truncated one: the preview has
    // nothing to draw, and the failure line says so.
    return undefined
  }
}

/**
 * Read one part as XML.
 * @param parts - the archive's parts.
 * @param name - the part's path inside the archive.
 * @returns the parsed document, or `undefined` when the part is absent or not XML.
 */
export function xmlPart(parts: OoxmlParts, name: string): Document | undefined {
  const bytes = parts.get(name)
  if (bytes === undefined) return undefined
  const document = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml')
  return document.getElementsByTagName('parsererror').length > 0 ? undefined : document
}

/**
 * Read one part as UTF-8 text.
 * @param parts - the archive's parts.
 * @param name - the part's path inside the archive.
 * @returns the decoded text, or `undefined` when the part is absent.
 */
export function textPart(parts: OoxmlParts, name: string): string | undefined {
  const bytes = parts.get(name)
  return bytes === undefined ? undefined : new TextDecoder().decode(bytes)
}

/**
 * The elements one qualified tag names, in document order.
 *
 * OOXML writes its tags with a prefix (`w:p`, `a:t`); `getElementsByTagName`
 * matches that literal qualified name, which is exactly what the parts carry.
 * @param root - the document or element to search.
 * @param tag - the qualified tag name.
 * @returns the matching elements.
 */
export function elements(root: Document | Element, tag: string): Element[] {
  return Array.from(root.getElementsByTagName(tag))
}

/**
 * The text of the direct children one qualified tag names, joined.
 *
 * Used for the containers whose text sits in repeated leaves (`w:t`, `a:t`),
 * where every descendant of the container is one run of the same string.
 * @param root - the element to read.
 * @param tag - the qualified tag name.
 * @returns the concatenated text, in document order.
 */
export function joinedText(root: Document | Element, tag: string): string {
  return elements(root, tag).map(element => element.textContent).join('')
}

/**
 * Escape the five characters that would otherwise change an HTML document's structure.
 * @param text - the text to escape.
 * @returns the text with those characters replaced by their entities.
 */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
