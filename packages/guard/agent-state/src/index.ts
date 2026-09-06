/**
 * Agent state persistence and action consequence reasoning. Before every
 * mutating tool call the guard predicts the action's effects and exposes the
 * prediction to the model; after the call settles it compares the outcome
 * against the prediction and folds a durable lesson into per-tool rolling
 * statistics that survive across sessions. Only surprises are fed back as an
 * additional context — failures and prediction mismatches; a matched success
 * stays in the durable statistics so no message rides on every call.
 *
 * The persisted store is derived data in the dsh-memory pattern: one JSON
 * object per line under $DSH_HOME/agent-state/<workspace>/, rewritten
 * atomically; the session log stays the source of truth for model-visible
 * events.
 *
 * @module @deepseek-ai/dsh-agent-state
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { PostToolDecision, PreToolDecision, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { loadState, recordObservation, saveState, storePathFor } from './store.ts'
import type { StoreLimits } from './store.ts'
import { predictAction } from './predict.ts'
import type { ActionObservation, ActionPrediction, PersistedState } from './types.ts'

export * from './types.ts'
export { loadState, saveState, storePathFor } from './store.ts'
export type { StoreLimits } from './store.ts'
export { predictAction } from './predict.ts'

export const name = 'agent-state'

/** Plugin config. */
export interface Config {
  /**
   * Store directory location. Default: `agent-state` under \$DSH_HOME (or
   * `~/.dsh`); one state file per session cwd keeps workspaces independent.
   */
  storeDir?: string
  /** Deny predicted-irreversible calls outright instead of predicting and allowing. Default: false (reason, then let the policy decide). */
  denyIrreversible?: boolean
  /** Rolling observation rows retained in the store. Default: 200. */
  maxObservations?: number
  /** Distinct lessons retained per tool row. Default: 8. */
  maxLessonsPerTool?: number
}

export const Config: z<Config> = z.object({
  storeDir: z.string(),
  denyIrreversible: z.boolean().default(false),
  maxObservations: z.number().default(200),
  maxLessonsPerTool: z.number().default(8),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentState: AgentStateService
  }
}

const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'agent-state' }

/** One in-flight call's prediction, keyed by the registry execution token. */
interface Pending {
  readonly prediction: ActionPrediction
}

/**
 * The agent-state service: owns the durable per-workspace state store and the
 * pre/post consequence pipeline.
 */
export class AgentStateService extends Service {
  private readonly storePath: string
  private readonly state: PersistedState
  private readonly limits: StoreLimits
  private readonly pending = new WeakMap<ToolExecution, Pending>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'agentState')
    this.storePath = config.storeDir !== undefined
      ? (config.storeDir.endsWith('.jsonl') ? config.storeDir : `${config.storeDir}/state.jsonl`)
      : storePathFor(process.cwd())
    // The validated Config fills both schema defaults; the asserts only bridge
    // the optional input type.
    this.limits = { maxObservations: config.maxObservations as number, maxLessonsPerTool: config.maxLessonsPerTool as number }
    this.state = loadState(this.storePath)
  }

  /** Persist the current state to the store file. */
  private persist(): void {
    saveState(this.storePath, this.state)
  }

  /**
   * Remember one execution's prediction for the post-execute comparison.
   * @param exec - active tool execution key.
   * @param prediction - model consequence prediction before execution.
   */
  pendingStore(exec: ToolExecution, prediction: ActionPrediction): void {
    this.pending.set(exec, { prediction })
  }

  /**
   * Take (once) the prediction recorded for one execution, if any.
   * @param exec - active tool execution key.
   * @returns the stored prediction or undefined when none was recorded.
   */
  pendingTake(exec: ToolExecution): ActionPrediction | undefined {
    return this.pending.get(exec)?.prediction
  }

  /**
   * Fold one settled observation into the durable state and persist it.
   * @param observation - settled post-execution consequence and verification score.
   */
  foldObservation(observation: ActionObservation): void {
    recordObservation(this.state, observation, this.limits)
    this.persist()
  }

  /**
   * Render the durable per-tool lessons for the tools named in one request.
   * @param tools - tool names the caller is about to use.
   * @returns a context message, or undefined when nothing relevant is stored.
   */
  recallFor(tools: readonly string[]): UserMessage | undefined {
    return this.recallRows(tools)
  }

  /**
   * Render every stored tool row with settled history, for step-wide recall.
   * @returns a context message, or undefined when no row has three settles.
   */
  recallAll(): UserMessage | undefined {
    return this.recallRows(Object.keys(this.state.tools))
  }

  /** Render the recall message for the subset of tool rows worth surfacing. */
  private recallRows(tools: readonly string[]): UserMessage | undefined {
    const lines: string[] = []
    for (const tool of tools) {
      const row = this.state.tools[tool]
      if (row === undefined) continue
      const total = row.successes + row.failures
      if (total < 3) continue
      const rate = Math.round((row.successes / total) * 100)
      lines.push(`- ${tool}: ${rate}% success over ${total} settled calls; lessons: ${row.lessons.slice(0, 3).join('; ') || 'none'}`)
    }
    if (lines.length === 0) return undefined
    return createUserMessage({
      content: [{ type: 'text', text: `Durable tool history for this workspace:\n${lines.join('\n')}` }],
      source: { ...PLUGIN_SOURCE, form: 'notice', summary: 'durable tool history' },
    })
  }
}

/**
 * Install the guard's listeners.
 * @param ctx - plugin context; listeners are scoped to it and disposed with it.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const service = new AgentStateService(ctx, config)

  // Before each step the model reasons over the durable state: per-tool
  // success rates and the lessons this workspace has already paid for. The
  // recall prepends to whatever the rest of the chain decided — the waterfall
  // still runs, so later listeners and the runtime-context projection keep
  // their contributions.
  ctx.on('agent/pre-step', async ({ signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (signal.aborted || decision.kind !== 'enter') return decision
    const recall = service.recallAll()
    if (recall === undefined) return decision
    return { kind: 'enter', messages: [recall, ...decision.messages] }
  })

  ctx.on('tools/pre-execute', async (exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> => {
    // Only reason about agent-loop calls: direct ctx.tools.execute() callers
    // get no model to inform and no observation to teach.
    if (exec.agent === undefined) return next()
    const prediction = predictAction(exec.name, exec.arguments)
    service.pendingStore(exec, prediction)
    if (prediction.risk === 'read-only') return next()
    // Reason first, then optionally deny: the additional context tells the
    // model what it predicted BEFORE the result, so the post comparison is
    // meaningful even when the policy denies.
    if (prediction.risk === 'irreversible' && config.denyIrreversible === true) {
      return { kind: 'deny', reason: denyReason(prediction) }
    }
    return next()
  })

  ctx.on('tools/post-execute', async (
    exec: ToolExecution,
    result: Readonly<ToolExecutionResult>,
    next: () => Promise<PostToolDecision>,
  ): Promise<PostToolDecision> => {
    const prediction = service.pendingTake(exec)
    const downstream = await next()
    if (exec.agent === undefined || prediction === undefined) return downstream

    const observation = settleObservation(exec, result, prediction)
    service.foldObservation(observation)
    // Surface only surprises: a matched success is already folded into the
    // durable statistics, and repeating it would inject a message after every
    // tool call. Blocks always carry the comparison — the call was stopped.
    const feedback = observationMessage(exec, observation)
    if (downstream.kind === 'block') {
      return { kind: 'block', feedback: downstream.feedback, additionalContexts: [feedback, ...downstream.additionalContexts ?? []] }
    }
    if (observation.matchedPrediction && observation.outcome === 'success') return downstream
    return { ...downstream, additionalContexts: [feedback, ...downstream.additionalContexts ?? []] }
  })
}

/**
 * Human-readable deny reason from a prediction: the details of its
 * consequences, most significant first. Irreversible predictions always carry
 * at least one consequence — the predictor pushes one with every irreversible
 * classification.
 */
function denyReason(prediction: ActionPrediction): string {
  return `agent-state: predicted irreversible action — ${prediction.consequences.map(c => c.detail).join('; ')}`
}

/** Settle one observation by comparing the settled result against the prediction. */function settleObservation(
  exec: ToolExecution,
  result: Readonly<ToolExecutionResult>,
  prediction: ActionPrediction,
): ActionObservation {
  const outcome = result.isError ? 'failure' : 'success'
  // An irreversible action that was allowed to run AND completed is the one
  // settle-time surprise worth remembering: the guard predicted unrecoverable
  // state change and the pipeline let it through.
  const unexpected: string[] = []
  if (prediction.risk === 'irreversible' && outcome === 'success') {
    unexpected.push('an irreversible action was allowed to run and completed')
  }
  const matchedPrediction = unexpected.length === 0
  const lesson = buildLesson(exec, outcome, unexpected)
  return {
    id: `${exec.name}:${exec.callId}`,
    tool: exec.name,
    outcome,
    matchedPrediction,
    unexpected,
    lesson,
    at: Date.now(),
  }
}

/** One durable one-line lesson for the tool's row. */
function buildLesson(exec: ToolExecution, outcome: ActionObservation['outcome'], unexpected: readonly string[]): string {
  if (unexpected.length > 0) return `${exec.name}: ${unexpected[0]}`
  if (outcome !== 'success') return `${exec.name} settled as ${outcome}; arguments were accepted but the call did not achieve its goal`
  return ''
}

/** Render the post-action comparison as an agent-visible context message. */
function observationMessage(exec: ToolExecution, observation: ActionObservation): UserMessage {
  const verdict = observation.matchedPrediction
    ? `the outcome matched the predicted ${observation.outcome === 'success' ? 'effect' : 'failure mode'}`
    : `UNEXPECTED: ${observation.unexpected.join('; ')}`
  const text = `[${exec.name}] settled ${observation.outcome} — ${verdict}.`
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { ...PLUGIN_SOURCE, form: 'notice', summary: `${exec.name} ${observation.outcome}` },
  })
}
