/**
 * Screen Reader & Accessibility Mode:
 * Formats session events as a clean, linear, semantic text stream tailored
 * for VoiceOver, screen readers, and braille displays — no ANSI noise, no
 * animated spinners, no multi-column widgets. The `/screenreader` command
 * toggles the mode and its verbosity; no terminal renderer consumes the
 * formatter yet (see Known Limitations in the README).
 *
 * @module @deepseek-ai/dsh-screen-reader
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { assertNever } from '@deepseek-ai/dsh-llm'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'

/** Plugin name. */
export const name = 'screen-reader'
/** Required Cordis services. */
export const inject = ['commands']

/** Level of detail for transcribed event narratives. */
export type Verbosity = 'concise' | 'standard' | 'verbose'

/** Category of event being transcribed. */
export type LinearEventType = 'user' | 'agent' | 'tool' | 'error'

/** Per-context accessibility-mode state owned by the service. */
export interface ScreenReaderState {
  /** Whether linear accessibility output is enabled. */
  readonly enabled: boolean
  /** Level of detail for transcribed event narratives. */
  readonly verbosity: Verbosity
}

/** Human-readable labels per event category, announced before the content. */
const EVENT_LABELS: Record<LinearEventType, string> = {
  user: 'User message',
  agent: 'Assistant response',
  tool: 'Tool execution',
  error: 'Error alert',
}

/**
 * Strip all ANSI escape sequences and decorative unicode drawing characters.
 * @param text - raw formatted text string containing terminal escape sequences.
 * @returns sanitized text string suitable for screen readers.
 */
export function stripAnsiAndDecorations(text: string): string {
  return text
    .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/[\u2500-\u257F]/g, '')
    .replace(/[│┃├┤┬┴┼]/g, '')
    .trim()
}

/**
 * Format one turn event linearly for screen readers. A pure function of its
 * arguments: `concise` collapses the event to a single labelled line,
 * `standard` announces the label then the full content, and `verbose` adds an
 * explicit end-of-event marker so braille readers know where the event stops.
 * @param type - category of event being transcribed.
 * @param content - text payload of the turn.
 * @param verbosity - level of detail for the narrative.
 * @returns formatted accessible linear announcement string.
 */
export function formatLinearEvent(type: LinearEventType, content: string, verbosity: Verbosity = 'standard'): string {
  const clean = stripAnsiAndDecorations(content)
  switch (verbosity) {
    case 'concise': {
      const newline = clean.indexOf('\n')
      const firstLine = newline === -1 ? clean : clean.slice(0, newline)
      return `[${EVENT_LABELS[type]}] ${firstLine}`
    }
    case 'verbose':
      return `\n[${EVENT_LABELS[type]}] :\n${clean}\n[end of ${EVENT_LABELS[type].toLowerCase()}]\n`
    case 'standard':
      return `\n[${EVENT_LABELS[type]}] :\n${clean}\n`
    /* v8 ignore next -- Verbosity is a closed union; this retains compile-time exhaustiveness. */
    default:
      return assertNever(verbosity, 'screen-reader verbosity')
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    screenReader: ScreenReaderService
  }
}

/**
 * The screen-reader service: owns the per-context accessibility-mode state
 * the `/screenreader` command drives and reporters read.
 */
export class ScreenReaderService extends Service {
  private enabled = false
  private verbosity: Verbosity = 'standard'

  constructor(ctx: Context) {
    super(ctx, 'screenReader')
  }

  /** Current mode snapshot. */
  get state(): ScreenReaderState {
    return { enabled: this.enabled, verbosity: this.verbosity }
  }

  /**
   * Enable or disable linear accessibility output.
   * @param value - the new enabled state.
   */
  setEnabled(value: boolean): void {
    this.enabled = value
  }

  /**
   * Set the narrative detail level.
   * @param value - the new verbosity level.
   */
  setVerbosity(value: Verbosity): void {
    this.verbosity = value
  }
}

/**
 * Mount the screen-reader command. Registrations ride `ctx.effect`, so the
 * command is disposed with the plugin's fiber.
 * @param ctx - Cordis context carrying the commands service.
 */
export function apply(ctx: Context): void {
  const service = new ScreenReaderService(ctx)

  ctx.effect(() => ctx.commands.register({
    name: 'screenreader',
    description: 'Toggle screen-reader mode (linear text output without animations, optimized for VoiceOver).',
    input: {
      hint: '[on | off | status | verbose | standard | concise]',
    },
    handler: (invocation: CommandInvocation): CommandResult => {
      const mode = invocation.rawInput.trim().toLowerCase()

      if (mode === 'on') {
        service.setEnabled(true)
        return {
          kind: 'success',
          text: 'Screen-reader mode enabled. Visual rendering is replaced by a linear, accessible text stream.',
        }
      }

      if (mode === 'off') {
        service.setEnabled(false)
        return {
          kind: 'success',
          text: 'Screen-reader mode disabled. Standard visual rendering restored.',
        }
      }

      if (mode === 'verbose' || mode === 'concise' || mode === 'standard') {
        service.setVerbosity(mode)
        return { kind: 'success', text: `Accessibility verbosity set to: ${mode}.` }
      }

      const state = service.state
      return {
        kind: 'success',
        text: `Screen Reader Mode status:\n- State: ${state.enabled ? 'Enabled' : 'Disabled'}\n- Verbosity: ${state.verbosity}\n\nCommands: /screenreader on | /screenreader off | /screenreader verbose | /screenreader standard | /screenreader concise`,
      }
    },
  }), 'screen-reader: command')
}
