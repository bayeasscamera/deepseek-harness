import * as fs from 'node:fs'
import * as path from 'node:path'
import { app, BrowserWindow, screen } from 'electron'

export interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized?: boolean
  isFullScreen?: boolean
}

const DEFAULT_STATE: WindowState = {
  width: 1360,
  height: 860,
}

export class WindowStateManager {
  private readonly stateFilePath: string
  private state: WindowState

  constructor() {
    this.stateFilePath = path.join(app.getPath('userData'), 'window-state.json')
    this.state = this.loadState()
  }

  public getState(): WindowState {
    return { ...this.state }
  }

  private loadState(): WindowState {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const data = fs.readFileSync(this.stateFilePath, 'utf8')
        const loaded = JSON.parse(data) as Partial<WindowState>
        // Ensure the restored window coordinates are on a visible screen
        const x = loaded.x
        const y = loaded.y
        if (x !== undefined && y !== undefined && app.isReady()) {
          try {
            const visible = screen.getAllDisplays().some((display) => {
              const bounds = display.bounds
              return (
                x >= bounds.x &&
                x < bounds.x + bounds.width &&
                y >= bounds.y &&
                y < bounds.y + bounds.height
              )
            })
            if (!visible) {
              delete loaded.x
              delete loaded.y
            }
          } catch {
            // Screen-bounds probing is best-effort: a failure keeps the saved
            // position unchanged instead of discarding it.
          }
        }
        return { ...DEFAULT_STATE, ...loaded }
      }
    } catch (e: unknown) {
      console.warn('[window-state] Failed to read window state:', e)
    }
    return { ...DEFAULT_STATE }
  }

  public track(win: BrowserWindow): void {
    const saveState = () => {
      try {
        if (!win.isDestroyed()) {
          const isMaximized = win.isMaximized()
          const isFullScreen = win.isFullScreen()
          if (!isMaximized && !isFullScreen) {
            const bounds = win.getBounds()
            this.state = {
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              height: bounds.height,
              isMaximized: false,
              isFullScreen: false,
            }
          } else {
            this.state.isMaximized = isMaximized
            this.state.isFullScreen = isFullScreen
          }
          fs.writeFileSync(this.stateFilePath, JSON.stringify(this.state, null, 2), 'utf8')
        }
      } catch (e) {
        console.warn('[window-state] Failed to save window state:', e)
      }
    }

    win.on('resize', saveState)
    win.on('move', saveState)
    win.on('close', saveState)
  }
}
