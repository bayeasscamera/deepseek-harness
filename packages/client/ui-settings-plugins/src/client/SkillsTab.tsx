/**
 * Skills dashboard tab for the Plugins Settings section.
 *
 * Lists all globally registered skills (user-dsh, user-agents, custom),
 * imports a picked host folder into the user skill directory, rescans the
 * local roots, and opens the user skill directory in the native file manager.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import clsx from 'clsx'
import css from './SkillsTab.module.css'

/** Summary of one skill as received by the skills tab. */
export interface SkillEntry {
  readonly name: string
  readonly description: string
  readonly source: string
  readonly path?: string
}

/** Why one entry in the skill roots yielded no skill; mirrors the host's wire type. */
export type SkillSkipReason =
  | 'nested-skills'
  | 'invalid-frontmatter'
  | 'missing-name'
  | 'invalid-name'
  | 'unreadable'

/** One entry the skill roots hold that discovery could not turn into a skill. */
export interface SkillSkip {
  /** Absolute path of the entry that yielded no skill. */
  readonly path: string
  /** Why it yielded no skill. */
  readonly reason: SkillSkipReason
  /** `SKILL.md` manifests counted below the entry, for `nested-skills`. */
  readonly nested?: number
  /** Whether the count stopped at its scan bound, so the entry holds more. */
  readonly truncated?: boolean
}

/** One catalog observation: the skills it found and the entries it could not read. */
export interface SkillListing {
  /** Every discovered skill, in catalog order. */
  readonly skills: readonly SkillEntry[]
  /** Entries that yielded no skill, so the tab can say why one is missing. */
  readonly skipped: readonly SkillSkip[]
}

/** Why the host refused a skill import; mirrors the settings controller's wire type. */
export type SkillImportRejection = 'missing-skill-file' | 'invalid-frontmatter' | 'exists'

/** Outcome of one discovered skill: installed or refused with a cause. */
export type SkillImportOutcome =
  | { readonly kind: 'imported'; name: string; path: string }
  | { readonly kind: 'rejected'; reason: SkillImportRejection }

/** What one import of a picked folder or file resolved to. */
export interface SkillImportReport {
  /** One outcome per skill the host found, installed and refused alike. */
  readonly outcomes: readonly SkillImportOutcome[]
}

/** Remote-driven injected face for the skills tab. */
export interface SkillsTabInjected {
  /** List all globally registered skills and the entries that yielded none. */
  listSkills: () => Promise<SkillListing>
  /** Re-scan the local skill roots and resolve with the fresh catalog. */
  refreshSkills: () => Promise<SkillListing>
  /** Open the user skills directory; resolves with an opened/fallback result. */
  openDirectory: (signal: AbortSignal) => Promise<{ opened: boolean; path?: string }>
  /**
   * Pick a host folder or file and install every skill it carries; resolves
   * `undefined` when the pick was cancelled. The catalog is re-read through
   * `refreshSkills`.
   */
  importSkills: (signal: AbortSignal) => Promise<SkillImportReport | undefined>
}

/** Full component props assembled by the Settings slot renderer. */
export type SkillsTabProps = PropsRuntime<'settings.plugins.tab'> &
  PropsLocale<'settings.plugins'> &
  InjectFace<SkillsTabInjected>

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; skills: readonly SkillEntry[]; skipped: readonly SkillSkip[] }
  | { kind: 'failed'; message: string }

type OpenState =
  | { kind: 'idle' }
  | { kind: 'opening' }
  | { kind: 'opened' }
  | { kind: 'fallback'; path: string }
  | { kind: 'failed' }

type ImportState =
  | { kind: 'idle' }
  | { kind: 'importing' }
  | { kind: 'done'; installed: readonly string[]; refused: SkillImportRejection | undefined }
  | { kind: 'failed' }

/** Locale key for the reason one entry yielded no skill. */
const SKIP_REASON_KEY = {
  'nested-skills': 'skillsSkipNested',
  'invalid-frontmatter': 'skillsSkipInvalidFrontmatter',
  'missing-name': 'skillsSkipMissingName',
  'invalid-name': 'skillsSkipInvalidName',
  unreadable: 'skillsSkipUnreadable',
} as const

/** Entries the notice names before it summarizes the rest. */
const SKIP_NOTICE_MAX_ENTRIES = 10

/** Locale key for each host rejection cause. */
const IMPORT_REASON_KEY = {
  'missing-skill-file': 'skillsImportMissing',
  'invalid-frontmatter': 'skillsImportInvalid',
  exists: 'skillsImportExists',
} as const

/** How long a transient success message stays on screen, in milliseconds. */
const IMPORT_SUCCESS_FEEDBACK_MS = 4000
/** How long a transient refusal or failure message stays on screen, in milliseconds. */
const IMPORT_FAILURE_FEEDBACK_MS = 6000
/** How long the native-opener confirmation stays on screen, in milliseconds. */
const OPEN_FEEDBACK_MS = 3000
/** How long the copied-path marker stays on screen, in milliseconds. */
const COPY_FEEDBACK_MS = 2000

/** Skills tab — catalog with import, refresh, and directory shortcut. */
export function SkillsTab({
  listSkills,
  refreshSkills,
  openDirectory,
  importSkills,
  t,
}: SkillsTabProps): ReactNode {
  const [load, setLoad] = useState<LoadState>({ kind: 'idle' })
  const [open, setOpen] = useState<OpenState>({ kind: 'idle' })
  const [importState, setImportState] = useState<ImportState>({ kind: 'idle' })
  const [copied, setCopied] = useState<string | undefined>(undefined)
  const abortRef = useRef<AbortController | null>(null)
  const importAbortRef = useRef<AbortController | null>(null)
  // Transient feedback clears itself, and a timer that outlives the tab would
  // set state on an unmounted component, so the same set is drained on unmount.
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>())

  /** Return to `reset` after `delayMs`, unless the tab unmounts first. */
  const flash = (delayMs: number, reset: () => void): void => {
    const timer = setTimeout(() => {
      timersRef.current.delete(timer)
      reset()
    }, delayMs)
    timersRef.current.add(timer)
  }

  /** Load the catalog through `fetch`, ignoring a superseded request. */
  const runCatalog = (fetch: () => Promise<SkillListing>): void => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoad({ kind: 'loading' })
    fetch()
      .then((listing) => {
        if (!controller.signal.aborted) {
          setLoad({ kind: 'loaded', skills: listing.skills, skipped: listing.skipped })
        }
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setLoad({ kind: 'failed', message: err instanceof Error ? err.message : String(err) })
        }
      })
  }

  useEffect(() => {
    runCatalog(listSkills)
    const timers = timersRef.current
    return () => {
      abortRef.current?.abort()
      importAbortRef.current?.abort()
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
    }
  }, [])

  const handleImport = (): void => {
    importAbortRef.current?.abort()
    const controller = new AbortController()
    importAbortRef.current = controller
    setImportState({ kind: 'importing' })
    importSkills(controller.signal)
      .then((report) => {
        if (controller.signal.aborted) return
        if (report === undefined) {
          // The host picker was dismissed, so there is nothing to report.
          setImportState({ kind: 'idle' })
          return
        }
        // A picked folder can carry several skills, some of which are refused, so
        // the report names what was installed and why the rest were not.
        const installed = report.outcomes.filter(outcome => outcome.kind === 'imported')
        const refused = report.outcomes.find(outcome => outcome.kind === 'rejected')
        setImportState({
          kind: 'done',
          installed: installed.map(outcome => outcome.name),
          refused: refused?.kind === 'rejected' ? refused.reason : undefined,
        })
        flash(
          installed.length > 0 ? IMPORT_SUCCESS_FEEDBACK_MS : IMPORT_FAILURE_FEEDBACK_MS,
          () => {
            setImportState({ kind: 'idle' })
          },
        )
        if (installed.length > 0) {
          // The import installed folders discovery has not seen yet, so the
          // catalog is re-read through the host's rescan rather than the cache.
          runCatalog(refreshSkills)
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setImportState({ kind: 'failed' })
          flash(IMPORT_FAILURE_FEEDBACK_MS, () => {
            setImportState({ kind: 'idle' })
          })
        }
      })
  }

  const handleOpenDirectory = (): void => {
    const controller = new AbortController()
    setOpen({ kind: 'opening' })
    openDirectory(controller.signal)
      .then((result) => {
        if (result.opened) {
          setOpen({ kind: 'opened' })
          flash(OPEN_FEEDBACK_MS, () => {
            setOpen({ kind: 'idle' })
          })
        } else {
          // No native opener took the request, so the path itself becomes the
          // answer the user needs.
          setOpen({ kind: 'fallback', path: result.path ?? '' })
        }
      })
      .catch(() => {
        setOpen({ kind: 'failed' })
        flash(OPEN_FEEDBACK_MS, () => {
          setOpen({ kind: 'idle' })
        })
      })
  }

  const handleCopyPath = (path: string): void => {
    void navigator.clipboard.writeText(path).then(
      () => {
        setCopied(path)
        flash(COPY_FEEDBACK_MS, () => {
          setCopied(undefined)
        })
      },
      () => {
        setCopied(undefined)
      },
    )
  }

  const busy = load.kind === 'loading' || importState.kind === 'importing'

  return (
    <div className={css.root}>
      <div className={css.toolbar}>
        <button type="button" className={css.openBtn} disabled={busy} onClick={handleImport}>
          {t('skillsImport')}
        </button>
        <button
          type="button"
          className={css.openBtn}
          disabled={busy}
          onClick={() => {
            runCatalog(refreshSkills)
          }}
        >
          {t('skillsRefresh')}
        </button>
        <button
          type="button"
          className={css.openBtn}
          disabled={busy || open.kind === 'opening'}
          onClick={handleOpenDirectory}
        >
          {t('skillsOpenDirectory')}
        </button>
        <span className={css.openFeedback} role="status" aria-live="polite">
          {importState.kind === 'importing' && t('skillsImporting')}
          {importState.kind === 'failed' && t('skillsImportFailed')}
          {open.kind === 'opened' && t('skillsOpened')}
          {open.kind === 'failed' && t('skillsOpenFailed')}
        </span>
        {/* An import reports what it installed and what it refused as separate
            messages, so a partly successful run reads as two facts. */}
        {importState.kind === 'done' && importState.installed.length > 0 && (
          <span className={css.openFeedback} role="status" aria-live="polite">
            {`${t('skillsImported')} ${importState.installed.join(', ')}`}
          </span>
        )}
        {importState.kind === 'done' && importState.refused !== undefined && (
          <span
            className={clsx(css.openFeedback, css.openFeedbackError)}
            role="status"
            aria-live="polite"
          >
            {t(IMPORT_REASON_KEY[importState.refused])}
          </span>
        )}
      </div>
      {open.kind === 'fallback' && (
        <p className={css.hint}>
          {open.path}
          <button
            type="button"
            className={css.copyBtn}
            onClick={() => {
              handleCopyPath(open.path)
            }}
          >
            {copied === open.path ? '✓' : t('skillsCopyPath')}
          </button>
        </p>
      )}
      <p className={css.hint}>{t('skillsOpenDirectoryHint')}</p>

      {load.kind === 'loading' && <div className={css.status}>{t('skillsLoading')}</div>}
      {load.kind === 'failed' && (
        <div className={css.statusError}>
          <span>
            {t('skillsLoadFailed')} {load.message ? `(${load.message})` : ''}
          </span>
          <button
            type="button"
            className={css.retryBtn}
            onClick={() => {
              runCatalog(listSkills)
            }}
          >
            {t('skillsRetry')}
          </button>
        </div>
      )}
      {load.kind === 'loaded' && load.skipped.length > 0 && (
        <div className={css.skipNotice} role="status">
          <span className={css.skipTitle}>{t('skillsSkipTitle')}</span>
          <ul className={css.skipList}>
            {load.skipped.slice(0, SKIP_NOTICE_MAX_ENTRIES).map(skip => (
              <li key={`${skip.reason}:${skip.path}`} className={css.skipItem}>
                <span className={css.skipPath} title={skip.path}>{skip.path}</span>
                <span className={css.skipReason}>
                  {skip.reason === 'nested-skills'
                    ? t(
                      skip.truncated === true ? 'skillsSkipNestedTruncated' : SKIP_REASON_KEY[skip.reason],
                      { count: skip.nested ?? 0 },
                    )
                    : t(SKIP_REASON_KEY[skip.reason])}
                </span>
              </li>
            ))}
          </ul>
          {load.skipped.length > SKIP_NOTICE_MAX_ENTRIES && (
            <span className={css.skipReason}>
              {t('skillsSkipMore', { count: load.skipped.length - SKIP_NOTICE_MAX_ENTRIES })}
            </span>
          )}
        </div>
      )}
      {load.kind === 'loaded' && load.skills.length === 0 && (
        <div className={css.status}>{t('skillsEmpty')}</div>
      )}
      {load.kind === 'loaded' && load.skills.length > 0 && (
        <table className={css.table}>
          <thead>
            <tr>
              <th className={css.th}>{t('skillsName')}</th>
              <th className={css.th}>{t('skillsDescription')}</th>
              <th className={css.th}>{t('skillsSource')}</th>
              <th className={css.th}>{t('skillsPath')}</th>
            </tr>
          </thead>
          <tbody>
            {load.skills.map((skill) => {
              const path = skill.path
              return (
                <tr key={skill.name} className={css.row}>
                  <td className={clsx(css.td, css.name)}>{skill.name}</td>
                  <td className={clsx(css.td, css.desc)}>{skill.description}</td>
                  <td className={css.td}>
                    <span className={css.source}>{skill.source}</span>
                  </td>
                  <td className={clsx(css.td, css.pathCell)}>
                    {path !== undefined && (
                      <>
                        <span className={css.pathText} title={path}>
                          {path.split('/').pop()}
                        </span>
                        <button
                          type="button"
                          className={css.copyBtn}
                          title={path}
                          onClick={() => {
                            handleCopyPath(path)
                          }}
                        >
                          {copied === path ? '✓' : t('skillsCopyPath')}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
