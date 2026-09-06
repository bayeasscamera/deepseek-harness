import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition, CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import * as iosSimulator from '../src/index.ts'

/** Minimal captured shape of a registered tool definition. */
interface CapturedTool {
  name: string
  description: string
  output: { render: (args: unknown, value: never) => unknown }
  execute: (args: unknown) => Promise<unknown>
}

/** One recorded runner invocation. */
interface RunnerCall {
  file: string
  args: string[]
  timeoutMs: number
}

interface RunnerStub {
  runner: iosSimulator.ProcessRunner
  readonly calls: RunnerCall[]
}

interface Harness {
  readonly command: CommandDefinition
  readonly tools: Record<string, CapturedTool>
  readonly calls: RunnerCall[]
}

/** The simctl fixture one iOS runtime with every boot state plus noise. */
const LIST_JSON = JSON.stringify({
  devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-17-0': [
      { udid: 'UDID-BOOTED', name: 'iPhone 15', state: 'Booted', isAvailable: true },
      { udid: 'UDID-SHUTDOWN', name: 'iPhone SE', state: 'Shutdown', isAvailable: true },
      { udid: 'UDID-CREATING', name: 'iPad Pro', state: 'Creating', isAvailable: true },
      { udid: 'UDID-UNAVAILABLE', name: 'iPhone 14', state: 'Shutdown', isAvailable: false },
    ],
    'com.apple.CoreSimulator.SimRuntime.watchOS-10-0': [
      { udid: 'UDID-WATCH', name: 'Watch SE', state: 'Shutdown', isAvailable: true },
    ],
  },
})

/**
 * Build a runner stub that records every invocation and answers through
 * `behavior`; screenshot behaviors may write the output file themselves.
 */
function runnerStub(behavior: (file: string, args: readonly string[]) => string): RunnerStub {
  const calls: RunnerCall[] = []
  return {
    calls,
    runner: (file, args, options) => {
      calls.push({ file, args: [...args], timeoutMs: options.timeoutMs })
      return behavior(file, args)
    },
  }
}

/** A runner throwing the given failure on every invocation. */
function failingRunner(failure: unknown): RunnerStub {
  return runnerStub(() => {
    throw failure
  })
}

/** A simctl environment with default macOS test knobs. */
function env(runner: iosSimulator.ProcessRunner, platform: NodeJS.Platform = 'darwin'): iosSimulator.SimctlEnvironment {
  return { runner, platform, timeoutMs: 250 }
}

/** Mount the factory product on captured `commands`/`tools` services. */
function bootFactory(
  runner: iosSimulator.ProcessRunner,
  platform: NodeJS.Platform,
  config: iosSimulator.Config = {},
): Harness {
  const ctx = new Context()
  let command: CommandDefinition | undefined
  const tools: CapturedTool[] = []
  ctx.provide('commands', {
    register(next: CommandDefinition) {
      command = next
      return () => { command = undefined }
    },
  } as never)
  ctx.provide('tools', {
    register(next: CapturedTool) {
      tools.push(next)
      return () => { const at = tools.indexOf(next); if (at >= 0) tools.splice(at, 1) }
    },
  } as never)
  iosSimulator.createIosSimulatorPlugin(runner, platform)(ctx, config)
  if (command === undefined) throw new Error('plugin did not register its command')
  const byName = Object.fromEntries(tools.map(tool => [tool.name, tool]))
  return { command, tools: byName, calls: [] }
}

/** Invoke the captured `/ios` handler the way the executor would. */
function run(harness: Harness, rawInput: string): CommandResult {
  return harness.command.handler({ rawInput } as CommandInvocation) as CommandResult
}

/** One temporary directory per call, removed by the returned disposer. */
function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-ios-simulator-'))
}

describe('platform gate', () => {
  it('accepts darwin only', () => {
    expect(iosSimulator.isMacOs('darwin')).toBe(true)
    expect(iosSimulator.isMacOs('linux')).toBe(false)
  })
})

describe('parseSimulatorList', () => {
  it('keeps available iOS devices with mapped states and runtime labels', () => {
    const devices = iosSimulator.parseSimulatorList(LIST_JSON)
    expect(devices.map(d => d.name)).toEqual(['iPhone 15', 'iPhone SE', 'iPad Pro'])
    expect(devices.map(d => d.state)).toEqual(['Booted', 'Shutdown', 'Unknown'])
    expect(devices.map(d => d.runtime)).toEqual(['iOS-17-0', 'iOS-17-0', 'iOS-17-0'])
    expect(devices.every(d => d.isAvailable)).toBe(true)
    expect(devices[0]!.udid).toBe('UDID-BOOTED')
  })

  it('returns no devices when the payload carries no device table', () => {
    expect(iosSimulator.parseSimulatorList('{}')).toEqual([])
  })
})

describe('listSimulators', () => {
  it('returns an empty list without spawning anything off macOS', () => {
    const stub = runnerStub(() => {
      throw new Error('must not spawn')
    })
    expect(iosSimulator.listSimulators(env(stub.runner, 'linux'))).toEqual([])
    expect(stub.calls).toEqual([])
  })

  it('returns an empty list when xcrun is missing (ENOENT is no simulator tooling)', () => {
    const missing = Object.assign(new Error('spawnSync xcrun ENOENT'), { code: 'ENOENT' })
    const stub = failingRunner(missing)
    expect(iosSimulator.listSimulators(env(stub.runner))).toEqual([])
    expect(stub.calls).toHaveLength(1)
  })

  it('fails loud with the underlying error on any other runner failure', () => {
    const broken = Object.assign(new Error('xcrun: error: unable to find utility "simctl"'), { code: 69 })
    const stub = failingRunner(broken)
    expect(() => iosSimulator.listSimulators(env(stub.runner))).toThrow('unable to find utility')
  })

  it('fails loud on unparseable simctl output', () => {
    const stub = runnerStub(() => 'not json')
    expect(() => iosSimulator.listSimulators(env(stub.runner))).toThrow()
  })

  it('parses the decoded simctl payload on success', () => {
    const stub = runnerStub(() => LIST_JSON)
    const devices = iosSimulator.listSimulators(env(stub.runner))
    expect(devices).toHaveLength(3)
    expect(stub.calls[0]).toEqual({
      file: 'xcrun',
      args: ['simctl', 'list', 'devices', 'available', '--json'],
      timeoutMs: 250,
    })
  })
})

describe('bootSimulator', () => {
  it('fails off macOS without spawning', () => {
    const stub = runnerStub(() => {
      throw new Error('must not spawn')
    })
    const outcome = iosSimulator.bootSimulator(env(stub.runner, 'linux'), 'iPhone 15')
    expect(outcome).toEqual({
      success: false,
      message: 'The iOS simulator is only available on macOS.',
    })
    expect(stub.calls).toEqual([])
  })

  it('boots the target and opens the Simulator app', () => {
    const stub = runnerStub(() => '')
    const outcome = iosSimulator.bootSimulator(env(stub.runner), 'UDID-BOOTED')
    expect(outcome).toEqual({ success: true, message: 'Simulator "UDID-BOOTED" booted.' })
    expect(stub.calls.map(call => [call.file, call.args])).toEqual([
      ['xcrun', ['simctl', 'boot', 'UDID-BOOTED']],
      ['open', ['-a', 'Simulator']],
    ])
  })

  it('treats the current-state Booted failure as already booted and still opens the app', () => {
    const stub = failingRunner(new Error('Unable to boot device in current state: Booted'))
    const outcome = iosSimulator.bootSimulator(env(stub.runner), 'UDID-BOOTED')
    expect(outcome).toEqual({ success: true, message: 'Simulator "UDID-BOOTED" is already booted.' })
    expect(stub.calls.map(call => call.file)).toEqual(['xcrun', 'open'])
  })

  it('recognizes the already-booted phrasing too', () => {
    const stub = failingRunner(new Error('Booting device failed: already booted'))
    const outcome = iosSimulator.bootSimulator(env(stub.runner), 'UDID-1')
    expect(outcome).toEqual({ success: true, message: 'Simulator "UDID-1" is already booted.' })
  })

  it('fails loud with the underlying error message on a real boot failure', () => {
    const stub = failingRunner(new Error('Invalid device UDID'))
    const outcome = iosSimulator.bootSimulator(env(stub.runner), 'nope')
    expect(outcome).toEqual({ success: false, message: 'Boot failed: Invalid device UDID' })
    expect(stub.calls).toHaveLength(1)
  })

  it('renders non-Error throwables as text', () => {
    const stub = failingRunner('spawn timeout')
    const outcome = iosSimulator.bootSimulator(env(stub.runner), 'UDID-1')
    expect(outcome).toEqual({ success: false, message: 'Boot failed: spawn timeout' })
  })
})

describe('shutdownSimulator', () => {
  it('fails off macOS', () => {
    const stub = runnerStub(() => '')
    const outcome = iosSimulator.shutdownSimulator(env(stub.runner, 'linux'), 'UDID-1')
    expect(outcome).toEqual({
      success: false,
      message: 'The iOS simulator is only available on macOS.',
    })
    expect(stub.calls).toEqual([])
  })

  it('shuts the target down via simctl', () => {
    const stub = runnerStub(() => '')
    const outcome = iosSimulator.shutdownSimulator(env(stub.runner), 'UDID-BOOTED')
    expect(outcome).toEqual({ success: true, message: 'Simulator "UDID-BOOTED" shut down.' })
    expect(stub.calls).toEqual([{ file: 'xcrun', args: ['simctl', 'shutdown', 'UDID-BOOTED'], timeoutMs: 250 }])
  })

  it('fails loud with the underlying error message', () => {
    const stub = failingRunner(new Error('Unable to find device'))
    const outcome = iosSimulator.shutdownSimulator(env(stub.runner), 'nope')
    expect(outcome).toEqual({ success: false, message: 'Shutdown failed: Unable to find device' })
  })
})

describe('captureSimulatorScreenshot', () => {
  it('fails off macOS without spawning', () => {
    const stub = runnerStub(() => {
      throw new Error('must not spawn')
    })
    const outcome = iosSimulator.captureSimulatorScreenshot(env(stub.runner, 'linux'), iosSimulator.Udid('UDID-1'), '/tmp/shot.png')
    expect(outcome).toEqual({
      success: false,
      udid: 'UDID-1',
      error: 'The iOS simulator screenshot requires macOS.',
    })
    expect(stub.calls).toEqual([])
  })

  it('creates the parent directory, captures to the resolved path, and reports the file', () => {
    const base = tempDir()
    try {
      const outputPath = join(base, 'nested', 'shot.png')
      const stub = runnerStub((_file, args) => {
        writeFileSync(args[4]!, 'png-bytes')
        return ''
      })
      const outcome = iosSimulator.captureSimulatorScreenshot(env(stub.runner), iosSimulator.Udid('UDID-BOOTED'), outputPath)
      expect(outcome).toEqual({ success: true, udid: 'UDID-BOOTED', filePath: outputPath })
      expect(existsSync(outputPath)).toBe(true)
      expect(stub.calls).toEqual([{
        file: 'xcrun',
        args: ['simctl', 'io', 'UDID-BOOTED', 'screenshot', outputPath],
        timeoutMs: 250,
      }])
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('fails with the underlying error when simctl fails', () => {
    const stub = failingRunner(new Error('No devices are booted.'))
    const outcome = iosSimulator.captureSimulatorScreenshot(env(stub.runner), iosSimulator.Udid('UDID-1'), '/tmp/shot.png')
    expect(outcome).toEqual({ success: false, udid: 'UDID-1', error: 'No devices are booted.' })
  })

  it('fails when simctl succeeds but writes no image', () => {
    const base = tempDir()
    try {
      const stub = runnerStub(() => '')
      const outcome = iosSimulator.captureSimulatorScreenshot(env(stub.runner), iosSimulator.Udid('UDID-1'), join(base, 'shot.png'))
      expect(outcome.success).toBe(false)
      if (outcome.success) throw new Error('expected failure')
      expect(outcome.error).toContain('no image was written to')
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})

describe('/ios command', () => {
  it('refuses to run off macOS', () => {
    const stub = runnerStub(() => '')
    const test = bootFactory(stub.runner, 'linux')
    expect(run(test, 'list')).toEqual({
      kind: 'error',
      text: 'The `/ios` command requires macOS with Xcode installed.',
    })
    expect(stub.calls).toEqual([])
  })

  it('lists available simulators with states and the follow-up hints', () => {
    const stub = runnerStub(() => LIST_JSON)
    const test = bootFactory(stub.runner, 'darwin')
    const result = run(test, 'list')
    expect(result.kind).toBe('success')
    if (result.kind !== 'success') throw new Error('expected success')
    expect(result.text).toContain('### Available iOS simulators:')
    expect(result.text).toContain('- **iPhone 15** (`UDID-BOOTED`) — *Booted* (iOS-17-0)')
    expect(result.text).toContain('/ios boot <name>')
    expect(result.text).toContain('/ios screenshot')
  })

  it('reports an empty simulator list when xcrun has no devices', () => {
    const stub = runnerStub(() => '{"devices":{}}')
    const test = bootFactory(stub.runner, 'darwin')
    expect(run(test, '')).toEqual({
      kind: 'success',
      text: 'No available iOS simulators found. Verify that Xcode and the iOS runtimes are installed.',
    })
  })

  it('rejects boot and shutdown without a target', () => {
    const stub = runnerStub(() => '')
    const test = bootFactory(stub.runner, 'darwin')
    expect(run(test, 'boot')).toEqual({
      kind: 'error',
      text: 'Usage: `/ios boot <simulator name or UDID>`',
    })
    expect(run(test, 'shutdown')).toEqual({
      kind: 'error',
      text: 'Usage: `/ios shutdown <simulator name or UDID>`',
    })
  })

  it('boots and shuts down by name or UDID', () => {
    const stub = runnerStub(() => '')
    const test = bootFactory(stub.runner, 'darwin')
    expect(run(test, 'boot iPhone 15')).toEqual({ kind: 'success', text: 'Simulator "iPhone 15" booted.' })
    expect(run(test, 'shutdown iPhone 15')).toEqual({ kind: 'success', text: 'Simulator "iPhone 15" shut down.' })
    expect(stub.calls.map(call => call.args)).toEqual([
      ['simctl', 'boot', 'iPhone 15'],
      ['-a', 'Simulator'],
      ['simctl', 'shutdown', 'iPhone 15'],
    ])
  })

  it('surfaces boot and shutdown failures as errors', () => {
    const bootFailure = Object.assign(new Error('spawnSync xcrun ENOENT'), { code: 'ENOENT' })
    const bootStub = failingRunner(bootFailure)
    const bootTest = bootFactory(bootStub.runner, 'darwin')
    expect(run(bootTest, 'boot iPhone 15')).toEqual({
      kind: 'error',
      text: 'Boot failed: spawnSync xcrun ENOENT',
    })

    const shutdownStub = failingRunner(new Error('Unable to find device'))
    const shutdownTest = bootFactory(shutdownStub.runner, 'darwin')
    expect(run(shutdownTest, 'shutdown nope')).toEqual({
      kind: 'error',
      text: 'Shutdown failed: Unable to find device',
    })
  })

  it('opens the Simulator app without arguments to xcrun', () => {
    const stub = runnerStub(() => '')
    const test = bootFactory(stub.runner, 'darwin')
    expect(run(test, 'open')).toEqual({ kind: 'success', text: 'iOS Simulator app opened.' })
    expect(stub.calls).toEqual([{ file: 'open', args: ['-a', 'Simulator'], timeoutMs: 3000 }])
  })

  it('captures a screenshot of the booted device into the configured directory', () => {
    const dir = tempDir()
    try {
      const stub = runnerStub((_file, args) => {
        writeFileSync(args[4]!, 'png-bytes')
        return ''
      })
      const test = bootFactory(stub.runner, 'darwin', { screenshotDir: dir, timeoutMs: 900 })
      const result = run(test, 'screenshot')
      expect(result.kind).toBe('success')
      if (result.kind !== 'success') throw new Error('expected success')
      expect(result.text).toContain('Screenshot saved.')
      expect(stub.calls[0]!.args[2]).toBe('booted')
      expect(stub.calls[0]!.args[4]!.startsWith(dir)).toBe(true)
      expect(stub.calls[0]!.timeoutMs).toBe(900)
      expect(existsSync(stub.calls[0]!.args[4]!)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('surfaces a screenshot failure as an error', () => {
    const stub = failingRunner(new Error('No devices are booted.'))
    const test = bootFactory(stub.runner, 'darwin')
    const result = run(test, 'screenshot')
    expect(result).toEqual({
      kind: 'error',
      text: 'Screenshot failed (make sure a simulator is booted): No devices are booted.',
    })
  })

  it('prints the usage line for an unknown action', () => {
    const stub = runnerStub(() => '')
    const test = bootFactory(stub.runner, 'darwin')
    expect(run(test, 'reboot')).toEqual({
      kind: 'success',
      text: 'Usage: `/ios list` | `/ios boot <name>` | `/ios shutdown <name>` | `/ios open` | `/ios screenshot`',
    })
  })
})

describe('ios tools', () => {
  it('projects listed devices through ios_list_devices and renders them', async () => {
    const stub = runnerStub(() => LIST_JSON)
    const test = bootFactory(stub.runner, 'darwin')
    const tool = test.tools.ios_list_devices!
    expect(tool.description).toBe('List all iOS simulators configured and available on this macOS machine.')
    const value = await tool.execute({}) as { devices: { name: string; udid: string; state: string }[] }
    expect(value.devices).toEqual([
      { name: 'iPhone 15', udid: 'UDID-BOOTED', state: 'Booted' },
      { name: 'iPhone SE', udid: 'UDID-SHUTDOWN', state: 'Shutdown' },
      { name: 'iPad Pro', udid: 'UDID-CREATING', state: 'Unknown' },
    ])
    const rendered = tool.output.render({}, value as never) as { text: string }[]
    expect(rendered[0]!.text).toContain('Found 3 iOS simulator devices:')
    expect(rendered[0]!.text).toContain('- iPhone 15 (Booted) [UDID-BOOTED]')
  })

  it('captures a screenshot through ios_simulator_screenshot and renders the path', async () => {
    const base = tempDir()
    try {
      const stub = runnerStub((_file, args) => {
        writeFileSync(args[4]!, 'png-bytes')
        return ''
      })
      const test = bootFactory(stub.runner, 'darwin')
      const tool = test.tools.ios_simulator_screenshot!
      const outputPath = join(base, 'shot.png')
      const value = await tool.execute({ udid: 'UDID-BOOTED', outputPath }) as { success: boolean; filePath: string; udid: string }
      expect(value).toEqual({ success: true, filePath: outputPath, udid: 'UDID-BOOTED' })
      const rendered = tool.output.render({}, value as never) as { text: string }[]
      expect(rendered[0]!.text).toBe(`Screenshot saved for UDID-BOOTED: ${outputPath}`)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('rejects with the underlying error when the capture fails', async () => {
    const stub = failingRunner(new Error('No devices are booted.'))
    const test = bootFactory(stub.runner, 'darwin')
    await expect(test.tools.ios_simulator_screenshot!.execute({ udid: 'UDID-1', outputPath: '/tmp/shot.png' }))
      .rejects.toThrow('No devices are booted.')
  })

  it('rejects off macOS', async () => {
    const stub = runnerStub(() => {
      throw new Error('must not spawn')
    })
    const test = bootFactory(stub.runner, 'linux')
    await expect(test.tools.ios_simulator_screenshot!.execute({ udid: 'UDID-1', outputPath: '/tmp/shot.png' }))
      .rejects.toThrow('requires macOS')
  })
})

describe('plugin wiring', () => {
  it('registers the /ios command and both tools with defaults, and disposes them', async () => {
    const ctx = new Context()
    let command: CommandDefinition | undefined
    const tools: CapturedTool[] = []
    ctx.provide('commands', {
      register(next: CommandDefinition) {
        command = next
        return () => { command = undefined }
      },
    } as never)
    ctx.provide('tools', {
      register(next: CapturedTool) {
        tools.push(next)
        return () => { const at = tools.indexOf(next); if (at >= 0) tools.splice(at, 1) }
      },
    } as never)
    const fiber = await ctx.plugin(iosSimulator)

    expect(iosSimulator.name).toBe('ios-simulator')
    expect(iosSimulator.inject).toEqual(['commands', 'tools'])
    expect('default' in iosSimulator).toBe(false)
    expect(command).toMatchObject({
      name: 'ios',
      description: 'Drive the built-in iOS simulators (list, boot, shutdown, open, screenshot).',
      input: { hint: '[list | boot <name/udid> | shutdown <name/udid> | open | screenshot]' },
    })
    expect(tools.map(tool => tool.name)).toEqual(['ios_list_devices', 'ios_simulator_screenshot'])

    await fiber.dispose()
    expect(command).toBeUndefined()
    expect(tools).toEqual([])
  })

  it('rejects a non-positive timeoutMs at load (misconfiguration fails loud)', async () => {
    const ctx = new Context()
    ctx.provide('commands', { register: () => () => undefined } as never)
    ctx.provide('tools', { register: () => () => undefined } as never)
    await expect(ctx.plugin(iosSimulator, { timeoutMs: 0 })).rejects.toThrow('timeoutMs')
  })

  it('rejects a non-string screenshotDir at load', async () => {
    const ctx = new Context()
    ctx.provide('commands', { register: () => () => undefined } as never)
    ctx.provide('tools', { register: () => () => undefined } as never)
    await expect(ctx.plugin(iosSimulator, { screenshotDir: 42 } as never)).rejects.toThrow('screenshotDir')
  })
})
