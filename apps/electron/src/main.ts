import { BrowserWindow, dialog, ipcMain, type Tray, app } from 'electron'
import { WindowStateManager } from './window-state.js'
import { AppLogger } from './logger.js'
import { createApplicationTray } from './tray.js'
import { ServerProcessManager } from './server-process.js'
import { buildApplicationMenu } from './menu.js'
import { createApplicationWindow } from './window.js'

// ── Single Instance Lock ──────────────────────────────────────────────────────

const isSingleInstance = app.requestSingleInstanceLock()

if (!isSingleInstance) {
  app.quit()
  process.exit(0)
}

// ── Performance & GPU Acceleration Flags ──────────────────────────────────────
// GPU rasterization and out-of-process canvas keep streaming UI updates off
// the main thread; disabling background timer throttling pairs with
// backgroundThrottling:false in window.ts so the agent stream keeps rendering
// when the window loses focus. Dropped as no-ops on current Chromium:
// 'enable-zero-copy' (raster is zero-copy by default) and the SmoothScrolling
// feature flag (smooth scrolling is the shipped default).
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization')

// ── Core Service Instances ────────────────────────────────────────────────────

const logger = new AppLogger()
const windowStateManager = new WindowStateManager()

let mainWindow: BrowserWindow | null = null
let _appTray: Tray | null = null
let isShuttingDown = false

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

  logger.log('Starting backend server...')
  const url = await serverManager.start()

  mainWindow = createApplicationWindow(url, windowStateManager, () => {
    mainWindow = null
  })
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
      mainWindow = createApplicationWindow(url, windowStateManager, () => {
        mainWindow = null
      })
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
          mainWindow = createApplicationWindow(url, windowStateManager, () => {
            mainWindow = null
          })
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
process.on('SIGINT', () => {
  cleanShutdown()
  process.exit(0)
})
process.on('SIGTERM', () => {
  cleanShutdown()
  process.exit(0)
})
