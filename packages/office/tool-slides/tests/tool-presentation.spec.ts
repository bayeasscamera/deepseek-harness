/**
 * The tool's contract: the schema the model sees, the deck it writes through
 * the real filesystem seam, the path it resolves, and the way a sandbox denial
 * and an ordinary filesystem failure reach the model.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { strFromU8, unzipSync } from 'fflate'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import { SandboxedFileSystem } from '@deepseek-ai/dsh-fs-sandbox'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import * as ToolPresentation from '../src/index.ts'

const signal = new AbortController().signal
let dir: string
let ctx: Context
let fibers: Awaited<ReturnType<Context['plugin']>>[]

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-deck-'))
  ctx = new Context()
  fibers = []
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
})

afterEach(async () => {
  for (const fiber of fibers.reverse()) await fiber.dispose()
  rmSync(dir, { recursive: true, force: true })
})

/** Mount the tool over the backend the caller names. */
async function mount(backend: typeof LocalFileSystem | typeof SandboxedFileSystem, config: { cwd?: string } = {}): Promise<void> {
  fibers.push(await ctx.plugin(backend, { cwd: dir, ...config }))
  fibers.push(await ctx.plugin(ToolPresentation))
}

/** A fake agent over a real session, whose workspace is this test's temp directory. */
function fakeAgent(cwd: string): Agent {
  const fiber = ctx.plugin(() => {})
  const id = SessionId('session-deck')
  const agent = {
    id,
    ctx: fiber.ctx,
    inject: () => {},
    // A real Session, because the sandbox policy reads its projections.
    session: Session.create(id, [], { version: SESSION_FORMAT_VERSION, id, createdAt: 0, isSeeded: false, cwd }),
  } as unknown as Agent
  return agent
}

/** Call the tool through the registry, the way the loop does. */
async function call(args: unknown, agent?: Agent) {
  return ctx.tools.execute({
    signal,
    callId: ToolCallId('call-1'),
    name: 'write_presentation',
    arguments: args,
    ...agent === undefined ? {} : { agent },
  })
}

const DECK_ARGS = {
  file_path: 'reports/weekly.pptx',
  title: 'Rapport hebdomadaire',
  subtitle: 'Semaine 40',
  slides: [
    { layout: 'section', title: 'Chiffres clés' },
    { layout: 'bullets', title: 'Ventes', bullets: ['+12%', 'Pic le mardi'] },
  ],
}

describe('write_presentation registration', () => {
  it('registers the tool schema the model sees', async () => {
    await mount(LocalFileSystem)
    const schema = ctx.tools.schemas().find(tool => tool.name === 'write_presentation')
    expect(schema).toMatchObject({
      name: 'write_presentation',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
          title: { type: 'string' },
          subtitle: { type: 'string' },
          template: { type: 'string' },
          slides: { type: 'array' },
        },
        required: ['file_path', 'title', 'slides'],
      },
    })
    expect(schema?.description).toContain('PowerPoint presentation')
  })

  it('presents the call as an edit of the file it writes', async () => {
    await mount(LocalFileSystem)
    const view = ctx.tools.get('write_presentation')?.presentCall?.(DECK_ARGS)
    expect(view).toMatchObject({ card: 'generic', kind: 'edit', locations: [{ path: 'reports/weekly.pptx' }] })
  })

  it('rejects a call whose slides are missing, before the body runs', async () => {
    await mount(LocalFileSystem)
    const result = await call({ file_path: 'a.pptx', title: 'T' })
    expect(result).toMatchObject({ isError: true })
  })
})

describe('write_presentation over the local backend', () => {
  it('writes a real package into the workspace and reports what it wrote', async () => {
    await mount(LocalFileSystem)
    const result = await call(DECK_ARGS)
    expect(result).toMatchObject({
      isError: false,
      value: { path: join(dir, 'reports/weekly.pptx'), operation: 'create', slides: 3 },
    })
    const files = unzipSync(new Uint8Array(readFileSync(join(dir, 'reports/weekly.pptx'))))
    expect(Object.keys(files)).toContain('ppt/slides/slide3.xml')
    expect(strFromU8(files['ppt/slides/slide1.xml'] as Uint8Array)).toContain('Rapport hebdomadaire')
    expect(result.content).toEqual([{
      type: 'text',
      text: expect.stringContaining('Created presentation with 3 slides') as unknown as string,
    }])
  })

  it('builds the deck on the template the call names', async () => {
    await mount(LocalFileSystem)
    await call({ ...DECK_ARGS, file_path: 'dark.pptx', template: 'dark' })
    const files = unzipSync(new Uint8Array(readFileSync(join(dir, 'dark.pptx'))))
    expect(strFromU8(files['ppt/theme/theme1.xml'] as Uint8Array)).toContain('<a:lt1><a:srgbClr val="14181D"/></a:lt1>')
  })

  it('writes a deck with no subtitle, leaving the subtitle placeholder empty', async () => {
    await mount(LocalFileSystem)
    const { subtitle: _dropped, ...withoutSubtitle } = DECK_ARGS
    const result = await call(withoutSubtitle)
    expect(result).toMatchObject({ isError: false, value: { slides: 3 } })
    const files = unzipSync(new Uint8Array(readFileSync(join(dir, 'reports/weekly.pptx'))))
    const slide = strFromU8(files['ppt/slides/slide1.xml'] as Uint8Array)
    expect(slide).toContain('<p:ph type="subTitle"/>')
    expect(slide).toContain('<a:p><a:endParaRPr lang="en-US" dirty="0"/></a:p>')
  })

  it('replaces an existing deck and reports the update', async () => {
    await mount(LocalFileSystem)
    mkdirSync(join(dir, 'reports'), { recursive: true })
    await call(DECK_ARGS)
    const again = await call({ ...DECK_ARGS, title: 'Rapport corrigé' })
    expect(again).toMatchObject({ isError: false, value: { operation: 'update' } })
    const files = unzipSync(new Uint8Array(readFileSync(join(dir, 'reports/weekly.pptx'))))
    expect(strFromU8(files['ppt/slides/slide1.xml'] as Uint8Array)).toContain('Rapport corrigé')
  })

  it('resolves a relative path against the calling session workspace', async () => {
    const workspace = join(dir, 'workspace')
    mkdirSync(workspace, { recursive: true })
    await mount(LocalFileSystem)
    const result = await call({ ...DECK_ARGS, file_path: 'deck.pptx' }, fakeAgent(workspace))
    // The tool canonicalizes the session workspace before resolving, so a
    // symlinked temp root still reports one filesystem identity.
    expect(result).toMatchObject({ isError: false, value: { path: join(realpathSync(workspace), 'deck.pptx') } })
    expect(unzipSync(new Uint8Array(readFileSync(join(workspace, 'deck.pptx'))))['ppt/presentation.xml']).toBeDefined()
  })

  it('reports an ordinary filesystem failure as it is, without the sandbox marker', async () => {
    await mount(LocalFileSystem)
    mkdirSync(join(dir, 'adir'))
    const result = await call({ ...DECK_ARGS, file_path: 'adir' })
    expect(result).toMatchObject({ isError: true })
    expect(JSON.stringify(result.content)).toContain('not a regular file')
    expect(JSON.stringify(result.content)).not.toContain('[sandbox:')
  })
})

describe('write_presentation under the sandbox', () => {
  it('reports a policy denial with the shared marker instead of writing', async () => {
    // The policy service projects session state, so its registry comes first.
    fibers.push(await ctx.plugin(SessionProjectionRegistry))
    fibers.push(await ctx.plugin(SandboxPolicyService, { mode: 'read-only', workspaceRoot: dir }))
    await mount(SandboxedFileSystem)
    const result = await call({ ...DECK_ARGS, file_path: 'denied.pptx' })
    expect(result).toMatchObject({ isError: true })
    expect(JSON.stringify(result.content)).toContain('[sandbox: file access denied under read-only mode]')
    expect(() => readFileSync(join(dir, 'denied.pptx'))).toThrow()
  })

  it('asks the policy for the calling session when an agent is present', async () => {
    fibers.push(await ctx.plugin(SessionProjectionRegistry))
    fibers.push(await ctx.plugin(SandboxPolicyService, { mode: 'read-only', workspaceRoot: dir }))
    await mount(SandboxedFileSystem)
    const result = await call({ ...DECK_ARGS, file_path: 'denied.pptx' }, fakeAgent(dir))
    expect(result).toMatchObject({ isError: true })
    expect(JSON.stringify(result.content)).toContain('[sandbox: file access denied under read-only mode]')
  })
})
