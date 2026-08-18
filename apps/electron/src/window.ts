import * as path from 'node:path'
import { BrowserWindow, nativeTheme, shell } from 'electron'
import { type WindowStateManager } from './window-state.js'

export function createApplicationWindow(
  targetUrl: string,
  windowStateManager: WindowStateManager,
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
      spellcheck: true,
    },
  })

  windowStateManager.track(win)

  if (savedState.isMaximized) {
    win.maximize()
  }

  win.once('ready-to-show', () => {
    win.show()
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

  void win.loadURL(targetUrl)

  return win
}
