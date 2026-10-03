/**
 * French language pack, browser half. Registers the `fr` locale (falling
 * back to English, never to another language) plus one complete French
 * dictionary per client namespace, so selecting Français in
 * Settings → General renders the whole GUI in French. A key absent from a
 * French table resolves through the English fallback at lookup time.
 *
 * @module @deepseek-ai/dsh-client-locale-fr/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import {
  agentPresetFr,
  commonFr,
  permissionAccessFr,
  permissionSettingsFr,
  pluginInventoryFr,
  settingsFr,
  settingsLocaleFr,
  settingsModelsFr,
  settingsPluginsFr,
  settingsThemeFr,
} from './dicts-core.ts'
import {
  chatFr,
  conversationFr,
  feedbackFr,
  modelFr,
  questionFr,
  skillFr,
  subagentFr,
  trajectoryFr,
} from './dicts-chat.ts'
import {
  approvalFr,
  commandFr,
  deliverablesFr,
  directoryBrowserFr,
  goalFr,
  jobFr,
  openInAppFr,
  planFr,
  referenceFr,
  scheduleCatalogFr,
  sidebarFilesFr,
  sidebarFilepreviewFr,
  sidebarFr,
  sidebarRightFr,
  sidebarTextpreviewFr,
  slashMenuFr,
  workflowRunFr,
  workspaceFr,
} from './dicts-shell.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'locale-fr'

/** The locale service this pack contributes to. */
export const inject = ['locale']

/** Stable BCP 47 id stored as the locale preference. */
export const FRENCH_LOCALE_ID = 'fr'

/** Display name written in the represented language. */
export const FRENCH_LOCALE_LABEL = 'Français'

/** One French dictionary per client namespace. */
const FRENCH_DICTIONARIES: Readonly<Record<string, Record<string, string>>> = {
  common: commonFr,
  settings: settingsFr,
  'settings.locale': settingsLocaleFr,
  'settings.theme': settingsThemeFr,
  'settings.models': settingsModelsFr,
  'settings.plugins': settingsPluginsFr,
  'settings.pluginInventory': pluginInventoryFr,
  'settings.agentPreset': agentPresetFr,
  'settings.permission': permissionSettingsFr,
  'permission.access': permissionAccessFr,
  chat: chatFr,
  conversation: conversationFr,
  trajectory: trajectoryFr,
  skill: skillFr,
  subagent: subagentFr,
  model: modelFr,
  question: questionFr,
  feedback: feedbackFr,
  sidebar: sidebarFr,
  sidebarFiles: sidebarFilesFr,
  sidebarFilepreview: sidebarFilepreviewFr,
  sidebarRight: sidebarRightFr,
  sidebarTextpreview: sidebarTextpreviewFr,
  workspace: workspaceFr,
  reference: referenceFr,
  'directory-browser': directoryBrowserFr,
  'open-in-app': openInAppFr,
  approval: approvalFr,
  plan: planFr,
  goal: goalFr,
  job: jobFr,
  'schedule.catalog': scheduleCatalogFr,
  workflowRun: workflowRunFr,
  deliverables: deliverablesFr,
  command: commandFr,
  'slash.menu': slashMenuFr,
}

/**
 * Register the French language and its dictionaries. The language
 * definition and every dictionary land as a unit: if any registration hits
 * a rival owner, everything installed so far rolls back before the throw —
 * a failed activation must not squat half the French copy.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const disposers: (() => void)[] = []
    try {
      disposers.push(
        ctx.locale.addLanguage({
          id: FRENCH_LOCALE_ID,
          label: FRENCH_LOCALE_LABEL,
          fallback: 'en',
        }),
      )
      for (const [ns, dict] of Object.entries(FRENCH_DICTIONARIES)) {
        disposers.push(ctx.locale.register(ns, FRENCH_LOCALE_ID, dict))
      }
    } catch (error) {
      for (const dispose of disposers.reverse()) dispose()
      throw error
    }
    return () => {
      for (const dispose of disposers.reverse()) dispose()
    }
  }, 'locale-fr: French language and dictionaries')
}
