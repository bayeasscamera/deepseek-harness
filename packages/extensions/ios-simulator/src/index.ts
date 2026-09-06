/**
 * iOS Simulator integration for DeepSeek Harness on macOS. The `/ios` command
 * and the `ios_list_devices`/`ios_simulator_screenshot` tools drive `xcrun
 * simctl` to list, boot, shut down, and screenshot simulators. The process
 * runner and host platform are injected, so the plugin composes identically
 * in production and under test.
 *
 * @module @deepseek-ai/dsh-ios-simulator
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

/** Plugin name. */
export const name = 'ios-simulator'
/** Required Cordis services. */
export const inject = ['commands', 'tools']

/** Identifies one simulator device in simctl's own vocabulary. */
export type Udid = Branded<'Udid'>

/**
 * Brand a string as a {@link Udid}.
 * @param id - the raw simulator UDID string.
 * @returns the same string, branded (a compile-time cast — no runtime cost).
 */
export function Udid(id: string): Udid {
  return id as Udid
}

/** Default directory where `/ios screenshot` saves captures. */
export const DEFAULT_SCREENSHOT_DIR = '.dsh/screenshots'

/** Default simctl kill deadline in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 3000

/** Plugin config. */
export interface Config {
  /** Directory for `/ios screenshot` captures, resolved against the process cwd. Default: `.dsh/screenshots`. */
  screenshotDir?: string
  /** Positive milliseconds before a simctl invocation is killed. Default: 3000. */
  timeoutMs?: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  screenshotDir: z.string().default(DEFAULT_SCREENSHOT_DIR),
  timeoutMs: z.number().min(1).default(3000),
})

/**
 * Synchronous process runner seam — `execFileSync` in production. A runner
 * returns the child's decoded stdout and throws on spawn failure or non-zero
 * exit.
 * @param file - executable to run.
 * @param args - argument vector (no shell interpolation).
 * @param options - kill deadline for the child.
 * @returns the child's decoded stdout.
 */
export type ProcessRunner = (file: string, args: readonly string[], options: { readonly timeoutMs: number }) => string

/* v8 ignore start -- thin child_process binding; the injected runner is unit-tested and real platform composition exercises it. */
const execFileSyncRunner: ProcessRunner = (file, args, options) =>
  execFileSync(file, args, { encoding: 'utf8', timeout: options.timeoutMs })
/* v8 ignore stop */

/** Execution environment for one simctl-capable plugin instance. */
export interface SimctlEnvironment {
  /** Synchronous process runner. */
  readonly runner: ProcessRunner
  /** Host platform: simctl exists only on macOS. */
  readonly platform: NodeJS.Platform
  /** Positive milliseconds before a simctl invocation is killed. */
  readonly timeoutMs: number
}

/** Description of an iOS simulator device on the host. */
export interface IosDevice {
  /** Opaque simctl device identifier. */
  udid: Udid
  /** Human-readable simulator name. */
  name: string
  /** Current boot state. */
  state: 'Booted' | 'Shutdown' | 'Unknown'
  /** Whether the device is available on the current SDK. */
  isAvailable: boolean
  /** Short runtime label derived from the simctl runtime key (e.g. `iOS-17-0`). */
  runtime: string
}

/** Success/failure outcome of one simulator control operation. */
export interface SimctlOutcome {
  /** Whether the operation achieved its goal. */
  success: boolean
  /** Human-readable result message. */
  message: string
}

/** Success/failure outcome of one screenshot capture. */
export type ScreenshotOutcome =
  | { readonly success: true; readonly udid: Udid; readonly filePath: string }
  | { readonly success: false; readonly udid: Udid; readonly error: string }

/**
 * Check whether a host platform supports Xcode/simctl.
 * @param platform - host platform to test.
 * @returns true on macOS.
 */
export function isMacOs(platform: NodeJS.Platform): boolean {
  return platform === 'darwin'
}

/** Decode one thrown runner failure into its message. */
function renderRunnerError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Whether one thrown runner failure reports a missing executable. */
function isMissingExecutable(error: unknown): boolean {
  // Runner failures carry child_process's spawn errno on `code`.
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

/**
 * List all available iOS simulators via `xcrun simctl`.
 * @param env - simctl execution environment.
 * @returns the available iOS devices; empty when the host is not macOS or has no xcrun installed.
 * @throws when xcrun exists but fails to run, times out, or emits unparseable output.
 */
export function listSimulators(env: SimctlEnvironment): IosDevice[] {
  if (!isMacOs(env.platform)) return []
  let rawJson: string
  try {
    rawJson = env.runner('xcrun', ['simctl', 'list', 'devices', 'available', '--json'], { timeoutMs: env.timeoutMs })
  } catch (error: unknown) {
    // A missing xcrun binary means this host has no simulator tooling, so an
    // empty list is the honest answer. Every other runner failure (broken
    // tooling, timeout) surfaces below with its underlying error.
    if (isMissingExecutable(error)) return []
    throw error
  }
  return parseSimulatorList(rawJson)
}

/**
 * Parse one `simctl list devices available --json` payload.
 * @param rawJson - the decoded simctl stdout.
 * @returns the available iOS devices, one entry per available device of an iOS runtime.
 */
export function parseSimulatorList(rawJson: string): IosDevice[] {
  type RawOutput = {
    devices?: Record<string, Array<{ udid: string; name: string; state: string; isAvailable: boolean }>>
  }
  const data = JSON.parse(rawJson) as RawOutput
  const result: IosDevice[] = []
  for (const [runtime, list] of Object.entries(data.devices ?? {})) {
    if (!runtime.toLowerCase().includes('ios')) continue
    for (const dev of list) {
      if (!dev.isAvailable) continue
      result.push({
        udid: Udid(dev.udid),
        name: dev.name,
        state: dev.state === 'Booted' || dev.state === 'Shutdown' ? dev.state : 'Unknown',
        isAvailable: dev.isAvailable,
        runtime: runtime.slice(runtime.lastIndexOf('.') + 1),
      })
    }
  }
  return result
}

/** Whether one boot failure reports the device as already booted. */
function isAlreadyBooted(error: unknown): boolean {
  const message = renderRunnerError(error)
  return message.includes('current state: Booted') || message.includes('already booted')
}

/**
 * Open the macOS Simulator app without blocking on its GUI lifetime.
 * @param env - simctl execution environment.
 */
function openSimulatorApp(env: SimctlEnvironment): void {
  env.runner('open', ['-a', 'Simulator'], { timeoutMs: env.timeoutMs })
}

/**
 * Boot a simulator by UDID or name and open the Simulator app.
 * @param env - simctl execution environment.
 * @param target - UDID or name of the target simulator.
 * @returns outcome; an already-booted device still succeeds and still opens the app.
 */
export function bootSimulator(env: SimctlEnvironment, target: string): SimctlOutcome {
  if (!isMacOs(env.platform)) {
    return { success: false, message: 'The iOS simulator is only available on macOS.' }
  }
  let alreadyBooted = false
  try {
    env.runner('xcrun', ['simctl', 'boot', target], { timeoutMs: env.timeoutMs })
  } catch (error: unknown) {
    if (!isAlreadyBooted(error)) {
      return { success: false, message: `Boot failed: ${renderRunnerError(error)}` }
    }
    alreadyBooted = true
  }
  try {
    openSimulatorApp(env)
  } catch {
    // Opening the GUI is best-effort: the device is booted either way, and a
    // headless host must not turn a successful boot into a boot error.
  }
  return alreadyBooted
    ? { success: true, message: `Simulator "${target}" is already booted.` }
    : { success: true, message: `Simulator "${target}" booted.` }
}

/**
 * Shut down a booted simulator.
 * @param env - simctl execution environment.
 * @param target - UDID or name of the target simulator.
 * @returns outcome with a human-readable result message.
 */
export function shutdownSimulator(env: SimctlEnvironment, target: string): SimctlOutcome {
  if (!isMacOs(env.platform)) {
    return { success: false, message: 'The iOS simulator is only available on macOS.' }
  }
  try {
    env.runner('xcrun', ['simctl', 'shutdown', target], { timeoutMs: env.timeoutMs })
  } catch (error: unknown) {
    return { success: false, message: `Shutdown failed: ${renderRunnerError(error)}` }
  }
  return { success: true, message: `Simulator "${target}" shut down.` }
}

/**
 * Capture a PNG screenshot from one simulator.
 * @param env - simctl execution environment.
 * @param udid - simulator UDID (or simctl's `booted` alias) to capture.
 * @param outputPath - absolute or cwd-relative path of the PNG to write; missing parent directories are created.
 * @returns the written file path on success, or the underlying failure.
 */
export function captureSimulatorScreenshot(env: SimctlEnvironment, udid: Udid, outputPath: string): ScreenshotOutcome {
  if (!isMacOs(env.platform)) {
    return { success: false, udid, error: 'The iOS simulator screenshot requires macOS.' }
  }
  const filePath = resolve(outputPath)
  mkdirSync(dirname(filePath), { recursive: true })
  try {
    env.runner('xcrun', ['simctl', 'io', udid, 'screenshot', filePath], { timeoutMs: env.timeoutMs })
  } catch (error: unknown) {
    return { success: false, udid, error: renderRunnerError(error) }
  }
  if (!existsSync(filePath)) {
    return { success: false, udid, error: `simctl reported success but no image was written to ${filePath}.` }
  }
  return { success: true, udid, filePath }
}

/**
 * Build the plugin body over an explicit process runner and host platform.
 * Production passes the `execFileSync` runner and `process.platform`; tests
 * inject a fake runner and platform to cover every branch without real
 * simulators.
 * @param runner - synchronous process runner.
 * @param platform - host platform the plugin runs under.
 * @returns the plugin body: registers the `/ios` command and both tools.
 */
export function createIosSimulatorPlugin(
  runner: ProcessRunner,
  platform: NodeJS.Platform,
): (ctx: Context, config: Config) => void {
  return (ctx, config) => {
    // Explicit resolve step: the factory takes the raw Config shape (tests
    // compose it without schemastery), so the schema defaults are restated
    // here; the validated Config path supplies the same values.
    const screenshotDir = resolve(config.screenshotDir ?? DEFAULT_SCREENSHOT_DIR)
    const env: SimctlEnvironment = { runner, platform, timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS }

    ctx.effect(() => ctx.commands.register({
      name: 'ios',
      description: 'Drive the built-in iOS simulators (list, boot, shutdown, open, screenshot).',
      input: {
        hint: '[list | boot <name/udid> | shutdown <name/udid> | open | screenshot]',
      },
      handler: (invocation: CommandInvocation): CommandResult => {
        if (!isMacOs(platform)) {
          return { kind: 'error', text: 'The `/ios` command requires macOS with Xcode installed.' }
        }

        const parts = invocation.rawInput.trim().split(/\s+/).filter(token => token.length > 0)
        const [action, ...rest] = parts
        const target = rest.join(' ')

        if (!action || action === 'list') {
          const devices = listSimulators(env)
          if (devices.length === 0) {
            return { kind: 'success', text: 'No available iOS simulators found. Verify that Xcode and the iOS runtimes are installed.' }
          }
          const formatted = devices
            .map(d => `- **${d.name}** (\`${d.udid}\`) — *${d.state}* (${d.runtime})`)
            .join('\n')
          return {
            kind: 'success',
            text: `### Available iOS simulators:\n\n${formatted}\n\n*To boot:* \`/ios boot <name>\` | *Screenshot:* \`/ios screenshot\``,
          }
        }

        if (action === 'boot' || action === 'shutdown') {
          if (!target) {
            return { kind: 'error', text: `Usage: \`/ios ${action} <simulator name or UDID>\`` }
          }
          const outcome = action === 'boot' ? bootSimulator(env, target) : shutdownSimulator(env, target)
          return outcome.success
            ? { kind: 'success', text: outcome.message }
            : { kind: 'error', text: outcome.message }
        }

        if (action === 'open') {
          openSimulatorApp(env)
          return { kind: 'success', text: 'iOS Simulator app opened.' }
        }

        if (action === 'screenshot') {
          const filePath = join(screenshotDir, `ios_sim_${Date.now()}.png`)
          const outcome = captureSimulatorScreenshot(env, Udid('booted'), filePath)
          if (outcome.success) {
            return { kind: 'success', text: `Screenshot saved.\nFile: \`${outcome.filePath}\`` }
          }
          return { kind: 'error', text: `Screenshot failed (make sure a simulator is booted): ${outcome.error}` }
        }

        return {
          kind: 'success',
          text: 'Usage: `/ios list` | `/ios boot <name>` | `/ios shutdown <name>` | `/ios open` | `/ios screenshot`',
        }
      },
    }), 'ios-simulator: command')

    ctx.effect(() => ctx.tools.register(defineTool({
      name: 'ios_list_devices',
      description: 'List all iOS simulators configured and available on this macOS machine.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            devices: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  name: { type: 'string', required: true },
                  udid: { type: 'string', required: true },
                  state: { type: 'string', required: true },
                },
              },
            },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: `Found ${value.devices.length} iOS simulator devices:\n${value.devices.map(d => `- ${d.name} (${d.state}) [${d.udid}]`).join('\n')}`,
        }],
      },
      execute: () => {
        const devices = listSimulators(env).map(d => ({
          name: d.name,
          udid: d.udid,
          state: d.state,
        }))
        return Promise.resolve({ devices })
      },
    })), 'ios-simulator: list tool')

    ctx.effect(() => ctx.tools.register(defineTool({
      name: 'ios_simulator_screenshot',
      description: 'Capture a PNG screenshot from an iOS simulator and save it to a file path.',
      parameters: {
        udid: { type: 'string', required: true, description: 'Simulator UDID (or the `booted` alias) to capture.' },
        outputPath: { type: 'string', required: true, description: 'File path where the PNG screenshot is written.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            success: { type: 'boolean', required: true },
            filePath: { type: 'string', required: true },
            udid: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: `Screenshot saved for ${value.udid}: ${value.filePath}`,
        }],
      },
      execute: (args: { udid: string; outputPath: string }) => {
        const outcome = captureSimulatorScreenshot(env, Udid(args.udid), args.outputPath)
        if (!outcome.success) {
          return Promise.reject(new Error(outcome.error))
        }
        return Promise.resolve({ success: true, filePath: outcome.filePath, udid: args.udid })
      },
    })), 'ios-simulator: screenshot tool')
  }
}

/**
 * Mount the iOS simulator command and tool extensions.
 * @param ctx - Cordis context carrying commands and tools services.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  createIosSimulatorPlugin(execFileSyncRunner, process.platform)(ctx, config)
}
