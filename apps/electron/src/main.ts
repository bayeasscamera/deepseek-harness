import { BrowserWindow, dialog, ipcMain, type Tray, app } from 'electron'
import { WindowStateManager } from './window-state.js'
import { AppLogger } from './logger.js'
import { createApplicationTray } from './tray.js'
import { ServerProcessManager } from './server-process.js'
import { buildApplicationMenu } from './menu.js'
import { createApplicationWindow, navigateApplicationWindow } from './window.js'

// ── Single Instance Lock ──────────────────────────────────────────────────────

const isSingleInstance = app.requestSingleInstanceLock()

if (!isSingleInstance) {
  app.quit()
  process.exit(0)
}

// ── Performance & Stability Flags ─────────────────────────────────────────────
// Disabling background timer throttling pairs with backgroundThrottling:false
// in window.ts so the agent stream keeps rendering when the window loses focus.
// `enable-zero-copy` and `ignore-gpu-blocklist` are deliberately absent: they
// are no-ops or GPU-crash risks on blocklisted drivers on current Chromium.
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('enable-gpu-rasterization')

// ── Core Service Instances ────────────────────────────────────────────────────

const logger = new AppLogger()
const windowStateManager = new WindowStateManager()

let mainWindow: BrowserWindow | null = null
let _appTray: Tray | null = null
let isShuttingDown = false

// Monitor child processes (GPU, Utility, Network, etc.)
app.on('child-process-gone', (_event, details) => {
  if (details.type === 'GPU') {
    logger.error(`GPU process gone: reason=${details.reason}, exitCode=${details.exitCode}. Chromium will fallback to software compositing.`)
  } else {
    logger.warn(`Child process gone: type=${details.type}, reason=${details.reason}, exitCode=${details.exitCode}`)
  }
})

const serverManager = new ServerProcessManager(
  logger,
  process.resourcesPath,
  () => {
    if (!isShuttingDown) {
      void handleUnexpectedCrash()
    }
  },
)

// ── Recovery Handler ──────────────────────────────────────────────────────────

async function handleUnexpectedCrash(): Promise<void> {
  logger.warn('Backend server process stopped unexpectedly.')
  const choice = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Restart Server', 'View Application Logs', 'Quit'],
    defaultId: 0,
    title: 'DeepSeek Harness Backend Stopped',
    message: 'The local DeepSeek Harness server has stopped unexpectedly.',
    detail: 'Would you like to restart the backend server or inspect the logs?',
  })

  if (choice.response === 0) {
    try {
      const url = await serverManager.start()
      if (mainWindow) {
        await mainWindow.loadURL(url)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      dialog.showErrorBox('Restart Failed', message)
    }
  } else if (choice.response === 1) {
    logger.showInFolder()
  } else {
    app.quit()
  }
}

// ── Application Initialization ────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  buildApplicationMenu({
    getMainWindow: () => mainWindow,
    getServerUrl: () => serverManager.getUrl(),
    onRestartServer: async () => {
      const url = await serverManager.start()
      if (mainWindow) await mainWindow.loadURL(url)
    },
    logger,
  })

  _appTray = createApplicationTray(
    () => mainWindow,
    () => serverManager.getUrl(),
    async () => {
      const url = await serverManager.start()
      if (mainWindow) await mainWindow.loadURL(url)
    },
    () => {
      logger.showInFolder()
    },
  )

  // The window (with its loading page) exists before the backend starts, so
  // the app is never a blank desktop while `dsh web` boots.
  mainWindow = createApplicationWindow(windowStateManager, logger, () => {
    mainWindow = null
  })

  logger.log('Starting backend server...')
  const url = await serverManager.start()
  navigateApplicationWindow(mainWindow, url, logger)
}

// ── IPC Handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('app:version', () => app.getVersion())
ipcMain.handle('app:serverUrl', () => serverManager.getUrl())
ipcMain.handle('app:openLogs', () => {
  logger.showInFolder()
})

// ── Lifecycle Events ──────────────────────────────────────────────────────────

app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  } else {
    const url = serverManager.getUrl()
    if (url) {
      mainWindow = createApplicationWindow(windowStateManager, logger, () => {
        mainWindow = null
      })
      navigateApplicationWindow(mainWindow, url, logger)
    }
  }
})

void app.whenReady().then(async () => {
  try {
    if (process.platform === 'darwin' && app.dock) {
      await app.dock.show()
    }

    await bootstrap()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0 || !mainWindow || mainWindow.isDestroyed()) {
        const url = serverManager.getUrl()
        if (url) {
          mainWindow = createApplicationWindow(windowStateManager, logger, () => {
            mainWindow = null
          })
          navigateApplicationWindow(mainWindow, url, logger)
        }
      } else {
        mainWindow.show()
        mainWindow.focus()
      }
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('Startup failed:', message)
    dialog.showErrorBox(
      'DeepSeek Harness Error',
      `Failed to initialize DeepSeek Harness:\n\n${message}`,
    )
    app.quit()
  }
})

function cleanShutdown(): void {
  isShuttingDown = true
  serverManager.stop()
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', cleanShutdown)
app.on('will-quit', cleanShutdown)
process.on('uncaughtException', (err: Error) => {
  logger.error('Uncaught Exception in Main Process:', err)
  // Transient I/O noise from pipes and sockets is logged and survived; every
  // other uncaught exception means undefined state — surface it loudly and
  // shut down rather than continue in a corrupt process.
  if ((err as NodeJS.ErrnoException).code === 'EPIPE' || (err as NodeJS.ErrnoException).code === 'ECONNRESET') {
    return
  }
  dialog.showErrorBox(
    'DeepSeek Harness Error',
    `An unexpected error occurred and the app must close:\n\n${err.message}`,
  )
  isShuttingDown = true
  serverManager.stop()
  process.exit(1)
})

process.on('unhandledRejection', (reason: unknown) => {
  // Same fail-loud contract as uncaughtException: a rejected promise in the
  // main process is a bug, not a log line to move past.
  const message = reason instanceof Error ? reason.message : String(reason)
  logger.error('Unhandled Rejection in Main Process:', reason)
  dialog.showErrorBox('DeepSeek Harness Error', `An unexpected error occurred and the app must close:\n\n${message}`)
  isShuttingDown = true
  serverManager.stop()
  process.exit(1)
})

process.on('SIGINT', () => {
  cleanShutdown()
  process.exit(0)
})
process.on('SIGTERM', () => {
  cleanShutdown()
  process.exit(0)
})
