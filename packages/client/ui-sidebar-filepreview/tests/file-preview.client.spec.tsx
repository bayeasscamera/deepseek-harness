// @vitest-environment jsdom
/**
 * What the body draws from its bucket and the file's metadata, and what its two
 * controls do: the header's reload and the failure line's retry both reload, and
 * a tab that already holds content draws it without reading again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { FilePreview } from '../src/client/FilePreview.tsx'
import { ADDRESS, PATH, TAB_ID, harness, page, pageOfBytes } from './fixtures.client.ts'
import type { Target } from './fixtures.client.ts'
import { deck, drawingParagraph, wordDocument } from './ooxml-fixtures.client.ts'

const HTML_TARGET: Target = { address: 'dsh-resource://file/session/s-1/work/report.html', path: 'work/report.html', title: 'report.html' }
const PDF_TARGET: Target = { address: 'dsh-resource://file/session/s-1/work/paper.pdf', path: 'work/paper.pdf', title: 'paper.pdf' }
const CSV_TARGET: Target = { address: 'dsh-resource://file/session/s-1/work/data.csv', path: 'work/data.csv', title: 'data.csv' }
const DOCX_TARGET: Target = { address: 'dsh-resource://file/session/s-1/work/letter.docx', path: 'work/letter.docx', title: 'letter.docx' }
const PPTX_TARGET: Target = { address: 'dsh-resource://file/session/s-1/work/deck.pptx', path: 'work/deck.pptx', title: 'deck.pptx' }

beforeEach(() => {
  if (typeof URL.createObjectURL !== 'function') {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: () => '' })
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: () => {} })
  }
  let count = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:mock-${count++}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** Flush the load's promises, then React's work. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await new Promise((resolve) => { setTimeout(resolve, 0) })
  })
}

describe('FilePreview — drawing the file', () => {
  it('shows the loading line first, then the picture with the tab title as its alternative text', async () => {
    const h = harness({ 0: page(0, btoa('hello'), true) })
    const view = render(<FilePreview {...h.props()} />)
    expect(view.container.querySelector('[data-filepreview-loading]')).not.toBeNull()
    expect(view.container.querySelector('[data-filepreview-state="pending"]')).not.toBeNull()
    await settle()
    expect(view.container.querySelector('[data-filepreview-state="image"]')).not.toBeNull()
    const image = view.container.querySelector('[data-filepreview-media="image"]')
    expect(image?.getAttribute('src')).toBe('blob:mock-0')
    expect(image?.getAttribute('alt')).toBe('picture.png')
  })

  it('draws an HTML page in a scripts-only sandbox', async () => {
    const h = harness({ 0: page(0, btoa('<h1>hi</h1>'), true) }, HTML_TARGET)
    const view = render(<FilePreview {...h.props()} />)
    await settle()
    const frame = view.container.querySelector('[data-filepreview-media="html"]')
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame?.getAttribute('src')).toBe('blob:mock-0')
    expect(frame?.getAttribute('title')).toBe('report.html')
    expect(view.container.querySelector('[data-filepreview-state="html"]')).not.toBeNull()
  })

  it('draws a PDF in the embed element with its media type', async () => {
    const h = harness({ 0: page(0, btoa('%PDF-1.4'), true) }, PDF_TARGET)
    const view = render(<FilePreview {...h.props()} />)
    await settle()
    const embed = view.container.querySelector('[data-filepreview-media="pdf"]')
    expect(embed?.getAttribute('type')).toBe('application/pdf')
    expect(view.container.querySelector('[data-filepreview-state="pdf"]')).not.toBeNull()
  })

  it('draws a delimited file as a table, its first row as the header', async () => {
    const h = harness({ 0: page(0, btoa('name,qty\nada,2\n'), true) }, CSV_TARGET)
    const view = render(<FilePreview {...h.props()} />)
    await settle()
    expect(view.container.querySelector('[data-filepreview-state="table"]')).not.toBeNull()
    expect(view.container.querySelector('[data-filepreview-sheet]')?.getAttribute('data-filepreview-sheet')).toBe('data.csv')
    expect(Array.from(view.container.querySelectorAll('th'), cell => cell.textContent)).toEqual(['name', 'qty'])
    expect(Array.from(view.container.querySelectorAll('td'), cell => cell.textContent)).toEqual(['ada', '2'])
  })

  it('says when a table was capped', async () => {
    const rows = Array.from({ length: 501 }, () => 'a,b').join('\n')
    const h = harness({ 0: page(0, btoa(rows), true) }, CSV_TARGET)
    const view = render(<FilePreview {...h.props()} />)
    await settle()
    expect(view.container.querySelector('[data-filepreview-truncated]')?.textContent).toContain('table.truncated')
  })

  it('draws a Word document in a frame that runs no scripts', async () => {
    const h = harness({ 0: pageOfBytes(0, wordDocument('<w:p><w:r><w:t>hi</w:t></w:r></w:p>')) }, DOCX_TARGET)
    const view = render(<FilePreview {...h.props()} />)
    await settle()
    const frame = view.container.querySelector('[data-filepreview-media="document"]')
    expect(frame?.getAttribute('sandbox')).toBe('')
    expect(frame?.getAttribute('srcdoc')).toContain('<p>hi</p>')
    expect(view.container.querySelector('[data-filepreview-state="document"]')).not.toBeNull()
  })

  it('says when a document holds no readable text', async () => {
    const h = harness({ 0: pageOfBytes(0, wordDocument('<w:p/>')) }, DOCX_TARGET)
    const view = render(<FilePreview {...h.props()} />)
    await settle()
    expect(view.container.querySelector('[data-filepreview-empty]')?.textContent).toContain('document.empty')
    expect(view.container.querySelector('[data-filepreview-media="document"]')).toBeNull()
  })

  it('draws a deck as numbered slides', async () => {
    const h = harness({ 0: pageOfBytes(0, deck({ 1: drawingParagraph('Title'), 2: drawingParagraph('Second') })) }, PPTX_TARGET)
    const view = render(<FilePreview {...h.props()} />)
    await settle()
    const frame = view.container.querySelector('[data-filepreview-media="slides"]')
    expect(frame?.getAttribute('sandbox')).toBe('')
    expect(frame?.getAttribute('srcdoc')).toContain('slide(n=1)')
    expect(frame?.getAttribute('srcdoc')).toContain('<p>Second</p>')
    expect(view.container.querySelector('[data-filepreview-state="document"]')).not.toBeNull()
  })

  it('draws a bucket that already holds content without reading again', async () => {
    const h = harness()
    act(() => {
      h.instance.actions.loading(TAB_ID, { renderer: 'image', conversion: 'blob', mediaType: 'image/png' })
      h.instance.actions.loaded(TAB_ID, { kind: 'url', url: 'blob:seeded' }, 12)
    })
    const view = render(<FilePreview {...h.props()} />)
    await settle()
    expect(h.read).not.toHaveBeenCalled()
    expect(view.container.querySelector('[data-filepreview-media="image"]')?.getAttribute('src')).toBe('blob:seeded')
  })

  it('stays pending when a bucket holds a URL without a blob format', async () => {
    const h = harness()
    act(() => { h.instance.actions.loaded(TAB_ID, { kind: 'url', url: 'blob:odd' }, 3) })
    const view = render(<FilePreview {...h.props()} />)
    await settle()
    expect(view.container.querySelector('[data-filepreview-state="pending"]')).not.toBeNull()
    expect(view.container.querySelector('[data-filepreview-loading]')).not.toBeNull()
  })
})

describe('FilePreview — the file\'s metadata', () => {
  it('shows the Host absolute path in the header and in its tooltip', async () => {
    const h = harness({ 0: page(0, btoa('hello'), true) })
    const view = render(<FilePreview {...h.props()} />)
    await settle()
    const path = view.container.querySelector('[data-filepreview-path]')
    expect(path?.textContent).toBe('/host/project/work/picture.png')
    expect(path?.getAttribute('title')).toBe('/host/project/work/picture.png')
  })

  it('falls back to the address path while metadata has no value', async () => {
    const h = harness({ 0: page(0, btoa('hello'), true) })
    h.setMeta(undefined)
    const view = render(<FilePreview {...h.props()} />)
    await settle()
    expect(view.container.querySelector('[data-filepreview-path]')?.textContent).toBe(PATH)
  })
})

describe('FilePreview — failures and controls', () => {
  it('says why the load failed and retries it from the button', async () => {
    const h = harness()
    const view = render(<FilePreview {...h.props()} />)
    await settle()
    const failedLine = view.container.querySelector('[data-filepreview-failed="workspace-file/not-found"]')
    expect(failedLine?.textContent).toContain('error.notFound')
    expect(view.container.querySelector('[data-filepreview-state="failed"]')).not.toBeNull()
    h.script(0, page(0, btoa('hello'), true))
    fireEvent.click(view.container.querySelector('[data-filepreview-retry]') as HTMLButtonElement)
    await settle()
    expect(view.container.querySelector('[data-filepreview-media="image"]')).not.toBeNull()
    expect(h.read).toHaveBeenCalledTimes(2)
  })

  it('reloads from the header control', async () => {
    const h = harness({ 0: page(0, btoa('hello'), true) })
    const view = render(<FilePreview {...h.props()} />)
    await settle()
    fireEvent.click(view.container.querySelector('[data-filepreview-tool="reload"]') as HTMLButtonElement)
    await settle()
    expect(h.read).toHaveBeenCalledTimes(2)
    expect(h.controller.signal.aborted).toBe(false)
  })

  it('keeps the copy address on the pane for the record', async () => {
    const h = harness({ 0: page(0, btoa('hello'), true) })
    const view = render(<FilePreview {...h.props()} />)
    await settle()
    expect(view.container.querySelector('[data-filepreview-url]')?.getAttribute('data-filepreview-url')).toBe(ADDRESS)
  })
})
