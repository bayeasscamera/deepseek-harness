import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SettingsDescriptor } from '@deepseek-ai/dsh-settings'
import { RemoteError, remoteErrorOf, remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import SettingsController from '../src/index.ts'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { MemorySettings } from '../../../settings/settings/tests/memory.ts'

const NS = 'ui-test'

const Profile = z.object({
  preference: z.union(['light', 'dark']).default('light'),
  apiKey: z.string().role('secret'),
})

/** A provider that reports a local document, for the `hasDocument` fact. */
class DocumentSettings extends MemorySettings {
  override get documentPath(): string | undefined {
    return '/deployment/settings.yaml'
  }
}

/** A provider whose read forgets the namespace its write just committed. */
class VanishingSettings extends MemorySettings {
  override describe(): SettingsDescriptor[] {
    return []
  }
}

/**
 * A provider whose descriptor omits the secret-slot list. `secrets` is optional
 * on the descriptor, so a foreign provider may leave it out even under
 * `redactSecrets`, and the view still has to declare an empty list.
 */
class SlotlessSettings extends MemorySettings {
  override describe(): SettingsDescriptor[] {
    return [
      {
        ns: NS,
        schema: Profile.toJSON(),
        value: { preference: 'light' },
        applies: 'live',
        revision: 0,
      } as unknown as SettingsDescriptor,
    ]
  }
}

/** A provider that refuses every write the way a read-only backing store would. */
class RefusingSettings extends MemorySettings {
  override mutate(): Promise<void> {
    return Promise.reject(new Error('settings are read-only in this deployment'))
  }
}

/** A provider that refuses with a bare string, the way some storage clients do. */
class LiteralRefusingSettings extends MemorySettings {
  override async mutate(): Promise<void> {
    throw 'the document is locked'
  }
}

async function boot(
  provider: typeof MemorySettings = MemorySettings,
  options: { doc?: Record<string, unknown>; base?: { preference: 'light' | 'dark' } } = {},
): Promise<{ controller: SettingsController; ctx: Context }> {
  const ctx = new Context()
  await ctx.plugin(provider, options.doc === undefined ? {} : { doc: options.doc })
  ctx.settings.register(NS, Profile, options.base === undefined ? {} : { base: options.base })
  await ctx.plugin(SettingsController)
  return { controller: ctx.settingsController, ctx }
}

describe('the settings Remote namespace a configuration page calls', () => {
  it('publishes the settings namespace from its own service key', async () => {
    const { controller } = await boot()
    expect(controller.typertRemote.serviceKey).toBe('settingsController')
    expect(controller.typertRemote.namespace).toBe('settings')
    expect(remoteMethods(controller)).toEqual([
      { method: 'describe', invocation: { kind: 'direct' } },
      { method: 'canOpenAgentPresetDirectory', invocation: { kind: 'direct' } },
      { method: 'update', invocation: { kind: 'direct' } },
      { method: 'replace', invocation: { kind: 'direct' } },
      { method: 'mutate', invocation: { kind: 'direct' } },
      { method: 'openSettingsDocument', invocation: { kind: 'direct' } },
      { method: 'openAgentPresetDirectory', invocation: { kind: 'direct' } },
      { method: 'listSkills', invocation: { kind: 'direct' } },
      { method: 'openUserSkillsDirectory', invocation: { kind: 'direct' } },
      { method: 'refreshSkills', invocation: { kind: 'direct' } },
      { method: 'importSkills', invocation: { kind: 'direct' } },
    ])
  })

  it('reports the actionable configuration error while no settings provider is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(SettingsController)
    const calls: Array<() => unknown> = [
      () => ctx.settingsController.describe(),
      () => ctx.settingsController.update('ui-test', {}, undefined),
      () => ctx.settingsController.replace('ui-test', {}, undefined),
      () => ctx.settingsController.mutate('ui-test', [], undefined),
      () => ctx.settingsController.openSettingsDocument(new AbortController().signal),
    ]
    for (const call of calls) {
      const failure = await Promise.resolve()
        .then(call)
        .catch((error: unknown) => error)
      expect(remoteErrorOf(failure)).toMatchObject({
        code: 'gateway/internal',
        message:
          'settings service is absent: this deployment does not mount a settings provider (e.g. @deepseek-ai/dsh-settings-file) in its composition',
        details: {},
      })
    }
  })

  it('mounts the credentials namespace beside its own', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings)
    ctx.settings.register(NS, Profile)
    const fiber = ctx.plugin(SettingsController)
    await fiber.await()
    expect(ctx.get('credentialsController')).toBeDefined()
    await fiber.dispose()
    expect(ctx.get('settingsController')).toBeUndefined()
    expect(ctx.get('credentialsController')).toBeUndefined()
  })

  it('describes every namespace redacted, with the deployment facts around them', async () => {
    const { controller } = await boot(DocumentSettings, {
      doc: { 'ui-test': { apiKey: 'sk-stored' } },
    })
    const value = controller.describe()
    expect(value).toMatchObject({ writable: true, hasDocument: true })
    const [view] = value.namespaces
    expect(view?.ns).toBe('ui-test')
    // The secret never rides; its slot reports only that one is stored.
    expect(JSON.stringify(value)).not.toContain('sk-stored')
    expect(view?.secrets).toEqual([{ path: ['apiKey'], set: true }])
    // Redaction removes the field rather than replacing it, so the layer that
    // stored a secret comes back empty instead of carrying a placeholder.
    expect(view?.user).toEqual({})
  })

  it('reports a read-only provider and omits the layers it has none of', async () => {
    const { controller } = await boot(
      class extends MemorySettings {
        override get writable(): boolean {
          return false
        }
      },
    )
    const value = controller.describe()
    expect(value).toMatchObject({ writable: false, hasDocument: false })
    const [view] = value.namespaces
    // No composition base was declared and no user section is stored, so
    // neither optional layer appears at all.
    expect(view && 'base' in view).toBe(false)
    expect(view && 'user' in view).toBe(false)
  })

  it('declares an empty slot list when the provider names no secrets', async () => {
    const { controller } = await boot(SlotlessSettings)
    const [view] = controller.describe().namespaces
    expect(view?.secrets).toEqual([])
  })

  it('carries the composition base layer when the registrant declared one', async () => {
    const { controller } = await boot(MemorySettings, { base: { preference: 'dark' } })
    const [view] = controller.describe().namespaces
    expect(view?.base).toEqual({ preference: 'dark' })
  })

  it('applies path-addressed edits and answers with the namespace it just wrote', async () => {
    const { controller } = await boot()
    const view = await controller.mutate(
      'ui-test',
      [{ op: 'set', path: ['preference'], value: 'dark' }],
      undefined,
    )
    expect(view).toMatchObject({ ns: 'ui-test', user: { preference: 'dark' } })
    expect(view.revision).toBeGreaterThan(0)
  })

  it('supports merge updates and wholesale replacement on the Remote namespace', async () => {
    const { controller } = await boot(MemorySettings, {
      doc: { 'ui-test': { preference: 'dark', apiKey: 'sk-stored' } },
    })
    const updated = await controller.update('ui-test', { preference: 'light' }, undefined)
    expect(updated.user).toEqual({ preference: 'light' })
    expect(updated.secrets).toEqual([{ path: ['apiKey'], set: true }])

    const replaced = await controller.replace('ui-test', {}, updated.revision)
    expect(replaced.value).toEqual({ preference: 'light' })
    expect(replaced.user).toEqual({})
    expect(replaced.secrets).toEqual([{ path: ['apiKey'], set: false }])
  })

  it('refuses a stale write as settings/conflict carrying both revisions', async () => {
    const { controller } = await boot()
    const held = controller.describe().namespaces[0]!.revision
    await controller.mutate('ui-test', [{ op: 'set', path: ['preference'], value: 'dark' }], held)
    const failure = await controller
      .mutate('ui-test', [{ op: 'set', path: ['preference'], value: 'light' }], held)
      .catch((error: unknown) => error)
    const { code, details } = remoteErrorOf(failure) ?? {}
    expect(code).toBe('settings/conflict')
    expect(details).toMatchObject({ ns: 'ui-test', expected: held })
  })

  it('answers a malformed namespace exactly as an unregistered one', async () => {
    const { controller } = await boot()
    for (const ns of ['Not A Namespace', 'unregistered']) {
      const failure = await controller
        .mutate(ns, [{ op: 'unset', path: ['preference'] }], undefined)
        .catch((error: unknown) => error)
      expect(remoteErrorOf(failure)).toMatchObject({
        code: 'settings/rejected',
        details: { ns },
      })
    }
  })

  it('reports an empty namespace as bad-request', async () => {
    const { controller } = await boot()
    for (const call of [
      () => controller.update('', {}, undefined),
      () => controller.replace('', {}, undefined),
      () => controller.mutate('', [], undefined),
    ]) {
      const failure = await call().catch((error: unknown) => error)
      expect(remoteErrorOf(failure)).toMatchObject({ code: 'gateway/bad-request' })
    }
  })

  it('reports a refused write as settings/rejected carrying the seam message', async () => {
    const { controller } = await boot(RefusingSettings)
    const failure = await controller
      .mutate('ui-test', [{ op: 'unset', path: ['preference'] }], undefined)
      .catch((error: unknown) => error)
    const { code, message } = remoteErrorOf(failure) ?? {}
    expect(code).toBe('settings/rejected')
    expect(message).toContain('read-only in this deployment')
  })

  it('stringifies a refusal that is not an Error', async () => {
    const { controller } = await boot(LiteralRefusingSettings)
    const failure = await controller
      .mutate('ui-test', [{ op: 'unset', path: ['preference'] }], undefined)
      .catch((error: unknown) => error)
    expect(remoteErrorOf(failure)?.message).toBe('the document is locked')
  })

  it('reports a namespace disposed between the write and its read-back', async () => {
    const { controller } = await boot(VanishingSettings)
    const failure = await controller
      .mutate('ui-test', [{ op: 'set', path: ['preference'], value: 'dark' }], undefined)
      .catch((error: unknown) => error)
    const { code, message } = remoteErrorOf(failure) ?? {}
    expect(code).toBe('gateway/internal')
    expect(message).toContain('was disposed after the mutate')
  })

  it('prepares and opens the provider-owned settings document', async () => {
    const ctx = new Context()
    await ctx.plugin(DocumentSettings)
    const prepare = vi
      .spyOn(ctx.settings, 'prepareDocument')
      .mockResolvedValue('/tmp/settings.yaml')
    const openTextFile = vi.fn((_path: string, _signal: AbortSignal) => Promise.resolve())
    const controller = new SettingsController(ctx, {}, { openTextFile })
    const signal = new AbortController().signal

    await expect(controller.openSettingsDocument(signal)).resolves.toEqual({ opened: true })
    expect(prepare).toHaveBeenCalledOnce()
    expect(openTextFile).toHaveBeenCalledWith('/tmp/settings.yaml', signal)
  })

  it('preserves settings-document absence, failure, and cancellation', async () => {
    const absent = await boot()
    const missingDocument = absent.controller.openSettingsDocument(new AbortController().signal)
    await expect(missingDocument).rejects.toMatchObject({ code: 'gateway/internal' })
    await expect(missingDocument).rejects.toThrow('no local document')

    const failed = await boot(DocumentSettings)
    vi.spyOn(failed.ctx.settings, 'prepareDocument').mockRejectedValue(new Error('read failed'))
    const failedRead = failed.controller.openSettingsDocument(new AbortController().signal)
    await expect(failedRead).rejects.toMatchObject({ code: 'gateway/internal' })
    await expect(failedRead).rejects.toThrow('read failed')

    const cancelled = new AbortController()
    cancelled.abort(new Error('cancelled'))
    const prepare = vi.spyOn(failed.ctx.settings, 'prepareDocument')
    prepare.mockClear()
    await expect(failed.controller.openSettingsDocument(cancelled.signal)).rejects.toMatchObject({
      code: 'gateway/cancelled',
    })
    expect(prepare).not.toHaveBeenCalled()
  })

  it('does not open a settings document cancelled during preparation', async () => {
    const ctx = new Context()
    await ctx.plugin(DocumentSettings)
    const prepared = Promise.withResolvers<string | undefined>()
    vi.spyOn(ctx.settings, 'prepareDocument').mockReturnValue(prepared.promise)
    const openTextFile = vi.fn((_path: string, _signal: AbortSignal) => Promise.resolve())
    const controller = new SettingsController(ctx, {}, { openTextFile })
    const abort = new AbortController()

    const opening = controller.openSettingsDocument(abort.signal)
    abort.abort(new Error('cancelled'))
    prepared.resolve('/tmp/settings.yaml')

    await expect(opening).rejects.toMatchObject({ code: 'gateway/cancelled' })
    expect(openTextFile).not.toHaveBeenCalled()
  })

  it('maps native settings-document opener failures', async () => {
    const ctx = new Context()
    await ctx.plugin(DocumentSettings)
    vi.spyOn(ctx.settings, 'prepareDocument').mockResolvedValue('/tmp/settings.yaml')
    const controller = new SettingsController(
      ctx,
      {},
      {
        openTextFile: () => Promise.reject(new Error('no default editor')),
      },
    )

    await expect(
      controller.openSettingsDocument(new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'gateway/internal',
      message: 'path open failed: no default editor',
    })
  })

  it('classifies cancellation while preparing or opening the settings document', async () => {
    const preparing = new Context()
    await preparing.plugin(DocumentSettings)
    const prepareAbort = new AbortController()
    vi.spyOn(preparing.settings, 'prepareDocument').mockImplementation(async () => {
      prepareAbort.abort(new Error('cancelled'))
      throw new Error('preparation stopped')
    })
    const preparingController = new SettingsController(preparing)
    await expect(
      preparingController.openSettingsDocument(prepareAbort.signal),
    ).rejects.toMatchObject({ code: 'gateway/cancelled' })

    const opening = new Context()
    await opening.plugin(DocumentSettings)
    vi.spyOn(opening.settings, 'prepareDocument').mockResolvedValue('/tmp/settings.yaml')
    const openAbort = new AbortController()
    const openingController = new SettingsController(
      opening,
      {},
      {
        openTextFile: async () => {
          openAbort.abort(new Error('cancelled'))
          throw new Error('opening stopped')
        },
      },
    )
    await expect(openingController.openSettingsDocument(openAbort.signal)).rejects.toMatchObject({
      code: 'gateway/cancelled',
    })
  })

  it('opens a user Agent preset directory or returns its path without a native opener', async () => {
    const ctx = new Context()
    ctx.provide('agentPresets', {
      resolve: (id: string) =>
        Promise.resolve({
          id,
          trust: 'user',
          path: `/presets/${id}/agent.cordis.yml`,
        }),
    } as never)
    const openPath = vi.fn((_path: string, _signal: AbortSignal) => Promise.resolve())
    const openable = new SettingsController(ctx, { nativeOpen: true }, { openPath })
    expect(openable.canOpenAgentPresetDirectory()).toBe(true)
    const signal = new AbortController().signal
    await expect(openable.openAgentPresetDirectory('mine', signal)).resolves.toEqual({
      opened: true,
    })
    expect(openPath).toHaveBeenCalledWith('/presets/mine', signal)

    const headless = new Context()
    headless.provide('agentPresets', {
      resolve: (id: string) =>
        Promise.resolve({
          id,
          trust: 'user',
          path: `/presets/${id}/agent.cordis.yml`,
        }),
    } as never)
    const reveal = new SettingsController(headless, { nativeOpen: false })
    expect(reveal.canOpenAgentPresetDirectory()).toBe(false)
    await expect(
      reveal.openAgentPresetDirectory('mine', new AbortController().signal),
    ).resolves.toEqual({ opened: false, path: '/presets/mine' })
  })

  it('covers native-open detection defaults and explicit overrides', () => {
    const fromInjectedOpener = new SettingsController(
      new Context(),
      {},
      {
        openPath: () => Promise.resolve(),
      },
    )
    expect((fromInjectedOpener as unknown as { canOpenPath: () => boolean }).canOpenPath()).toBe(
      true,
    )

    const detected = new SettingsController(new Context())
    expect(typeof (detected as unknown as { canOpenPath: () => boolean }).canOpenPath()).toBe(
      'boolean',
    )

    const override = vi.fn(() => false)
    const overridden = new SettingsController(new Context(), {}, { canOpenPath: override })
    expect((overridden as unknown as { canOpenPath: () => boolean }).canOpenPath()).toBe(false)
    expect(override).toHaveBeenCalledOnce()
  })

  it('refuses a shipped Agent preset and a missing preset provider', async () => {
    const ctx = new Context()
    ctx.provide('agentPresets', {
      resolve: (id: string) =>
        Promise.resolve({
          id,
          trust: 'system',
          path: `/presets/${id}/agent.cordis.yml`,
        }),
    } as never)
    const controller = new SettingsController(ctx)
    await expect(
      controller.openAgentPresetDirectory('standard', new AbortController().signal),
    ).rejects.toMatchObject({ code: 'agent-preset/read-only' })

    const missing = new SettingsController(new Context())
    await expect(
      missing.openAgentPresetDirectory('mine', new AbortController().signal),
    ).rejects.toMatchObject({ code: 'agent-preset/not-found' })
  })

  it('rejects an empty Agent preset id before resolving a provider', async () => {
    const resolve = vi.fn()
    const ctx = new Context()
    ctx.provide('agentPresets', { resolve } as never)
    const controller = new SettingsController(ctx)

    await expect(
      controller.openAgentPresetDirectory('', new AbortController().signal),
    ).rejects.toMatchObject({ code: 'gateway/bad-request' })
    expect(resolve).not.toHaveBeenCalled()
  })

  it('raises an Agent preset resolution failure as the roster reported it', async () => {
    const ctx = new Context()
    const reported = new RemoteError('agent-preset/not-found', 'no such preset', {
      agentPreset: 'mine',
      available: ['standard'],
    })
    ctx.provide('agentPresets', {
      resolve: async () => {
        throw reported
      },
    } as never)
    const controller = new SettingsController(ctx)

    await expect(
      controller.openAgentPresetDirectory('mine', new AbortController().signal),
    ).rejects.toBe(reported)
  })

  it('classifies cancellation and non-Error failures from the preset opener', async () => {
    const ctx = new Context()
    ctx.provide('agentPresets', {
      resolve: (id: string) =>
        Promise.resolve({
          id,
          trust: 'user',
          path: `/presets/${id}/agent.cordis.yml`,
        }),
    } as never)
    const abort = new AbortController()
    const openPath = vi
      .fn()
      .mockImplementationOnce(async () => {
        abort.abort(new Error('cancelled'))
        throw new Error('opening stopped')
      })
      .mockRejectedValueOnce('desktop unavailable')
    const controller = new SettingsController(ctx, { nativeOpen: true }, { openPath })

    await expect(controller.openAgentPresetDirectory('first', abort.signal)).rejects.toMatchObject({
      code: 'gateway/cancelled',
    })
    await expect(
      controller.openAgentPresetDirectory('second', new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'gateway/internal',
      message: 'path open failed: desktop unavailable',
    })
  })
})

describe('the deployment-wide skills listing behind the Skills tab', () => {
  /** Write one on-disk skill bundle under `root` and return its directory. */
  async function writeSkill(root: string, name: string, description: string): Promise<string> {
    const directory = join(root, name)
    await mkdir(directory, { recursive: true })
    await writeFile(
      join(directory, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${description}\n---\n\nBody of ${name}.\n`,
    )
    return directory
  }

  it('lists the user-dsh, user-agents, and custom roots with no session running', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-home-'))
    const agentsHome = await mkdtemp(join(tmpdir(), 'agents-home-'))
    const custom = await mkdtemp(join(tmpdir(), 'custom-skills-'))
    const userDir = await writeSkill(join(dshHome, 'skills'), 'user-skill', 'A user-dsh skill.')
    const agentDir = await writeSkill(
      join(agentsHome, 'skills'),
      'agent-skill',
      'A user-agents skill.',
    )
    const customDir = await writeSkill(custom, 'custom-skill', 'A custom skill.')
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const controller = new SettingsController(ctx, {
      dshHome,
      agentsHome,
      customSkillDirs: [custom],
    })

    const entries = await controller.listSkills()

    expect(entries.skills).toHaveLength(3)
    expect(entries.skipped).toEqual([])
    expect(entries.skills).toContainEqual({
      name: 'user-skill',
      description: 'A user-dsh skill.',
      source: 'user-dsh',
      path: userDir,
    })
    expect(entries.skills).toContainEqual({
      name: 'agent-skill',
      description: 'A user-agents skill.',
      source: 'user-agents',
      path: agentDir,
    })
    expect(entries.skills).toContainEqual({
      name: 'custom-skill',
      description: 'A custom skill.',
      source: 'custom',
      path: customDir,
    })
  })

  it('lists runtime registrations without a directory and reuses its mounted discovery row', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'empty-skills-'))
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    ctx.skills.register({
      name: 'runtime-skill',
      description: 'Registered at runtime.',
      source: 'runtime',
      content: '# runtime\n',
    })
    const controller = new SettingsController(ctx, {
      dshHome: empty,
      agentsHome: empty,
      customSkillDirs: [],
    })

    const runtimeOnly = {
      skills: [{ name: 'runtime-skill', description: 'Registered at runtime.', source: 'runtime' }],
      skipped: [],
    }
    await expect(controller.listSkills()).resolves.toEqual(runtimeOnly)
    await expect(controller.listSkills()).resolves.toEqual(runtimeOnly)
  })

  it('installs a validated skill folder whole and leaves no staging folder behind', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-home-'))
    const agentsHome = await mkdtemp(join(tmpdir(), 'agents-home-'))
    const sourceRoot = await mkdtemp(join(tmpdir(), 'skill-source-'))
    const source = await writeSkill(sourceRoot, 'imported-skill', 'An imported skill.')
    await mkdir(join(source, 'assets'), { recursive: true })
    await writeFile(join(source, 'assets', 'notes.md'), 'side file\n')
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const controller = new SettingsController(ctx, {
      dshHome,
      agentsHome,
      customSkillDirs: [],
    })

    await expect(controller.importSkills(source)).resolves.toEqual([
      {
        imported: true,
        name: 'imported-skill',
        path: join(dshHome, 'skills', 'imported-skill'),
      },
    ])
    // The whole folder travels, not only its manifest, and the staging copy
    // the install needed is gone once the rename carried it away.
    await expect(
      readFile(join(dshHome, 'skills', 'imported-skill', 'assets', 'notes.md'), 'utf8'),
    ).resolves.toBe('side file\n')
    await expect(readdir(join(dshHome, 'skills'))).resolves.toEqual(['imported-skill'])
    await expect(controller.refreshSkills()).resolves.toEqual({
      skills: [{
        name: 'imported-skill',
        description: 'An imported skill.',
        source: 'user-dsh',
        path: join(dshHome, 'skills', 'imported-skill'),
      }],
      skipped: [],
    })
  })

  it('installs every skill a grouped folder carries, nested and flat', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-home-'))
    const agentsHome = await mkdtemp(join(tmpdir(), 'agents-home-'))
    const group = await mkdtemp(join(tmpdir(), 'skill-group-'))
    // The shape a real catalog ships in: skills two levels down, one directly
    // under the group, and a flat markdown file beside them.
    await writeSkill(join(group, 'skills'), 'nested-skill', 'Two levels down.')
    await writeSkill(group, 'grouped-skill', 'One level down.')
    await writeFile(
      join(group, 'flat-skill.md'),
      '---\nname: flat-skill\ndescription: A flat skill.\n---\n\nBody.\n',
    )
    await writeFile(join(group, 'README.txt'), 'not a skill\n')
    await writeFile(join(group, 'no-frontmatter.md'), 'just prose\n')
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const controller = new SettingsController(ctx, {
      dshHome,
      agentsHome,
      customSkillDirs: [],
    })

    // The prose file is a discovered candidate that fails validation, and it
    // neither installs nor stops the skills around it.
    await expect(controller.importSkills(group)).resolves.toEqual([
      { imported: true, name: 'flat-skill', path: join(dshHome, 'skills', 'flat-skill.md') },
      { imported: true, name: 'grouped-skill', path: join(dshHome, 'skills', 'grouped-skill') },
      { imported: false, reason: 'invalid-frontmatter', detail: 'invalid-frontmatter' },
      { imported: true, name: 'nested-skill', path: join(dshHome, 'skills', 'nested-skill') },
    ])
    const rescanned = await controller.refreshSkills()
    expect(rescanned.skipped).toEqual([])
    expect(rescanned.skills.map(skill => skill.name))
      .toEqual(['flat-skill', 'grouped-skill', 'nested-skill'])
    expect(rescanned.skills.every(skill => skill.source === 'user-dsh')).toBe(true)
    await expect(readdir(join(dshHome, 'skills'))).resolves.toEqual([
      'flat-skill.md',
      'grouped-skill',
      'nested-skill',
    ])
  })

  it('installs one picked markdown file as a flat skill', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-home-'))
    const agentsHome = await mkdtemp(join(tmpdir(), 'agents-home-'))
    const sourceRoot = await mkdtemp(join(tmpdir(), 'skill-source-'))
    const file = join(sourceRoot, 'picked.md')
    await writeFile(file, '---\nname: picked-skill\ndescription: Picked alone.\n---\n\nBody.\n')
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const controller = new SettingsController(ctx, {
      dshHome,
      agentsHome,
      customSkillDirs: [],
    })

    // The installed file is named for the skill it declares, so the catalog
    // identifies it by the same name the manifest carries.
    await expect(controller.importSkills(file)).resolves.toEqual([
      {
        imported: true,
        name: 'picked-skill',
        path: join(dshHome, 'skills', 'picked-skill.md'),
      },
    ])
    await expect(readdir(join(dshHome, 'skills'))).resolves.toEqual(['picked-skill.md'])
    await expect(controller.refreshSkills()).resolves.toEqual({
      skills: [expect.objectContaining({ name: 'picked-skill', source: 'user-dsh' })],
      skipped: [],
    })
  })

  it('keeps the installed skill whole when a later import claims its name', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-home-'))
    const agentsHome = await mkdtemp(join(tmpdir(), 'agents-home-'))
    const sourceRoot = await mkdtemp(join(tmpdir(), 'skill-source-'))
    const source = await writeSkill(sourceRoot, 'collided-skill', 'The first copy.')
    await writeFile(join(source, 'marker.txt'), 'first\n')
    const flat = join(sourceRoot, 'flat.md')
    await writeFile(flat, '---\nname: flat-collision\ndescription: First flat copy.\n---\n')
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const controller = new SettingsController(ctx, {
      dshHome,
      agentsHome,
      customSkillDirs: [],
    })
    await controller.importSkills(source)
    await controller.importSkills(flat)

    await writeFile(join(source, 'marker.txt'), 'second\n')
    await writeFile(flat, '---\nname: flat-collision\ndescription: Second flat copy.\n---\n')

    // A refused name must not merge the newcomer into the installed skill, and
    // the staging copy taken for the refused attempt is cleared.
    await expect(controller.importSkills(source)).resolves.toEqual([
      {
        imported: false,
        reason: 'exists',
        detail: join(dshHome, 'skills', 'collided-skill'),
      },
    ])
    await expect(controller.importSkills(flat)).resolves.toEqual([
      {
        imported: false,
        reason: 'exists',
        detail: join(dshHome, 'skills', 'flat-collision.md'),
      },
    ])
    await expect(
      readFile(join(dshHome, 'skills', 'collided-skill', 'marker.txt'), 'utf8'),
    ).resolves.toBe('first\n')
    await expect(readdir(join(dshHome, 'skills'))).resolves.toEqual([
      'collided-skill',
      'flat-collision.md',
    ])
  })

  it('joins a running import instead of racing it', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-home-'))
    const agentsHome = await mkdtemp(join(tmpdir(), 'agents-home-'))
    const sourceRoot = await mkdtemp(join(tmpdir(), 'skill-source-'))
    const source = await writeSkill(sourceRoot, 'serial-skill', 'The shared install.')
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const controller = new SettingsController(ctx, {
      dshHome,
      agentsHome,
      customSkillDirs: [],
    })

    const running = controller.importSkills(source)
    const joining = controller.importSkills(source)

    // One install at a time: the joining caller observes the install in
    // flight, so a second copy never reaches the directory and never reports
    // the name it was going to install as taken.
    expect(await joining).toBe(await running)
    await expect(readdir(join(dshHome, 'skills'))).resolves.toEqual(['serial-skill'])
  })

  it('refuses a source that would copy the user skills directory into itself', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-home-'))
    const agentsHome = await mkdtemp(join(tmpdir(), 'agents-home-'))
    const skillsDirectory = join(dshHome, 'skills')
    await writeSkill(skillsDirectory, 'resident-skill', 'Already installed.')
    // A manifest at the root of the skills directory itself: copying either
    // it or its parent would recurse through the staging folder an install
    // creates there.
    await writeFile(
      join(skillsDirectory, 'SKILL.md'),
      '---\nname: root-skill\ndescription: Root.\n---\n',
    )
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const controller = new SettingsController(ctx, {
      dshHome,
      agentsHome,
      customSkillDirs: [],
    })

    for (const source of [skillsDirectory, dshHome]) {
      const failure = await controller.importSkills(source).catch((error: unknown) => error)
      expect(remoteErrorOf(failure)).toMatchObject({ code: 'gateway/bad-request' })
    }
    await expect(readdir(skillsDirectory)).resolves.toEqual(['SKILL.md', 'resident-skill'])
  })

  it('refuses a declared name that cannot address a folder', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-home-'))
    const agentsHome = await mkdtemp(join(tmpdir(), 'agents-home-'))
    const sourceRoot = await mkdtemp(join(tmpdir(), 'skill-source-'))
    const source = await writeSkill(sourceRoot, 'hostile', 'Escapes its directory.')
    await writeFile(
      join(source, 'SKILL.md'),
      '---\nname: ../../escaped\ndescription: Escapes.\n---\n',
    )
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const controller = new SettingsController(ctx, {
      dshHome,
      agentsHome,
      customSkillDirs: [],
    })

    await expect(controller.importSkills(source)).resolves.toEqual([
      { imported: false, reason: 'invalid-frontmatter', detail: 'invalid-frontmatter' },
    ])
    // The accepted name is what addresses the target, so a rejected name
    // leaves the directory uncreated rather than writing outside it.
    await expect(stat(join(dshHome, 'skills')).catch(() => undefined)).resolves.toBeUndefined()
  })

  it('reports a folder and a file that carry no skill', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-home-'))
    const agentsHome = await mkdtemp(join(tmpdir(), 'agents-home-'))
    const sourceRoot = await mkdtemp(join(tmpdir(), 'skill-source-'))
    const empty = await mkdtemp(join(tmpdir(), 'skill-empty-'))
    const plain = join(sourceRoot, 'notes.txt')
    await writeFile(plain, 'prose only\n')
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const controller = new SettingsController(ctx, {
      dshHome,
      agentsHome,
      customSkillDirs: [],
    })

    for (const source of [empty, plain]) {
      await expect(controller.importSkills(source)).resolves.toEqual([
        { imported: false, reason: 'missing-skill-file', detail: source },
      ])
    }
    await expect(stat(join(dshHome, 'skills')).catch(() => undefined)).resolves.toBeUndefined()
  })

  it('refuses skill imports for an empty or absent source', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-home-'))
    const agentsHome = await mkdtemp(join(tmpdir(), 'agents-home-'))
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const controller = new SettingsController(ctx, {
      dshHome,
      agentsHome,
      customSkillDirs: [],
    })

    for (const source of ['', '/nonexistent/skill-folder']) {
      const failure = await controller.importSkills(source).catch((error: unknown) => error)
      expect(remoteErrorOf(failure)).toMatchObject({ code: 'gateway/bad-request' })
    }
  })

  it('refreshSkills rescans skill folders added after the first listing', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-home-'))
    const agentsHome = await mkdtemp(join(tmpdir(), 'agents-home-'))
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const controller = new SettingsController(ctx, {
      dshHome,
      agentsHome,
      customSkillDirs: [],
    })
    await writeSkill(join(dshHome, 'skills'), 'first-skill', 'First skill.')

    await expect(controller.listSkills()).resolves.toMatchObject({ skills: [expect.objectContaining({ name: 'first-skill' })] })
    await writeSkill(join(dshHome, 'skills'), 'second-skill', 'Second skill.')

    await expect(controller.refreshSkills()).resolves.toMatchObject({
      skills: [
        expect.objectContaining({ name: 'first-skill' }),
        expect.objectContaining({ name: 'second-skill' }),
      ],
    })
  })

  it('reports the entries discovery could not read beside the catalog', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-home-'))
    const agentsHome = await mkdtemp(join(tmpdir(), 'agents-home-'))
    const skillsRoot = join(dshHome, 'skills')
    await writeSkill(skillsRoot, 'readable-skill', 'A directly discoverable skill.')
    await writeSkill(join(skillsRoot, 'collection/skills'), 'first', 'First nested skill.')
    await writeSkill(join(skillsRoot, 'collection/skills'), 'second', 'Second nested skill.')
    await writeSkill(join(skillsRoot, 'broken'), 'broken', 'Broken.')
    await writeFile(join(skillsRoot, 'broken', 'SKILL.md'), 'Prose without frontmatter.\n')
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const controller = new SettingsController(ctx, { dshHome, agentsHome, customSkillDirs: [] })

    await expect(controller.listSkills()).resolves.toEqual({
      skills: [{
        name: 'readable-skill',
        description: 'A directly discoverable skill.',
        source: 'user-dsh',
        path: join(skillsRoot, 'readable-skill'),
      }],
      skipped: [
        { path: join(skillsRoot, 'broken', 'SKILL.md'), reason: 'invalid-frontmatter' },
        { path: join(skillsRoot, 'collection'), reason: 'nested-skills', nested: 2 },
      ],
    })
  })

  it('answers an empty listing when the deployment composes no skill registry', async () => {
    const controller = new SettingsController(new Context())

    await expect(controller.listSkills()).resolves.toEqual({ skills: [], skipped: [] })
  })

  it('rejects when a mounted registry fails to list', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'empty-skills-'))
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const controller = new SettingsController(ctx, {
      dshHome: empty,
      agentsHome: empty,
      customSkillDirs: [],
    })
    await controller.listSkills()
    vi.spyOn(ctx.skills, 'snapshot').mockRejectedValueOnce(new Error('listing exploded'))

    await expect(controller.listSkills()).rejects.toThrow('listing exploded')
  })

  it('opens the user skills directory under the configured home', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-home-'))
    const openPath = vi.fn(() => Promise.resolve())
    const controller = new SettingsController(new Context(), { dshHome }, { openPath })
    const signal = new AbortController().signal

    await expect(controller.openUserSkillsDirectory(signal)).resolves.toEqual({ opened: true })
    expect(openPath).toHaveBeenCalledWith(join(dshHome, 'skills'), signal)
  })

  it('returns the user skills directory path without a native opener', async () => {
    const controller = new SettingsController(
      new Context(),
      {
        dshHome: '/opt/dsh',
      },
      { canOpenPath: () => false },
    )

    await expect(controller.openUserSkillsDirectory(new AbortController().signal)).resolves.toEqual(
      { opened: false, path: join('/opt/dsh', 'skills') },
    )
  })

  it('classifies cancellation and non-Error failures from the skills opener', async () => {
    const abort = new AbortController()
    const openPath = vi
      .fn()
      .mockImplementationOnce(async () => {
        abort.abort(new Error('cancelled'))
        throw new Error('opening stopped')
      })
      .mockRejectedValueOnce('desktop unavailable')
    const controller = new SettingsController(
      new Context(),
      {
        dshHome: '/opt/dsh',
      },
      { openPath },
    )

    await expect(controller.openUserSkillsDirectory(abort.signal)).rejects.toMatchObject({
      code: 'gateway/cancelled',
    })
    await expect(
      controller.openUserSkillsDirectory(new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'gateway/internal',
      message: 'path open failed: desktop unavailable',
    })
  })
})
