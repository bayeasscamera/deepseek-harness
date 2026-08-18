/**
 * Preload script — runs in a sandboxed context with access to both the
 * renderer's DOM and a limited set of Node APIs via contextBridge.
 */
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('dshElectron', {
  /** Port the dsh backend is listening on. */
  getPort: (): Promise<number> => ipcRenderer.invoke('dsh:port'),
  /** Electron app version. */
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  /** Platform identifier ('darwin' | 'win32' | 'linux'). */
  platform: process.platform,
})
