/**
 * Deployment-wide skill inventory behind the settings Skills tab.
 *
 * The skill registry is layered per scope: a preset's `skill-filesystem` row
 * registers into that preset's layer, so a scope-free `ctx.skills.list({})`
 * reads only the deployment's global rows. The settings surface must list the
 * local skill roots (`user-dsh`, `user-agents`, `custom`) with no session
 * running, and must not change what any agent sees. It therefore mints its own
 * scope, mounts one `skill-filesystem` discovery row there with host watching
 * off, and reads the merged catalog under that scope: global rows plus its own
 * local roots, never another scope's.
 *
 * @module @deepseek-ai/dsh-api-settings-controller/skill-listing
 */

import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { createScope, type Scope, type ScopeKey } from '@deepseek-ai/dsh-scope'
import type { SkillDiscoverySkip, SkillSummary } from '@deepseek-ai/dsh-skill'
import type { Config as SkillFilesystemConfig } from '@deepseek-ai/dsh-skill-filesystem'

/** Local roots the settings skill listing discovers, overriding provider defaults. */
export interface SkillListingConfig {
  /** DeepSeek Harness config root; defaults to `$DSH_HOME` or `~/.dsh`. */
  readonly dshHome?: string
  /** Shared agent config root; defaults to `$DSH_AGENTS_HOME` or `~/.agents`. */
  readonly agentsHome?: string
  /** Additional skill roots scanned after project roots and before user roots. */
  readonly customSkillDirs?: string[]
}

/** One listing observation: the catalog plus the entries that yielded no skill. */
export interface SkillListingValue {
  /** Every discovered skill, in catalog order. */
  readonly skills: readonly SkillSummary[]
  /** Entries that yielded no skill, so the tab can say why one is missing. */
  readonly skipped: readonly SkillDiscoverySkip[]
}

/** Settings-owned skill discovery, isolated from every agent scope. */
export class SkillListing {
  private key: ScopeKey = {}
  private readonly ctx: Context
  private readonly config: SkillListingConfig
  private row: Promise<void> | undefined
  private scope: Scope | undefined
  private refreshing: Promise<SkillListingValue> | undefined

  /**
   * @param ctx - the settings controller's context; it owns the listing scope.
   * @param config - local roots the discovery row reads.
   */
  constructor(ctx: Context, config: SkillListingConfig) {
    this.ctx = ctx
    this.config = config
  }

  /**
   * List every skill this deployment installs without a session: the global
   * rows (repository plugins, runtime registrations) plus the settings scope's
   * local roots.
   * @returns merged, sorted skill summaries and the entries discovery could not
   *   read; both empty when the deployment composes no skill registry.
   */
  async list(): Promise<SkillListingValue> {
    const skills = this.ctx.get('skills')
    if (skills === undefined) return { skills: [], skipped: [] }
    await this.mountRow()
    const snapshot = await skills.snapshot({ scope: this.key })
    return { skills: snapshot.skills, skipped: snapshot.skipped }
  }

  /**
   * Absolute path of the user skill directory skills are installed into.
   * @returns `<dshHome>/skills` under the resolved DeepSeek Harness home.
   */
  userSkillsDirectory(): string {
    return join(resolveDshHome(this.config.dshHome), 'skills')
  }

  /**
   * Re-discover the local skill roots: dispose the mounted discovery row (its
   * fiber disposal unregisters the provider and invalidates the registry's
   * collect cache), then mount a fresh row under a new scope key so the next
   * `list()` rescans the directories. Used after an on-disk skill import and by
   * the settings UI's refresh action; watching stays off between calls.
   * @returns the freshly discovered skill summaries.
   */
  async refresh(): Promise<SkillListingValue> {
    return (this.refreshing ??= (async () => {
      try {
        const previous = this.scope
        this.scope = undefined
        this.row = undefined
        this.key = {}
        if (previous !== undefined) await previous.dispose()
        await this.mountRow()
        return await this.list()
      } finally {
        this.refreshing = undefined
      }
    })())
  }

  /** Mount the discovery row once, into the settings scope's own registry layer. */
  private async mountRow(): Promise<void> {
    this.row ??= (async () => {
      const scope = createScope(this.ctx, this.key)
      this.scope = scope
      const config: SkillFilesystemConfig = {
        providerName: 'settings-filesystem',
        watch: false,
        ...(this.config.dshHome === undefined ? {} : { dshHome: this.config.dshHome }),
        ...(this.config.agentsHome === undefined ? {} : { agentsHome: this.config.agentsHome }),
        ...(this.config.customSkillDirs === undefined
          ? {}
          : { customSkillDirs: [...this.config.customSkillDirs] }),
      }
      // Imported lazily: the provider is an optional peer, so a deployment
      // that composes no skill registry must not fail while loading this module.
      const { apply, inject } = await import('@deepseek-ai/dsh-skill-filesystem')
      await scope.ctx.plugin({ name: 'skill-filesystem', inject, apply }, config)
    })()
    await this.row
  }
}
