import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition, CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import * as designArtboard from '../src/index.ts'

/** Minimal captured shape of the registered `design_create_artboard` definition. */
interface CapturedTool {
  name: string
  description: string
  output: { render: (args: unknown, value: unknown) => unknown }
  execute: (args: unknown) => Promise<unknown>
}

interface Harness {
  readonly command: CommandDefinition
  readonly tool: CapturedTool
  readonly artboardDir: string
  /** Current registration state, for observing disposal. */
  readonly registered: () => { command: CommandDefinition | undefined; tool: CapturedTool | undefined }
  /** Dispose the plugin fiber owning both registrations. */
  readonly dispose: () => Promise<void>
}

const cleanupDirs: string[] = []

/** One temporary directory per suite case, removed after the run. */
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-design-artboard-'))
  cleanupDirs.push(dir)
  return dir
}

afterEach(() => {
  while (cleanupDirs.length > 0) rmSync(cleanupDirs.pop()!, { recursive: true, force: true })
})

/**
 * Mount the plugin against a temporary configured artboard directory, with
 * `commands`/`tools` services capturing the registered definitions.
 */
async function boot(config?: { artboardDir?: string }): Promise<Harness> {
  const artboardDir = config?.artboardDir ?? tempDir()
  const ctx = new Context()
  let command: CommandDefinition | undefined
  let tool: CapturedTool | undefined
  ctx.provide('commands', {
    register(next: CommandDefinition) {
      command = next
      return () => { command = undefined }
    },
  } as never)
  ctx.provide('tools', {
    register(next: CapturedTool) {
      tool = next
      return () => { tool = undefined }
    },
  } as never)
  const fiber = await ctx.plugin(designArtboard, { artboardDir })
  if (command === undefined || tool === undefined) {
    throw new Error('plugin did not register its command and tool')
  }
  return {
    command,
    tool,
    artboardDir,
    registered: () => ({ command, tool }),
    dispose: () => fiber.dispose(),
  }
}

/** Invoke the captured `/design` handler the way the executor would. */
async function run(harness: Harness, rawInput: string): Promise<CommandResult> {
  return Promise.resolve(harness.command.handler({ rawInput } as CommandInvocation))
}

describe('@deepseek-ai/dsh-design-artboard registration', () => {
  it('registers the /design command and the design_create_artboard tool, disposed with the plugin', async () => {
    const test = await boot()
    expect(designArtboard.name).toBe('design-artboard')
    expect(designArtboard.inject).toEqual(['commands', 'tools'])
    expect('default' in designArtboard).toBe(false)

    expect(test.command.name).toBe('design')
    expect(test.command.description).toBe('Create, list, or preview interactive UI artboards before wiring them into code.')
    expect(test.tool.name).toBe('design_create_artboard')
    expect(test.tool.description).toBe('Create a new HTML/Tailwind UI artboard in the configured artboard directory for visual preview.')

    await test.dispose()
    expect(test.registered()).toEqual({ command: undefined, tool: undefined })
  })

  it('rejects a non-string artboardDir at load (misconfiguration fails loud)', async () => {
    const ctx = new Context()
    ctx.provide('commands', { register: () => () => undefined } as never)
    ctx.provide('tools', { register: () => () => undefined } as never)
    await expect(ctx.plugin(designArtboard, { artboardDir: 42 } as never)).rejects.toThrow('artboardDir')
  })
})

describe('/design command', () => {
  it('lists saved artboards with their real file mtimes', async () => {
    const test = await boot()
    await run(test, 'new login_card')
    const result = await run(test, 'list')
    expect(result.kind).toBe('success')
    if (result.kind !== 'success') throw new Error('expected success')
    expect(result.text).toContain('### Available UI artboards:')
    expect(result.text).toContain('- **login_card**')
    expect(result.text).toContain('/design show <name>')

    const filePath = join(test.artboardDir, 'login_card.html')
    const listed = designArtboard.listArtboards(test.artboardDir)
    expect(listed[0]!.updatedAt).toBe(statSync(filePath).mtimeMs)
  })

  it('reports an empty directory with the configured path and a creation hint', async () => {
    const test = await boot()
    const result = await run(test, 'list')
    expect(result).toEqual({
      kind: 'success',
      text: `No UI artboards found in ${test.artboardDir}. Use \`/design new <name>\` to create one.`,
    })
  })

  it('creates an artboard with inline content and a sanitized file stem', async () => {
    const test = await boot()
    const result = await run(test, 'new My Card <button>Go</button>')
    expect(result.kind).toBe('success')
    if (result.kind !== 'success') throw new Error('expected success')
    expect(result.text).toContain('Artboard **my** created.')
    expect(result.text).toContain(join(test.artboardDir, 'my.html'))
    expect(existsSync(join(test.artboardDir, 'my.html'))).toBe(true)
    const written = designArtboard.listArtboards(test.artboardDir)
    expect(written).toHaveLength(1)
  })

  it('creates an artboard with default placeholder content when no HTML is supplied', async () => {
    const test = await boot()
    const result = await run(test, 'new dashboard_stat')
    if (result.kind !== 'success') throw new Error('expected success')
    expect(result.text).toContain('Artboard **dashboard_stat** created.')
    const content = designArtboard.listArtboards(test.artboardDir)
    expect(content).toHaveLength(1)
  })

  it('rejects a show target that tries to escape the artboard directory', async () => {
    const test = await boot()
    const result = await run(test, 'show ../../etc/passwd')
    expect(result).toEqual({
      kind: 'error',
      text: 'Invalid artboard name "../../etc/passwd": names may contain only lowercase letters, digits, hyphens, and underscores.',
    })
    expect(existsSync(join(test.artboardDir, '..', 'etc'))).toBe(false)
  })

  it('rejects a show target with path separators even when it stays inside the directory', async () => {
    const test = await boot()
    const result = await run(test, 'show nested/name')
    expect(result.kind).toBe('error')
    if (result.kind !== 'error') throw new Error('expected error')
    expect(result.text).toContain('Invalid artboard name "nested/name"')
  })

  it('reports a missing artboard for a well-formed name', async () => {
    const test = await boot()
    const result = await run(test, 'show login_card')
    expect(result).toEqual({
      kind: 'error',
      text: `Artboard **login_card** not found in ${test.artboardDir}.`,
    })
  })

  it('shows a short artboard file verbatim and a long one truncated at 1000 characters', async () => {
    const test = await boot()
    writeFileSync(join(test.artboardDir, 'short_card.html'), '<button>Go</button>', 'utf8')
    const short = await run(test, 'show short_card')
    expect(short.kind).toBe('success')
    if (short.kind !== 'success') throw new Error('expected success')
    expect(short.text).toContain('### Artboard: short_card')
    expect(short.text).toContain('<button>Go</button>')
    expect(short.text).not.toContain('...')
    expect(short.text).toContain('Full source file:')

    writeFileSync(join(test.artboardDir, 'long_card.html'), `<!DOCTYPE html>${'x'.repeat(1200)}`, 'utf8')
    const long = await run(test, 'show long_card')
    if (long.kind !== 'success') throw new Error('expected success')
    // 1000-char window minus the 15-char doctype prefix, then the ellipsis.
    expect(long.text).toContain('x'.repeat(985) + '...')
    expect(long.text).not.toContain('x'.repeat(986))
  })

  it('prints the usage line for an unknown action and for a bare `new`', async () => {
    const test = await boot()
    const usage = 'Usage: `/design list` | `/design new <name> [html]` | `/design show <name>`'
    await expect(run(test, 'bogus')).resolves.toEqual({ kind: 'success', text: usage })
    await expect(run(test, 'new')).resolves.toEqual({ kind: 'success', text: usage })
  })
})

describe('artboard file helpers', () => {
  it('sanitizes a raw name to a file-safe stem', () => {
    expect(designArtboard.artboardStem('My Card!')).toBe('my_card_')
    expect(designArtboard.artboardStem('../Escape')).toBe('___escape')
  })

  it('resolves safe stems inside the directory and throws for unsafe names', () => {
    const dir = tempDir()
    expect(designArtboard.resolveArtboardPath('login_card', dir)).toBe(join(dir, 'login_card.html'))
    expect(() => designArtboard.resolveArtboardPath('../escape', dir))
      .toThrow('Invalid artboard name "../escape": names may contain only lowercase letters, digits, hyphens, and underscores.')
  })

  it('wraps body content in the Tailwind preview shell', () => {
    const wrapped = designArtboard.wrapArtboardHtml('Login Card', '<form><input /></form>')
    expect(wrapped).toContain('Login Card — Artboard Preview')
    expect(wrapped).toContain('<html lang="en"')
    expect(wrapped).toContain('https://cdn.tailwindcss.com')
    expect(wrapped).toContain('<form><input /></form>')
  })

  it('stores raw complete documents as-is and wraps fragments', () => {
    const dir = tempDir()
    const raw = '<!DOCTYPE html><html><body>full document</body></html>'
    const rawPath = designArtboard.saveArtboard('raw_doc', raw, undefined, dir)
    expect(existsSync(rawPath)).toBe(true)

    const wrappedPath = designArtboard.saveArtboard('fragment', '<span>hi</span>', 'Fragment Title', dir)
    expect(designArtboard.listArtboards(dir).find(a => a.name === 'fragment')).toBeDefined()
    expect(designArtboard.wrapArtboardHtml('Fragment Title', 'x')).toContain('Fragment Title')
    void wrappedPath
  })

  it('returns an empty listing for a missing directory', () => {
    expect(designArtboard.listArtboards(join(tempDir(), 'missing'))).toEqual([])
  })

  it('propagates filesystem failures from the save path (fail loud)', async () => {
    const base = tempDir()
    const blocker = join(base, 'blocker')
    writeFileSync(blocker, 'not a directory', 'utf8')
    const test = await boot({ artboardDir: blocker })
    await expect(run(test, 'new login_card')).rejects.toThrow()
  })
})

describe('design_create_artboard tool', () => {
  it('saves an artboard and returns the absolute file path', async () => {
    const test = await boot()
    const value = await test.tool.execute({
      name: 'login_card',
      title: 'Login Card',
      content: '<form><input /></form>',
    }) as { success: boolean; filePath: string }
    expect(value.success).toBe(true)
    expect(value.filePath).toBe(join(test.artboardDir, 'login_card.html'))
    expect(existsSync(value.filePath)).toBe(true)

    const rendered = test.tool.output.render({}, value) as { type: string; text: string }[]
    expect(rendered).toEqual([{ type: 'text', text: `Artboard created: ${value.filePath}` }])
  })
})
