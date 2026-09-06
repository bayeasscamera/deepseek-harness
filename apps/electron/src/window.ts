import * as path from 'node:path'
import * as fs from 'node:fs'
import { BrowserWindow, dialog, nativeTheme, shell } from 'electron'
import { type WindowStateManager } from './window-state.js'
import { type AppLogger } from './logger.js'
import { LOAD_RETRY_BASE_MS, LOAD_RETRY_MAX_ATTEMPTS, RENDERER_RELOAD_DELAY_MS } from './tunables.js'

/** Chromium network error codes worth a transient-load retry. */
const TRANSIENT_LOAD_ERROR_CODES = new Set([-102, -105, -106, -109])

/**
 * Path of the bundled loading page: exists next to the compiled main.js in dist/.
 * Returns undefined when running from source without the copied HTML.
 */
function loadingPagePath(): string | undefined {
  const candidate = path.join(__dirname, 'loading.html')
  return fs.existsSync(candidate) ? candidate : undefined
}

/**
 * The backend URL each window is currently bound to; the resilience handlers
 * read it at event time so a restart can re-point an existing window without
 * re-registering duplicate listeners.
 */
const navigationTargets = new WeakMap<BrowserWindow, string>()

/**
 * Create the application window and show the bundled loading page. The window
 * is ready before the backend has started — `navigateApplicationWindow` binds
 * it to the backend URL once the server reports one.
 * @param windowStateManager - saved geometry owner.
 * @param logger - app logger.
 * @param onClosed - called when the window closes.
 * @returns the created window.
 */
export function createApplicationWindow(
  windowStateManager: WindowStateManager,
  logger: AppLogger,
  onClosed: () => void,
): BrowserWindow {
  const savedState = windowStateManager.getState()

  const win = new BrowserWindow({
    x: savedState.x,
    y: savedState.y,
    width: savedState.width,
    height: savedState.height,
    minWidth: 900,
    minHeight: 600,
    title: 'DeepSeek Harness',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d0d0d' : '#ffffff',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  })

  windowStateManager.track(win)

  if (savedState.x === undefined || savedState.y === undefined) {
    win.center()
  }

  if (savedState.isMaximized) {
    win.maximize()
  }

  // Show only once the renderer has painted: an immediately shown window
  // flashes blank white before the first frame is ready.
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })

  // ── Crash & Hang Resilience ────────────────────────────────────────────────
  // Automatically recover if the Chromium renderer crashes or is killed by OS
  win.webContents.on('render-process-gone', (_event, details) => {
    logger.error(`Renderer process gone (reason: ${details.reason}, exitCode: ${details.exitCode})`)
    if (details.reason !== 'clean-exit' && navigationTargets.has(win)) {
      logger.log('Attempting automatic reload to restore UI...')
      setTimeout(() => {
        const targetUrl = navigationTargets.get(win)
        if (!win.isDestroyed() && targetUrl !== undefined) {
          void win.loadURL(targetUrl).catch((err: unknown) => {
            logger.error('Failed to reload UI after crash:', err)
          })
        }
      }, RENDERER_RELOAD_DELAY_MS)
    }
  })

  win.webContents.on('unresponsive', () => {
    logger.warn('Renderer thread became unresponsive.')
  })

  win.webContents.on('responsive', () => {
    logger.log('Renderer thread recovered responsiveness.')
  })

  const loadRetries = new WeakMap<BrowserWindow, number>()
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    const targetUrl = navigationTargets.get(win)
    if (targetUrl === undefined) return
    logger.warn(`Failed to load ${targetUrl} (code: ${String(errorCode)}, error: ${errorDescription})`)
    if (!TRANSIENT_LOAD_ERROR_CODES.has(errorCode)) return
    // A bounded retry with linear backoff; past the budget the failure is
    // surfaced loudly instead of spinning forever on a dead backend.
    const attempted = loadRetries.get(win) ?? 0
    if (attempted >= LOAD_RETRY_MAX_ATTEMPTS) {
      logger.error(`Giving up on ${targetUrl} after ${String(attempted)} failed load attempts (last code: ${String(errorCode)})`)
      dialog.showErrorBox(
        'DeepSeek Harness',
        `The interface could not be loaded from ${targetUrl} after ${String(LOAD_RETRY_MAX_ATTEMPTS)} attempts (error ${String(errorCode)}: ${errorDescription}).`,
      )
      return
    }
    loadRetries.set(win, attempted + 1)
    const delay = LOAD_RETRY_BASE_MS * (attempted + 1)
    logger.log(`Retrying UI load (attempt ${String(attempted + 1)}/${String(LOAD_RETRY_MAX_ATTEMPTS)}) in ${String(delay)}ms...`)
    setTimeout(() => {
      if (!win.isDestroyed()) {
        void win.loadURL(targetUrl).catch((err: unknown) => {
          // The next did-fail-load event owns the retry or the give-up.
          logger.warn('UI load retry failed:', err)
        })
      }
    }, delay)
  })

  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    logger.error(`Preload error (${preloadPath}):`, error)
  })

  // Capture all renderer console errors/warnings in log file
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) {
      // 2 = warning, 3 = error
      logger.warn(`[Renderer] ${message} (${sourceId}:${line})`)
    }
  })

  // Block opening unvetted popups / new windows
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) {
      return { action: 'allow' }
    }
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Prevent navigation to non-localhost URLs inside the app frame
  win.webContents.on('will-navigate', (event, navigationUrl) => {
    try {
      const parsed = new URL(navigationUrl)
      const isLocal = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'
      if (!isLocal) {
        event.preventDefault()
        void shell.openExternal(navigationUrl)
      }
    } catch {
      event.preventDefault()
    }
  })

  win.on('closed', () => {
    onClosed()
  })

  // Show a local loading page immediately so the window is never blank while
  // the backend server starts; navigateApplicationWindow replaces it once the
  // server URL exists.
  const loadingPath = loadingPagePath()
  if (loadingPath !== undefined) {
    void win.loadFile(loadingPath).catch((err: unknown) => {
      logger.warn('Loading page failed to open; the window stays blank until the backend is ready:', err)
    })
  }

  return win
}

/**
 * Bind the window to a backend URL and navigate to it. Safe to call again on
 * restart — the resilience handlers read the current target at event time.
 * @param win - the window to navigate.
 * @param targetUrl - backend URL reported by the server manager.
 * @param logger - app logger.
 */
export function navigateApplicationWindow(win: BrowserWindow, targetUrl: string, logger: AppLogger): void {
  navigationTargets.set(win, targetUrl)
  void win.loadURL(targetUrl).catch((err: unknown) => {
    logger.error('Failed to load backend URL:', err)
  })
}
