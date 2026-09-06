/**
 * Auto-continue guard: automatic recovery of rate-limit and quota model-request
 * failures. When a failed request classifies as rate-limited, the guard waits a
 * bounded delay on the agent loop's `agent/request-error` waterfall and returns
 * `{ kind: 'retry' }`, so the loop re-attempts the identical request without
 * human intervention. Everything the guard does not own — other failure
 * classes, disabled state, exhausted budget — delegates to the next listener or
 * the terminal failure path.
 *
 * @module @deepseek-ai/dsh-auto-continue
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Events } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { RequestErrorAction } from '@deepseek-ai/dsh-agent'
import type { LlmFailure } from '@deepseek-ai/dsh-llm'
import { cancellableDelay, createOperationTracker } from '@deepseek-ai/dsh-llm-retry'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'

export const name = 'auto-continue'
export const inject = ['commands']

/** Plugin config. */
export interface Config {
  /**
   * Whether the guard owns rate-limit recovery. Default: false — mounting the
   * guard alone never changes failure behavior until it is enabled here or via
   * `/autocontinue on`.
   */
  enabled?: boolean
  /**
   * Owned recoveries whose cooldown elapsed without cancellation, allowed per
   * agent before the guard delegates. The count covers consecutive rate-limit
   * recoveries of one agent and resets when that agent's session logs a
   * successful model response. Default: 10.
   */
  maxContinues?: number
  /**
   * Base exponential backoff in milliseconds for the first owned recovery of a
   * streak; each consecutive owned recovery without an intervening successful
   * request doubles the previous delay. Default: 1000.
   */
  delayMs?: number
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
  maxContinues: z.number().step(1).min(1).default(10),
  delayMs: z.number().min(0).max(MAX_TIMER_DELAY_MS).default(1000),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    autoContinue: AutoContinueService
  }
}

/**
 * Message fragments that identify rate-limit or quota exhaustion in provider
 * failures that carry no harness-owned code. Matched lowercased.
 */
const RATE_LIMIT_MESSAGE_MARKERS = Object.freeze([
  'rate_limit',
  'rate limit',
  '429',
  'too many requests',
  'quota exceeded',
  'resource_exhausted',
  'capacity',
  'budget exhausted',
])

/**
 * Classify one normalized model-request failure as rate-limit or quota
 * exhaustion. Harness-owned codes decide first (`RATE_LIMIT`, `QUOTA`, HTTP
 * 429); failures that surface as `UNKNOWN` keep the message-marker fallback so
 * foreign provider wording still recovers.
 * @param failure - serializable failure facts of the failed request.
 * @returns true when the failure indicates a rate limit or quota exhaustion.
 */
export function isRateLimitError(failure: LlmFailure): boolean {
  if (failure.code === 'RATE_LIMIT' || failure.code === 'QUOTA') return true
  if (failure.status === 429) return true
  const message = failure.message.toLowerCase()
  return RATE_LIMIT_MESSAGE_MARKERS.some(marker => message.includes(marker))
}

/**
 * Exponential backoff for one owned recovery: `baseMs` doubled per prior
 * consecutive recovery. The cap at the Node timer ceiling keeps `setTimeout`
 * from clamping a large delay to an immediate fire.
 * @param priorContinues - owned recoveries already counted for the agent before this one.
 * @param baseMs - configured base delay (`Config.delayMs`).
 * @returns the computed wait in milliseconds.
 */
export function calculateBackoffMs(priorContinues: number, baseMs: number): number {
  const exponent = Math.min(priorContinues, 1024)
  return Math.min(baseMs * 2 ** exponent, MAX_TIMER_DELAY_MS)
}

/**
 * Resolve the cooldown for one owned recovery: the provider's retry-after hint
 * when the failure carries one, otherwise exponential backoff from
 * {@link calculateBackoffMs}. The hint is authoritative, so it is honored up to
 * the Node timer ceiling rather than compressed into the backoff curve.
 * @param failure - serializable failure facts of the failed request.
 * @param priorContinues - owned recoveries already counted for the agent before this one.
 * @param baseMs - configured base delay (`Config.delayMs`).
 * @returns the cooldown in milliseconds.
 */
export function resolveRecoveryDelayMs(failure: LlmFailure, priorContinues: number, baseMs: number): number {
  const retryAfterMs = failure.providerRetryAfterMs
  if (retryAfterMs !== undefined) return Math.min(retryAfterMs, MAX_TIMER_DELAY_MS)
  return calculateBackoffMs(priorContinues, baseMs)
}

/**
 * The auto-continue service: per-agent continuation budget and live toggle
 * state, owned by the mounting plugin fiber so a disposed plugin leaves no
 * state behind.
 */
export class AutoContinueService extends Service {
  /** Whether the guard owns rate-limit recovery; toggled by `/autocontinue`. */
  enabled: boolean
  /** Owned recoveries with an elapsed cooldown allowed per agent before the guard delegates. */
  readonly maxContinues: number
  /** Base exponential backoff in milliseconds. */
  readonly delayMs: number
  /** Consecutive owned recoveries per agent id. */
  private readonly continues = new Map<SessionId, number>()
  /** Pending resume time per agent id while one cooldown wait is in flight. */
  private readonly resumeAt = new Map<SessionId, number>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'autoContinue')
    // The validated Config fills every schema default; the casts only bridge
    // the optional input type.
    this.enabled = config.enabled as boolean
    this.maxContinues = config.maxContinues as number
    this.delayMs = config.delayMs as number
  }

  /**
   * Read the consecutive owned recoveries already counted for one agent.
   * @param agentId - identity carried by the failed request's agent.
   * @returns the current consecutive-continue count.
   */
  continuesFor(agentId: SessionId): number {
    return this.continues.get(agentId) ?? 0
  }

  /**
   * Whether one agent has spent its whole continuation budget.
   * @param agentId - identity carried by the failed request's agent.
   * @returns true when further owned recoveries must delegate.
   */
  budgetExhausted(agentId: SessionId): boolean {
    return this.continuesFor(agentId) >= this.maxContinues
  }

  /**
   * Count one owned recovery with an elapsed cooldown for one agent.
   * @param agentId - identity carried by the failed request's agent.
   */
  recordContinue(agentId: SessionId): void {
    this.continues.set(agentId, this.continuesFor(agentId) + 1)
  }

  /**
   * Drop one agent's consecutive-continue count after a successful request.
   * @param agentId - identity of the agent whose session logged the success.
   */
  resetBudget(agentId: SessionId): void {
    this.continues.delete(agentId)
  }

  /**
   * Record the pending resume time of one in-flight cooldown wait, for the
   * `/autocontinue status` report.
   * @param agentId - identity of the agent whose recovery is cooling down.
   * @param resumeAt - epoch milliseconds when the wait elapses.
   */
  noteWait(agentId: SessionId, resumeAt: number): void {
    this.resumeAt.set(agentId, resumeAt)
  }

  /**
   * Clear one agent's in-flight cooldown wait record.
   * @param agentId - identity of the agent whose wait settled or was cancelled.
   */
  clearWait(agentId: SessionId): void {
    this.resumeAt.delete(agentId)
  }

  /**
   * Read the pending resume time of one agent's cooldown wait.
   * @param agentId - identity of the agent whose wait is queried.
   * @returns epoch milliseconds when the wait elapses, or undefined when none is in flight.
   */
  waitResumeAt(agentId: SessionId): number | undefined {
    return this.resumeAt.get(agentId)
  }
}

const USAGE = 'Usage: /autocontinue [on | off | status | reset]'

/** Render the `/autocontinue status` report for the invoking agent. */
function statusText(service: AutoContinueService, invocation: CommandInvocation): string {
  const agentId = invocation.agent.id
  const resumeAt = service.waitResumeAt(agentId)
  const wait = resumeAt === undefined
    ? ''
    : `\n- Rate-limit cooldown: resuming in ${Math.ceil((resumeAt - Date.now()) / 1000)}s`
  return [
    'Auto-continue status:',
    `- Enabled: ${service.enabled ? 'yes' : 'no'}`,
    `- Continues used by this agent: ${service.continuesFor(agentId)} of ${service.maxContinues}`,
    `- Base backoff: ${service.delayMs}ms${wait}`,
    '',
    'Commands: /autocontinue on | /autocontinue off | /autocontinue status | /autocontinue reset',
  ].join('\n')
}

/**
 * Execute one `/autocontinue` invocation through the service.
 * @param service - the mounting fiber's auto-continue state.
 * @param invocation - receiving agent and raw command input.
 * @returns a human-readable success report, or a usage error.
 */
function executeCommand(service: AutoContinueService, invocation: CommandInvocation): CommandResult {
  const agentId = invocation.agent.id
  switch (invocation.rawInput.trim().toLowerCase()) {
    case 'on':
      service.enabled = true
      return { kind: 'success', text: 'Auto-continue enabled: rate-limit failures wait out a cooldown and retry automatically until the continuation budget is spent.' }
    case 'off':
      service.enabled = false
      return { kind: 'success', text: 'Auto-continue disabled: request failures surface immediately.' }
    case 'reset':
      service.resetBudget(agentId)
      return { kind: 'success', text: `Continuation budget reset for agent ${agentId}.` }
    case '':
    case 'status':
      return { kind: 'success', text: statusText(service, invocation) }
    default:
      return { kind: 'error', text: `Unknown argument ${JSON.stringify(invocation.rawInput.trim())}. ${USAGE}` }
  }
}

/**
 * Install the auto-continue guard: the per-agent budget service, the
 * `agent/request-error` recovery listener, the budget-reset observer, and the
 * `/autocontinue` command.
 * @param ctx - plugin context; listeners, state, and active waits are disposed with it.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const service = new AutoContinueService(ctx, config)
  const lifetime = new AbortController()
  const { track, active } = createOperationTracker()

  async function recover(
    { agent, failure, signal }: Parameters<Events['agent/request-error']>[0],
    next: () => Promise<RequestErrorAction>,
  ): Promise<RequestErrorAction> {
    if (!service.enabled) return next()
    if (!isRateLimitError(failure)) return next()
    if (service.budgetExhausted(agent.id)) return next()
    const delayMs = resolveRecoveryDelayMs(failure, service.continuesFor(agent.id), service.delayMs)
    service.noteWait(agent.id, Date.now() + delayMs)
    try {
      // The turn signal and the plugin lifetime both cancel the wait: an
      // aborted turn ends its step terminally, and disposal must not return a
      // retry owned by a plugin that no longer exists.
      if (!await cancellableDelay(delayMs, AbortSignal.any([signal, lifetime.signal]))) return undefined
      service.recordContinue(agent.id)
      return { kind: 'retry' }
    } finally {
      service.clearWait(agent.id)
    }
  }

  const disposeRecovery = ctx.on('agent/request-error', (payload, next: () => Promise<RequestErrorAction>) => {
    // A waterfall may hold this callback past disposal; lifetime cancellation
    // must stop a stale callback from returning a retry after teardown.
    if (lifetime.signal.aborted) return Promise.resolve<RequestErrorAction>(undefined)
    return track(recover(payload, next))
  })

  // A successful model response ends the consecutive-continue streak: the
  // budget only limits recoveries without an intervening success.
  const disposeReset = ctx.on('session/event', (session, event) => {
    if (event.type === 'assistant/message') service.resetBudget(session.id)
  })

  ctx.effect(() => async () => {
    disposeReset()
    disposeRecovery()
    lifetime.abort(new Error('auto-continue plugin disposed'))
    await Promise.allSettled([...active])
  }, 'auto-continue: stop recovery and drain active waits')

  ctx.effect(function* () {
    yield ctx.commands.register({
      name: 'autocontinue',
      description: 'Toggle or inspect automatic recovery from rate-limit model-request failures',
      input: { hint: '[on | off | status | reset]' },
      handler: invocation => executeCommand(service, invocation),
    })
  }, 'auto-continue: /autocontinue command')
}
