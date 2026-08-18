import * as fs from 'node:fs'
import * as path from 'node:path'
import { BrowserWindow, Menu, Tray, nativeImage, shell } from 'electron'

export function createApplicationTray(
  getMainWindow: () => BrowserWindow | null,
  getServerUrl: () => string | null,
  onRestartServer: () => Promise<void>,
  onOpenLogs: () => void,
): Tray | null {
  try {
    const iconPath = path.join(__dirname, '..', 'build-resources', 'trayTemplate.png')
    if (!fs.existsSync(iconPath)) return null

    const icon = nativeImage.createFromPath(iconPath)
    icon.setTemplateImage(true)

    const tray = new Tray(icon)
    tray.setToolTip('DeepSeek Harness')

    const updateContextMenu = () => {
      const serverUrl = getServerUrl()
      const contextMenu = Menu.buildFromTemplate([
        {
          label: 'DeepSeek Harness',
          enabled: false,
        },
        {
          label: serverUrl ? `Status: Running (${serverUrl})` : 'Status: Starting...',
          enabled: false,
        },
        { type: 'separator' },
        {
          label: 'Open Application Window',
          click: () => {
            const win = getMainWindow()
            if (win) {
              if (win.isMinimized()) win.restore()
              win.show()
              win.focus()
            }
          },
        },
        {
          label: 'Open in Web Browser',
          enabled: Boolean(serverUrl),
          click: () => {
            if (serverUrl) {
              void shell.openExternal(serverUrl)
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Restart Server Backend',
          click: () => {
            void onRestartServer()
          },
        },
        {
          label: 'View Application Logs...',
          click: () => {
            onOpenLogs()
          },
        },
        { type: 'separator' },
        {
          label: 'Quit DeepSeek Harness',
          role: 'quit',
        },
      ])
      tray.setContextMenu(contextMenu)
    }

    updateContextMenu()

    tray.on('click', () => {
      const win = getMainWindow()
      if (win) {
        if (win.isVisible()) {
          win.focus()
        } else {
          win.show()
        }
      }
    })

    return tray
  } catch (err) {
    console.warn('[tray] Failed to initialize system tray:', err)
    return null
  }
}
