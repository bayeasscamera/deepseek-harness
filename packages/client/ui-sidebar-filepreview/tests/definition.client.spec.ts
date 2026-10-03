/**
 * What the `preview` type claims, and how it yields.
 *
 * Routing is exercised through the real registry, because "builtin above
 * fallback" means whatever the registry's ranking means by it: a picture goes
 * to this type, and every other file still lands in the text viewer.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { PREVIEW_ID, PREVIEW_KIND, basenameOf, previewDefinition } from '../src/client/definition.ts'

describe('basenameOf', () => {
  it('decodes the last segment, so an escaped name reads as itself', () => {
    expect(basenameOf('dsh-resource://file/session/s-1/work/notes/a%20b%23c.png')).toBe('a b#c.png')
  })

  it('falls back to the whole address when there is no last segment', () => {
    expect(basenameOf('dsh-resource://file/session/s-1/')).toBe('dsh-resource://file/session/s-1/')
  })

  it('keeps a malformed percent escape as it is rather than refusing the address', () => {
    expect(basenameOf('dsh-resource://file/session/s-1/work/%E0%A4%A')).toBe('%E0%A4%A')
  })
})

describe('previewDefinition', () => {
  it('claims the rendered extensions at the builtin band, titled by basename', () => {
    const definition = previewDefinition()
    expect(definition.id).toBe(PREVIEW_ID)
    expect(definition.kind).toBe(PREVIEW_KIND)
    expect(definition.priority).toBe('builtin')
    expect(definition.patterns).toEqual(expect.arrayContaining(['*.png', '*.html', '*.pdf']))
    expect(definition.patterns).not.toContain('*')
    expect(definition.title('dsh-resource://file/session/s-1/work/picture.png')).toBe('picture.png')
    expect(definition.canOpen?.('dsh-resource://file/session/s-1/work/picture.png')).toBe(true)
    expect(definition.canOpen?.('dsh-resource://file/absolute/home/me/a.pdf')).toBe(true)
    expect(definition.canOpen?.('dsh-resource://file/shared/team/a.png')).toBe(false)
    expect(definition.canOpen?.('dsh-resource://file/session')).toBe(false)
  })
})

describe('preview type in the registry', () => {
  /** A registry holding this type, plus a stand-in fallback of the same shape the text viewer registers. */
  function registry() {
    const tabs = new SidebarRightTabRegistry(new Context())
    tabs.register(previewDefinition())
    tabs.register({
      id: 'test/text', kind: 'text', patterns: ['dsh-resource://file/**'], priority: 'fallback',
      canOpen: () => true, title: () => 'text',
    })
    return tabs
  }

  it('takes the addresses it renders, in either scope and at any depth', () => {
    const tabs = registry()
    for (const address of [
      'dsh-resource://file/session/s-1/work/picture.png',
      'dsh-resource://file/session/s-1/deep/er/report.html',
      'dsh-resource://file/session/s-1/paper.pdf',
      'dsh-resource://file/absolute/home/me/photo.jpeg',
    ]) {
      expect(tabs.claim(address).kind).toBe(PREVIEW_KIND)
    }
  })

  it('leaves every other file to the fallback type', () => {
    const tabs = registry()
    for (const address of [
      'dsh-resource://file/session/s-1/work/notes.md',
      'dsh-resource://file/session/s-1/work/logo.txt',
      'dsh-resource://file/session/s-1/w/.env',
    ]) {
      expect(tabs.claim(address).kind).toBe('text')
    }
  })

  it('refuses a file address in no known scope at claim time, named or ranked', () => {
    const tabs = registry()
    const shared = 'dsh-resource://file/shared/team/picture.png'
    expect(tabs.candidates(shared).map(type => type.kind)).toEqual(['text'])
    expect(() => tabs.claim(shared, PREVIEW_KIND)).toThrow(`tab type "${PREVIEW_KIND}" refuses`)
  })

  it('does not claim addresses of other schemes', () => {
    const tabs = registry()
    tabs.register({ id: 'test/anything', kind: 'anything', patterns: ['*'], priority: 'extension', title: () => 'x' })
    expect(tabs.claim('https://example.com/a.png').kind).toBe('anything')
  })
})
