/**
 * Shell root: boot loading page → (boot settled) → real UI in one switch.
 * Pure kernel component with zero plugin dependencies — before settled it may
 * only rely on itself (the fail-loud presentation must not depend on the
 * system whose failure it reports; the status/signal stores are kernel-own,
 * shell self-sufficiency rule); the real UI is produced by the
 * app-shell entry once every entry is active. A failed boot keeps the
 * loading page, lists the per-entry fiber states and the sweep report (fail
 * loud, no partial UI).
 */
import { Component, useSyncExternalStore } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import type { KernelSignal, LoaderStatus } from './loader-status.ts'
import css from './AppRoot.module.css'

interface AppErrorBoundaryProps {
  children: ReactNode
}

interface AppErrorBoundaryState {
  error: Error | null
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  override state: AppErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Unhandled application error:', error, errorInfo)
  }

  override render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <div className={css.boot}>
          <div className={css.card}>
            <div className={css.wordmark}>HARNESS</div>
            <div className={css.failed}>
              <div className={css.failedTitle}>Application Error</div>
              <div className={css.failedItem}>{this.state.error.message || 'An unexpected error occurred during execution.'}</div>
              <button
                type="button"
                className={css.reloadButton}
                onClick={() => {
                  window.location.reload()
                }}
              >
                Reload Application
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

/** AppRoot props: settled signal, fiber-state projection feed, boot failure report, deferred real-UI factory. */
export interface AppRootProps {
  /** True once the boot chain settled (loader quiesced + all entries ACTIVE); the boot closure flips it. */
  settled: KernelSignal<boolean>
  /** Per-entry fiber-state projection store (drives loading/failed rendering). */
  status: KernelSignal<LoaderStatus>
  /** Boot failure report (the settle rejection message); undefined while loading or after success. */
  error: KernelSignal<string | undefined>
  /** Builds the real UI; called only after settled. */
  renderApp: () => ReactNode
}

/**
 * Invokes the deferred real-UI factory inside the boundary's child tree. A
 * factory called directly in AppRoot's render would throw while AppRoot itself
 * renders — before the boundary element exists — and escape it; rendering the
 * factory from a child puts the throw inside the boundary's subtree, where the
 * boundary catches it.
 */
function BoundaryChild({ factory }: { factory: () => ReactNode }) {
  return <>{factory()}</>
}

/** Boot gate: loading page until the boot settles; failures stay here. */
export function AppRoot(props: AppRootProps) {
  const settled = useSyncExternalStore(props.settled.subscribe, props.settled.getSnapshot)
  const status = useSyncExternalStore(props.status.subscribe, props.status.getSnapshot)
  const error = useSyncExternalStore(props.error.subscribe, props.error.getSnapshot)
  const failed = Object.entries(status).filter(([, s]) => s === 'failed')

  if (settled) {
    return <AppErrorBoundary><BoundaryChild factory={props.renderApp} /></AppErrorBoundary>
  }

  const loud = error !== undefined || failed.length > 0

  return (
    <div className={css.boot}>
      <div className={css.card}>
        <div className={css.wordmark}>HARNESS</div>
        {!loud
          ? (
            <>
              <div className={css.spinner} />
              <div className={css.hint}>Loading plugins…</div>
            </>
          )
          : (
            <div className={css.failed}>
              <div className={css.failedTitle}>Failed to load plugins</div>
              {failed.map(([id]) => <div key={id} className={css.failedItem}>{id}</div>)}
              {error !== undefined && <div className={css.failedItem}>{error}</div>}
            </div>
          )}
      </div>
    </div>
  )
}
