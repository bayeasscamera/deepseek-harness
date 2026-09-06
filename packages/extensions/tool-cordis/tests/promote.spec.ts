import { Context } from '@deepseek-ai/cordis'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry from '@deepseek-ai/dsh-tools'
import DynamicCordisRunnerService from '@deepseek-ai/dsh-cordis-host-runner'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import * as ToolCordis from '../src/index.ts'
import { mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const AGENT = { id: 'S-promote' as SessionId, steer() {}, inject() {} } as unknown as Agent

async function setup(): Promise<{ ctx: Context; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'promote-'))
  const ctx = new Context()
  await ctx.plugin(Timer)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(DynamicCordisRunnerService)
  await ctx.plugin(ToolCordis)
  return { ctx, root }
}

async function defineDemoPlugin(ctx: Context): Promise<string> {
  const defined = ctx.dynamicCordisRunner.define({
    sessionId: AGENT.id,
    plugin: { kind: 'new', idPrefix: 'demo' },
    name: 'Promote Demo Plugin',
    purpose: 'Demonstrate disk promotion capability',
    code: {
      host: 'ctx.on("custom/event", () => console.log("fired"))',
    },
  })
  return String(defined.pluginId)
}

describe('cordis_promote tool', () => {
  it('promotes a dynamic plugin to a structured disk directory', async () => {
    const { ctx, root } = await setup()
    const pluginId = await defineDemoPlugin(ctx)

    const tool = ctx.tools.get('cordis_promote')
    expect(tool).toBeDefined()

    const execResult = await tool!.execute(
      { pluginId },
      { agent: AGENT, signal: new AbortController().signal } as unknown as Parameters<NonNullable<typeof tool>['execute']>[1],
    ) as { pluginId: string; packageId: string; targetPath: string; filesCreated: string[] }

    expect(execResult.pluginId).toBe(pluginId)
    expect(execResult.targetPath).toBe(`.dsh/promoted-plugins/${pluginId}`)
    expect(execResult.filesCreated).toContain('package.json')
    expect(execResult.filesCreated).toContain('index.js')
    expect(execResult.filesCreated).toContain('README.md')

    const dir = join(root, '.dsh', 'promoted-plugins', pluginId)
    const pkgJson = JSON.parse(await readFile(join(dir, 'package.json'), 'utf-8')) as { name?: string }
    expect(pkgJson.name).toBe(`@dsh-promoted/${pluginId}`)

    const indexJs = await readFile(join(dir, 'index.js'), 'utf-8')
    expect(indexJs).toContain('custom/event')

    await rm(root, { recursive: true, force: true })
  })

  it('rejects an absolute targetDirectory outside the workspace', async () => {
    const { ctx, root } = await setup()
    const pluginId = await defineDemoPlugin(ctx)
    const tool = ctx.tools.get('cordis_promote')
    expect(tool).toBeDefined()

    await expect(tool!.execute(
      { pluginId, targetDirectory: '/tmp/escape' },
      { agent: AGENT, signal: new AbortController().signal } as unknown as Parameters<NonNullable<typeof tool>['execute']>[1],
    )).rejects.toThrow('must be relative to the workspace')

    await rm(root, { recursive: true, force: true })
  })

  it('rejects a parent-traversal targetDirectory', async () => {
    const { ctx, root } = await setup()
    const pluginId = await defineDemoPlugin(ctx)
    const tool = ctx.tools.get('cordis_promote')
    expect(tool).toBeDefined()

    await expect(tool!.execute(
      { pluginId, targetDirectory: '../../../escape' },
      { agent: AGENT, signal: new AbortController().signal } as unknown as Parameters<NonNullable<typeof tool>['execute']>[1],
    )).rejects.toThrow('must stay inside the workspace')

    await rm(root, { recursive: true, force: true })
  })

  it('rejects a targetDirectory outside .dsh/promoted-plugins/', async () => {
    const { ctx, root } = await setup()
    const pluginId = await defineDemoPlugin(ctx)
    const tool = ctx.tools.get('cordis_promote')
    expect(tool).toBeDefined()

    await expect(tool!.execute(
      { pluginId, targetDirectory: 'secrets/escape' },
      { agent: AGENT, signal: new AbortController().signal } as unknown as Parameters<NonNullable<typeof tool>['execute']>[1],
    )).rejects.toThrow('must live under .dsh/promoted-plugins/')

    await rm(root, { recursive: true, force: true })
  })

  it('rejects a promotion target whose symlink resolves outside the workspace', async () => {
    const { ctx, root } = await setup()
    const pluginId = await defineDemoPlugin(ctx)
    const tool = ctx.tools.get('cordis_promote')
    expect(tool).toBeDefined()

    // The textual confinement accepts this target, but the link redirects the
    // resolved write outside the workspace root; the containment re-check must
    // fail loud before any file is written.
    const outside = await mkdtemp(join(tmpdir(), 'promote-escape-'))
    const promotedRoot = join(root, '.dsh', 'promoted-plugins')
    await mkdir(promotedRoot, { recursive: true })
    await symlink(outside, join(promotedRoot, 'escape'))

    await expect(tool!.execute(
      { pluginId, targetDirectory: '.dsh/promoted-plugins/escape' },
      { agent: AGENT, signal: new AbortController().signal } as unknown as Parameters<NonNullable<typeof tool>['execute']>[1],
    )).rejects.toThrow(/outside the workspace/)

    await expect(readFile(join(outside, 'package.json'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' })

    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })
})
