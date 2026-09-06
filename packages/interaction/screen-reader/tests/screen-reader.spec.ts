import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition, CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import {
  formatLinearEvent,
  ScreenReaderService,
  stripAnsiAndDecorations,
} from '../src/index.ts'

/** Mount the plugin product over captured `commands` and `screenReader` services. */
async function harness(): Promise<{ command: CommandDefinition; service: ScreenReaderService }> {
  const ctx = new Context()
  let command: CommandDefinition | undefined
  ctx.provide('commands', {
    register(next: CommandDefinition) {
      command = next
      return () => { command = undefined }
    },
  } as never)
  const { apply } = await import('../src/index.ts')
  apply(ctx)
  if (command === undefined) throw new Error('plugin did not register its command')
  return { command, service: ctx.screenReader }
}

/** Invoke the captured `/screenreader` handler the way the executor would. */
function run(command: CommandDefinition, rawInput: string) {
  return command.handler({ rawInput } as CommandInvocation)
}

describe('stripAnsiAndDecorations', () => {
  it('strips ANSI codes and unicode box characters', () => {
    const raw = '\x1B[32m✔ Success\x1B[0m │ ┌───┐'
    const cleaned = stripAnsiAndDecorations(raw)
    expect(cleaned).toBe('✔ Success')
  })
})

describe('formatLinearEvent', () => {
  it('announces each event category with a standard header block', () => {
    expect(formatLinearEvent('user', 'hello')).toBe('\n[User message] :\nhello\n')
    expect(formatLinearEvent('agent', 'hi there')).toBe('\n[Assistant response] :\nhi there\n')
    expect(formatLinearEvent('tool', 'ls -la')).toBe('\n[Tool execution] :\nls -la\n')
    expect(formatLinearEvent('error', 'boom')).toBe('\n[Error alert] :\nboom\n')
  })

  it('collapses concise narratives to a single labelled line', () => {
    const formatted = formatLinearEvent('tool', 'first line\nsecond line', 'concise')
    expect(formatted).toBe('[Tool execution] first line')
    expect(formatLinearEvent('error', 'single line', 'concise')).toBe('[Error alert] single line')
  })

  it('adds an explicit end marker for verbose narratives', () => {
    const formatted = formatLinearEvent('agent', 'long answer', 'verbose')
    expect(formatted).toBe('\n[Assistant response] :\nlong answer\n[end of assistant response]\n')
  })
})

describe('/screenreader command', () => {
  it('toggles the mode in both directions', async () => {
    const { command, service } = await harness()
    expect(run(command, 'on')).toEqual({
      kind: 'success',
      text: 'Screen-reader mode enabled. Visual rendering is replaced by a linear, accessible text stream.',
    })
    expect(service.state.enabled).toBe(true)
    expect(run(command, 'off')).toEqual({
      kind: 'success',
      text: 'Screen-reader mode disabled. Standard visual rendering restored.',
    })
    expect(service.state.enabled).toBe(false)
  })

  it('cycles the verbosity through all three levels', async () => {
    const { command, service } = await harness()
    expect(run(command, 'verbose')).toEqual({ kind: 'success', text: 'Accessibility verbosity set to: verbose.' })
    expect(service.state.verbosity).toBe('verbose')
    expect(run(command, 'concise')).toEqual({ kind: 'success', text: 'Accessibility verbosity set to: concise.' })
    expect(run(command, 'standard')).toEqual({ kind: 'success', text: 'Accessibility verbosity set to: standard.' })
    expect(service.state.verbosity).toBe('standard')
  })

  it('reports status with usage for unknown input', async () => {
    const { command, service } = await harness()
    expect(run(command, 'bogus')).toEqual({
      kind: 'success',
      text: 'Screen Reader Mode status:\n- State: Disabled\n- Verbosity: standard\n\nCommands: /screenreader on | /screenreader off | /screenreader verbose | /screenreader standard | /screenreader concise',
    })
    service.setEnabled(true)
    expect((run(command, 'status') as CommandResult).text).toContain('- State: Enabled')
  })
})
