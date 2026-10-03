/**
 * Which renderer and conversion each extension resolves to, and what an unknown
 * one gets.
 */
import { describe, expect, it } from 'vitest'
import { PREVIEW_EXTENSIONS, previewFormatOf } from '../src/client/media.ts'

describe('previewFormatOf', () => {
  it.each([
    ['logo.png', { renderer: 'image', conversion: 'blob', mediaType: 'image/png' }],
    ['photo.JPG', { renderer: 'image', conversion: 'blob', mediaType: 'image/jpeg' }],
    ['photo.jpeg', { renderer: 'image', conversion: 'blob', mediaType: 'image/jpeg' }],
    ['anim.gif', { renderer: 'image', conversion: 'blob', mediaType: 'image/gif' }],
    ['shot.webp', { renderer: 'image', conversion: 'blob', mediaType: 'image/webp' }],
    ['shot.avif', { renderer: 'image', conversion: 'blob', mediaType: 'image/avif' }],
    ['icon.bmp', { renderer: 'image', conversion: 'blob', mediaType: 'image/bmp' }],
    ['favicon.ico', { renderer: 'image', conversion: 'blob', mediaType: 'image/x-icon' }],
    ['drawing.svg', { renderer: 'image', conversion: 'blob', mediaType: 'image/svg+xml' }],
    ['report.html', { renderer: 'html', conversion: 'blob', mediaType: 'text/html' }],
    ['report.HTM', { renderer: 'html', conversion: 'blob', mediaType: 'text/html' }],
    ['paper.pdf', { renderer: 'pdf', conversion: 'blob', mediaType: 'application/pdf' }],
    ['data.csv', { renderer: 'table', conversion: 'csv' }],
    ['data.tsv', { renderer: 'table', conversion: 'tsv' }],
    ['book.xlsx', { renderer: 'table', conversion: 'xlsx' }],
    ['letter.docx', { renderer: 'document', conversion: 'docx' }],
    ['deck.pptx', { renderer: 'document', conversion: 'pptx' }],
  ])('classifies %s', (name, expected) => {
    expect(previewFormatOf(`deep/dir/${name}`)).toEqual(expected)
  })

  it('reads the extension, not a dot inside a directory name', () => {
    expect(previewFormatOf('dir.v2/README')).toBeUndefined()
  })

  it('refuses a dotless name and a dotfile', () => {
    expect(previewFormatOf('Makefile')).toBeUndefined()
    expect(previewFormatOf('.env')).toBeUndefined()
    expect(previewFormatOf('')).toBeUndefined()
  })

  it('refuses an extension this package does not render', () => {
    expect(previewFormatOf('notes.txt')).toBeUndefined()
    expect(previewFormatOf('archive.tar.gz')).toBeUndefined()
  })

  it('publishes exactly the extensions its classifications cover', () => {
    expect(PREVIEW_EXTENSIONS).toEqual(expect.arrayContaining([
      'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg',
      'html', 'htm', 'pdf', 'csv', 'tsv', 'xlsx', 'docx', 'pptx',
    ]))
    expect(Object.isFrozen(PREVIEW_EXTENSIONS)).toBe(true)
  })
})
