import { spawn, type ChildProcess } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { findNodeExecutable, getEnhancedPath, resolveRepoRoot } from './env-paths.js'
import { type AppLogger } from './logger.js'

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

      this.process = spawn(nodeBin, [cliBin, 'web', '--port', '0'], {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
        detached: process.platform !== 'win32',
      })

      let resolved = false
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true
          const err = new Error('Server backend startup timed out after 15s')
          this.logger.error(err.message)
          reject(err)
        }
      }, 15000)

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

      this.process.on('exit', (code: number | null, signal: string | null) => {
        this.logger.log(`DSH process exited (code: ${code}, signal: ${signal})`)
        this.process = null
        if (!resolved) {
          resolved = true
          clearTimeout(timeout)
          reject(new Error(`DSH process exited during startup (code: ${code})`))
        } else if (this.onUnexpectedExit) {
          this.onUnexpectedExit()
        }
      })
    })
  }

  public stop(): void {
    if (this.process && this.process.pid) {
      try {
        if (process.platform !== 'win32') {
          process.kill(-this.process.pid, 'SIGTERM')
        } else {
          this.process.kill('SIGTERM')
        }
      } catch {
        try {
          this.process.kill('SIGKILL')
        } catch {}
      }
      this.process = null
    }
  }
}
