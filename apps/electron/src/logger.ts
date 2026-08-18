import * as fs from 'node:fs'
import * as path from 'node:path'
import { app, shell } from 'electron'

export class AppLogger {
  private readonly logFilePath: string

  constructor() {
    const logsDir = app.getPath('logs')
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true })
    }
    this.logFilePath = path.join(logsDir, 'deepseek-harness.log')
    this.log(`--- Session started: ${new Date().toISOString()} (v${app.getVersion()}) ---`)
  }

  public log(...args: readonly unknown[]): void {
    const line = `[${new Date().toISOString()}] [INFO] ${args.map(a => (typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a))).join(' ')}\n`
    console.log(...args)
    this.append(line)
  }

  public warn(...args: readonly unknown[]): void {
    const line = `[${new Date().toISOString()}] [WARN] ${args.map(a => (typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a))).join(' ')}\n`
    console.warn(...args)
    this.append(line)
  }

  public error(...args: readonly unknown[]): void {
    const line = `[${new Date().toISOString()}] [ERROR] ${args.map(a => (typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a))).join(' ')}\n`
    console.error(...args)
    this.append(line)
  }

  private append(data: string): void {
    try {
      fs.appendFileSync(this.logFilePath, data, 'utf8')
    } catch {
      // Swallowed: best-effort file logging
    }
  }

  public getLogPath(): string {
    return this.logFilePath
  }

  public showInFolder(): void {
    shell.showItemInFolder(this.logFilePath)
  }
}
