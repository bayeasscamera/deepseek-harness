import { BrowserWindow, Menu, app, dialog, shell } from 'electron'
import { type AppLogger } from './logger.js'

export interface MenuCallbacks {
  getMainWindow: () => BrowserWindow | null
  getServerUrl: () => string | null
  onRestartServer: () => Promise<void>
  logger: AppLogger
}

export function buildApplicationMenu(callbacks: MenuCallbacks): void {
  const isMac = process.platform === 'darwin'
  const { getMainWindow, getServerUrl, onRestartServer, logger } = callbacks

  const macAppMenu: Electron.MenuItemConstructorOptions[] = isMac
    ? [
      {
        label: app.name,
        submenu: [
          { role: 'about' as const, label: 'About DeepSeek Harness' },
          { type: 'separator' as const },
          {
            label: 'Preferences...',
            accelerator: 'CmdOrCtrl+,',
            click: () => {
              const win = getMainWindow()
              const url = getServerUrl()
              if (win && url) {
                void win.loadURL(`${url}/#/settings`)
              }
            },
          },
          { type: 'separator' as const },
          { role: 'services' as const },
          { type: 'separator' as const },
          { role: 'hide' as const, label: 'Hide DeepSeek Harness' },
          { role: 'hideOthers' as const },
          { role: 'unhide' as const },
          { type: 'separator' as const },
          { role: 'quit' as const, label: 'Quit DeepSeek Harness' },
        ],
      },
    ]
    : []

  const windowSubmenu: Electron.MenuItemConstructorOptions[] = isMac
    ? [
      { role: 'minimize' as const },
      { role: 'zoom' as const },
      { type: 'separator' as const },
      { role: 'front' as const },
    ]
    : [
      { role: 'minimize' as const },
      { role: 'zoom' as const },
      { role: 'close' as const },
    ]

  const template: Electron.MenuItemConstructorOptions[] = [
    ...macAppMenu,
    {
      label: 'File',
      submenu: [
        {
          label: 'New Session',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            const win = getMainWindow()
            const url = getServerUrl()
            if (win && url) {
              void win.loadURL(url)
            }
          },
        },
        {
          label: 'Open in Web Browser',
          accelerator: 'CmdOrCtrl+Shift+B',
          click: () => {
            const url = getServerUrl()
            if (url) {
              void shell.openExternal(url)
            }
          },
        },
        { type: 'separator' as const },
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const, accelerator: 'CmdOrCtrl+R' },
        { role: 'forceReload' as const, accelerator: 'CmdOrCtrl+Shift+R' },
        { role: 'toggleDevTools' as const, accelerator: 'Alt+Cmd+I' },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const, accelerator: 'CmdOrCtrl+=' },
        { role: 'zoomOut' as const, accelerator: 'CmdOrCtrl+-' },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
      ],
    },
    {
      label: 'Developer',
      submenu: [
        {
          label: 'Restart Backend Server',
          accelerator: 'CmdOrCtrl+Shift+K',
          click: () => {
            void onRestartServer().catch((err: unknown) => {
              const message = err instanceof Error ? err.message : String(err)
              dialog.showErrorBox('Restart Failed', message)
            })
          },
        },
        {
          label: 'Reveal Application Log File',
          click: () => {
            logger.showInFolder()
          },
        },
      ],
    },
    {
      label: 'Window',
      submenu: windowSubmenu,
    },
    {
      role: 'help' as const,
      submenu: [
        {
          label: 'DeepSeek Harness Documentation',
          click: () => {
            void shell.openExternal('https://github.com/deepseek-ai/deepseek-harness')
          },
        },
        {
          label: 'DeepSeek AI Official Website',
          click: () => {
            void shell.openExternal('https://deepseek.com')
          },
        },
        {
          label: 'Discord Community',
          click: () => {
            void shell.openExternal('https://discord.gg/Ycq5dCaS4')
          },
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
