/** locale-fr pack wiring: French language registration, one dictionary per
 * namespace, live switching, English fallback, and clean disposal. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, FRENCH_LOCALE_ID, inject, name } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

/** One proven key per namespace: guards the namespace name and a real value. */
const SPOT_CHECKS: ReadonlyArray<readonly [ns: string, key: string, expected: string]> = [
  ['common', 'save', 'Enregistrer'],
  ['settings', 'general.nav', 'Général'],
  ['settings.locale', 'language.title', 'Langue'],
  ['settings.theme', 'appearance.dark', 'Sombre'],
  ['settings.models', 'add', 'Ajouter un fournisseur'],
  ['settings.plugins', 'save', 'Enregistrer'],
  ['settings.pluginInventory', 'tab', 'Liste des plugins'],
  ['settings.agentPreset', 'duplicate', 'Dupliquer'],
  ['settings.permission', 'title', 'Autorisations'],
  ['permission.access', 'confirm.enable', 'Activer l’accès complet'],
  ['chat', 'chat.loadingHistory', 'Chargement de l’historique…'],
  ['conversation', 'input.send', 'Envoyer le message'],
  ['trajectory', 'view.trajectory', 'Trajectoire'],
  ['skill', 'row.running', 'Chargement du skill'],
  ['subagent', 'tree.aria', 'Sessions des sous-agents'],
  ['model', 'menu.model', 'Modèle'],
  ['question', 'plan.approve', 'Approuver'],
  ['feedback', 'note.save', 'Enregistrer'],
  ['sidebar', 'session.new', 'Nouvelle session'],
  ['sidebarFiles', 'guide.title', 'Fichiers'],
  ['sidebarRight', 'dock.addTab', 'Nouvel onglet'],
  ['sidebarTextpreview', 'wrap', 'Retour à la ligne automatique'],
  ['workspace', 'section.workspaces', 'Espaces de travail'],
  ['reference', 'crumb.root', 'Espace de travail'],
  ['directory-browser', 'browser.create', 'Créer'],
  ['open-in-app', 'menu.toggle', 'Choisir une application pour ouvrir'],
  ['approval', 'allowOnce', 'Autoriser une fois'],
  ['plan', 'chip.exitFailed', 'Échec de la sortie du mode plan'],
  ['goal', 'action.save', 'Enregistrer l’objectif'],
  ['job', 'list.aria', 'Tâches de fond'],
  ['schedule.catalog', 'status.overdue', 'En retard'],
  ['workflowRun', 'run.empty', 'Aucun membre démarré'],
  ['deliverables', 'produced.label', 'Productions'],
  ['command', 'status.empty', 'Aucune option'],
  ['slash.menu', 'drill.key', 'Tab'],
]

async function bench() {
  const ctx = new Context()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const fiber = await ctx.plugin({ inject: [...inject], apply })
  return { ctx, locale, fiber }
}

describe('locale-fr pack', () => {
  it('exposes the plugin contract the loader needs', () => {
    expect(name).toBe('locale-fr')
    expect(inject).toEqual(['locale'])
    expect(hostApply).not.toThrow()
  })

  it('registers Français with an English fallback', async () => {
    const { locale, fiber } = await bench()
    try {
      const definition = locale.getLocale().locales.find(entry => entry.id === FRENCH_LOCALE_ID)
      expect(definition).toMatchObject({ id: 'fr', label: 'Français', fallback: 'en' })
    } finally {
      await fiber.dispose()
    }
  })

  it('resolves one French value per namespace once active', async () => {
    const { locale, fiber } = await bench()
    try {
      locale.setLocale('fr')
      for (const [ns, key, expected] of SPOT_CHECKS) {
        expect(locale.bind(ns)(key), `${ns}:${key}`).toBe(expected)
      }
    } finally {
      await fiber.dispose()
    }
  })

  it('interpolates params through the French template', async () => {
    const { locale, fiber } = await bench()
    try {
      locale.setLocale('fr')
      expect(locale.bind('workspace')('sessions.expand', { n: 3 })).toBe(
        'Afficher 3 sessions de plus',
      )
      expect(locale.bind('approval')('escalation', { toolName: 'bash' })).toBe(
        'L’outil bash demande une exécution privilégiée',
      )
    } finally {
      await fiber.dispose()
    }
  })

  it('passes unknown keys through without inventing a value', async () => {
    const { locale, fiber } = await bench()
    try {
      locale.setLocale('fr')
      // A namespace outside the merge table (untyped bind arm) stands in for
      // a key the pack does not translate: lookup falls through every
      // dictionary and the chain, then renders the key itself.
      expect(locale.bind('unknown-ns')('no.such.key')).toBe('no.such.key')
      locale.setLocale('en')
      expect(locale.bind('unknown-ns')('no.such.key')).toBe('no.such.key')
    } finally {
      await fiber.dispose()
    }
  })

  it('removes the language and its dictionaries on dispose', async () => {
    const { locale, fiber } = await bench()
    locale.setLocale('fr')
    await fiber.dispose()
    expect(() => {
      locale.setLocale('fr')
    }).toThrow('locale "fr" is not registered')
    expect(locale.getLocale().locales.some(entry => entry.id === 'fr')).toBe(false)
  })

  it('rolls everything back when one dictionary hits a rival owner', async () => {
    const ctx = new Context()
    const locale = new LocaleRuntime(ctx)
    ctx.provide('locale', locale)
    const squat = locale.register('chat', 'fr', { 'view.chat': 'Rival' })
    // A failed activation surfaces as a rejected plugin promise.
    await expect(ctx.plugin({ inject: [...inject], apply })).rejects.toThrow(
      'locale namespace "chat" already has locale "fr"',
    )
    // The language definition rolled back with the dictionaries.
    expect(locale.getLocale().locales.some(entry => entry.id === FRENCH_LOCALE_ID)).toBe(false)
    // The rival registration survived: the rollback only removed its own rows.
    const addBack = locale.addLanguage({ id: 'fr', label: 'Rival', fallback: 'en' })
    try {
      locale.setLocale('fr')
      expect(locale.bind('chat')('view.chat')).toBe('Rival')
    } finally {
      squat()
      addBack()
    }
    // With the rival gone, nothing of the pack remains either.
    expect(locale.bind('chat')('view.chat')).toBe('view.chat')
  })
})
