import { spawn, type ChildProcess } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { findNodeExecutable, getEnhancedPath, resolveRepoRoot } from './env-paths.js'
import { type AppLogger } from './logger.js'
import { SERVER_MAX_OLD_SPACE_MB, SERVER_START_TIMEOUT_MS, STOP_GRACE_MS } from './tunables.js'

/**
 * Live manager instances, held weakly so registration never keeps an unused
 * manager alive. One process-level hook stops every live instance at exit.
 */
const liveInstances = new Set<WeakRef<ServerProcessManager>>()
let exitHooksRegistered = false

function stopAllLiveInstances(): void {
  for (const ref of liveInstances) {
    const instance = ref.deref()
    if (instance !== undefined) instance.stop()
  }
  liveInstances.clear()
}

function registerExitHooks(): void {
  if (exitHooksRegistered) return
  exitHooksRegistered = true
  process.once('exit', stopAllLiveInstances)
  // On signals, stop the child then re-emit so the default termination still
  // happens; a plain listener would otherwise swallow the default exit. The
  // once-wrapper has already removed itself when the callback runs, so an
  // empty listener list means this hook is the only one that was registered.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      stopAllLiveInstances()
      if (process.listenerCount(signal) === 0) {
        process.kill(process.pid, signal)
      }
    })
  }
}

export class ServerProcessManager {
  private process: ChildProcess | null = null
  private serverUrl: string | null = null
  private readonly logger: AppLogger
  private readonly resourcesPath: string
  private readonly onUnexpectedExit?: () => void

  constructor(logger: AppLogger, resourcesPath: string, onUnexpectedExit?: () => void) {
    this.logger = logger
    this.resourcesPath = resourcesPath
    this.onUnexpectedExit = onUnexpectedExit
    registerExitHooks()
    liveInstances.add(new WeakRef(this))
  }

  public getUrl(): string | null {
    return this.serverUrl
  }

  public isRunning(): boolean {
    return this.process !== null && !this.process.killed
  }

  public start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.stop()

      const repoRoot = resolveRepoRoot(this.resourcesPath)
      const cliBin = path.join(repoRoot, 'apps', 'cli', 'lib', 'bin.js')
      const nodeBin = findNodeExecutable()
      const enhancedPath = getEnhancedPath()

      this.logger.log(`Starting DSH backend process (Node: ${nodeBin}, Entry: ${cliBin})`)

      if (!fs.existsSync(cliBin)) {
        const err = new Error(`CLI entry file not found at: ${cliBin}`)
        this.logger.error(err.message)
        reject(err)
        return
      }

      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: enhancedPath,
        DSH_ELECTRON: '1',
        NODE_ENV: 'production',
      }

      this.process = spawn(
        nodeBin,
        [`--max-old-space-size=${String(SERVER_MAX_OLD_SPACE_MB)}`, cliBin, 'web', '--port', '0'],
        {
          cwd: repoRoot,
          stdio: ['ignore', 'pipe', 'pipe'],
          // The backend is a trusted local child; the full parent environment
          // (credentials included) flows through deliberately.
          env,
          detached: process.platform !== 'win32',
        },
      )
      const child = this.process

      let resolved = false
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true
          const err = new Error(`Server backend startup timed out after ${String(SERVER_START_TIMEOUT_MS / 1_000)}s`)
          this.logger.error(err.message)
          reject(err)
        }
      }, SERVER_START_TIMEOUT_MS)

      this.process.stdout?.on('data', (data: Buffer) => {
        const text = data.toString()
        this.logger.log(`[dsh stdout] ${text.trimEnd()}`)

        const match = text.match(/http:\/\/(127\.0\.0\.1|localhost):(\d+)/)
        if (match && !resolved) {
          resolved = true
          clearTimeout(timeout)
          this.serverUrl = match[0]
          this.logger.log(`DeepSeek Harness server ready at: ${this.serverUrl}`)
          resolve(this.serverUrl)
        }
      })

      this.process.stderr?.on('data', (data: Buffer) => {
        this.logger.warn(`[dsh stderr] ${data.toString().trimEnd()}`)
      })

      this.process.on('error', (err: Error) => {
        this.logger.error('DSH process error:', err)
        if (!resolved) {
          resolved = true
          clearTimeout(timeout)
          reject(err)
        }
      })

      child.on('exit', (code: number | null, signal: string | null) => {
        this.logger.log(`DSH process exited (code: ${code}, signal: ${signal})`)
        // A restart's stop() may already have replaced this child; only the
        // live child clears the handle, and only its death is unexpected.
        if (this.process === child) {
          this.process = null
          if (!resolved) {
            resolved = true
            clearTimeout(timeout)
            reject(new Error(`DSH process exited during startup (code: ${code})`))
          } else if (this.onUnexpectedExit) {
            this.onUnexpectedExit()
          }
        }
      })
    })
  }

  public stop(): void {
    const child = this.process
    if (child && child.pid) {
      const pid = child.pid
      try {
        if (process.platform !== 'win32') {
          process.kill(-pid, 'SIGTERM')
        } else {
          child.kill('SIGTERM')
        }
      } catch {
        // The process group is already gone; try the direct kill as a fallback.
        try {
          child.kill('SIGKILL')
        } catch { /* it exited between the two attempts */ }
      }
      // A child that ignores SIGTERM must not survive as a detached orphan:
      // escalate to SIGKILL once the grace window closes.
      const escalation = setTimeout(() => {
        try {
          if (process.platform !== 'win32') {
            process.kill(-pid, 'SIGKILL')
          } else {
            child.kill('SIGKILL')
          }
        } catch { /* the group exited inside the grace window */ }
      }, STOP_GRACE_MS)
      escalation.unref()
      child.once('exit', () => { clearTimeout(escalation) })
      this.process = null
    }
    // A stopped manager owns no child process anymore; drop it from the
    // exit-hook registry so shutdown never iterates stopped instances.
    for (const ref of liveInstances) {
      if (ref.deref() === this) liveInstances.delete(ref)
    }
  }
}
