/**
 * World Model plugin for DeepSeek Harness.
 *
 * Provides three interlocking capabilities:
 *
 * 1. **Environment rules & policy validator** — declarative catalogue of capabilities,
 *    constraints, permissions, and runtime telemetry that shape and govern agent behavior.
 * 2. **Persistent state store** — one atomic, debounced JSON store per workspace cwd at
 *    `.dsh/world-state.json`, with backup recovery and fail-loud schema versioning.
 * 3. **Consequence & risk engine** — heuristic pre-flight impact and blast radius assessment,
 *    post-execution reconciliation, and divergence diagnostics.
 *
 * The consequence engine is wired into the tool pipeline: `tools/pre-execute`
 * predicts every agent-backed call, `tools/post-execute` reconciles the
 * prediction, records the settled task into the workspace store, and feeds a
 * comparison back to the model only on surprises — a failure or a prediction
 * mismatch — plus one confirmation for a confirmed high-risk success.
 *
 * Commands: `/env`, `/worldstate`.
 * Tools: `world_model_predict`, `world_model_query`, `world_model_save_fact`.
 *
 * @module @deepseek-ai/dsh-world-model
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource, UserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {
  PostToolDecision,
  PreToolDecision,
  ToolExecution,
  ToolExecutionResult,
  ToolRunContext,
} from '@deepseek-ai/dsh-tools'

import { EnvRuleRegistry, seedBuiltinRules } from './env-rules.ts'
import type { RuleCategory } from './env-rules.ts'
import { StateStore } from './state-store.ts'
import { ConsequenceEngine } from './consequence.ts'
import type { ConsequenceRecord } from './consequence.ts'

// ---------------------------------------------------------------------------
// Re-exports for consumers
// ---------------------------------------------------------------------------

export { EnvRuleRegistry, seedBuiltinRules } from './env-rules.ts'
export type {
  EnvRule,
  RuleCategory,
  ActionValidationResult,
  RuntimeTelemetry,
} from './env-rules.ts'

export { StateStore, WORLD_STATE_SCHEMA_VERSION } from './state-store.ts'
export type { WorldState, WorldSessionId, TaskRecord } from './state-store.ts'

export { ConsequenceEngine } from './consequence.ts'
export type {
  ConsequenceRecord,
  Effect,
  EffectKind,
  RiskLevel,
  BlastRadius,
  ImpactAssessment,
  ConsequenceStatus,
} from './consequence.ts'

export const name = 'world-model'
/** Required Cordis services. */
export const inject = ['systemPrompt', 'commands', 'tools']

/** Source stamped on every context message this plugin feeds back to the model. */
const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'world-model' }

/** Categories accepted by `/env add`, in the order the registry reports them. */
const RULE_CATEGORIES: readonly RuleCategory[] = ['capability', 'constraint', 'permission', 'resource']

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Plugin configuration. */
export interface Config {
  /** Maximum number of environment rules injected into the system prompt. */
  maxRules?: number
  /** Maximum task-history entries stored on disk per workspace. */
  maxHistory?: number
  /** Maximum consequence history entries held in memory. */
  maxConsequences?: number
}

export const Config: z<Config> = z.object({
  maxRules: z.number().default(30),
  maxHistory: z.number().default(50),
  maxConsequences: z.number().default(100),
})

// ---------------------------------------------------------------------------
// Plugin entry point
// ---------------------------------------------------------------------------

export function apply(ctx: Context, config: Config): void {
  // The validated Config fills all three schema defaults; the asserts only
  // bridge the optional input type.
  const maxRules = config.maxRules as number
  const maxHistory = config.maxHistory as number
  const maxConsequences = config.maxConsequences as number

  // ---------- Module 1: Environment rules ----------
  const envRules = new EnvRuleRegistry()
  seedBuiltinRules(envRules)

  // ---------- Module 3: Consequence engine ----------
  const consequences = new ConsequenceEngine({ capacity: maxConsequences })

  // ---------- Module 2: State store, one per workspace cwd ----------
  // Stores are created on first use and cached per distinct cwd, so concurrent
  // sessions over two workspaces never share state and every caller (commands,
  // tools, listeners) reaches the store without a prior human command.
  const stores = new Map<string, StateStore>()

  function getStateStore(cwd: string): StateStore {
    const existing = stores.get(cwd)
    if (existing !== undefined) return existing
    const store = new StateStore(cwd, { historyCap: maxHistory })
    store.setActiveRuleIds(envRules.list(true).map(r => r.id))
    stores.set(cwd, store)
    return store
  }

  /** Workspace of a session cwd, falling back to the process cwd when the caller has no session workspace. */
  function cwdOf(cwd: string | undefined): string {
    return cwd ?? process.cwd()
  }

  // Flush every debounced store when the plugin unloads.
  ctx.effect(() => () => {
    for (const store of stores.values()) {
      try { store.flush() } catch {
        // Teardown flush: the plugin is unloading, so no caller can receive the
        // error; the in-memory delta is lost rather than failing disposal.
      }
    }
  })

  // ---------- Inject rules into system prompt ----------
  ctx.inject(['systemPrompt'], (scope: Context) => {
    scope.systemPrompt.context({
      name: 'world-model',
      order: 55,
      text: (_context) => {
        const description = envRules.describeEnvironment()
        if (!description) return ''

        const activeRules = envRules.list(true)
        const truncated = activeRules.slice(0, maxRules)
        if (truncated.length < activeRules.length) {
          return description + `\n\n> ${activeRules.length - truncated.length} additional rule(s) omitted.`
        }
        return description
      },
    })
  })

  // ---------- Consequence pipeline (agent loop wiring) ----------
  // One in-flight prediction per execution, keyed by the registry execution
  // token (the agent-state Pending pattern): pre-execute stores, post-execute
  // takes exactly once.
  const pending = new WeakMap<ToolExecution, { record: ConsequenceRecord; startedAt: number }>()

  ctx.on('tools/pre-execute', async (exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> => {
    // Only reason about agent-loop calls: direct ctx.tools.execute() callers
    // have no session to record against and no model to inform.
    if (exec.agent === undefined) return next()
    pending.set(exec, { record: consequences.predict(exec.name, exec.arguments), startedAt: Date.now() })
    // Always delegate: the prediction is advisory and never rewrites or denies.
    return next()
  })

  ctx.on('tools/post-execute', async (
    exec: ToolExecution,
    result: Readonly<ToolExecutionResult>,
    next: () => Promise<PostToolDecision>,
  ): Promise<PostToolDecision> => {
    const entry = pending.get(exec)
    pending.delete(exec)
    // Reconcile against the downstream decision, never instead of it.
    const downstream = await next()
    if (exec.agent === undefined || entry === undefined) return downstream

    const actualEffects = consequences.inferActualEffects(exec.name, exec.arguments, !result.isError)
    consequences.reconcile(entry.record, actualEffects, {
      error: result.isError ? result.error.message : undefined,
      durationMs: Date.now() - entry.startedAt,
    })

    const store = getStateStore(cwdOf(exec.agent.session.header.cwd))
    store.setSession(exec.agent.session.header.id)
    store.recordTask({
      action: exec.name,
      timestamp: entry.record.timestamp,
      outcome: result.isError ? result.error.message : 'ok',
      success: !result.isError,
      durationMs: entry.record.durationMs,
    })
    // Every settled task persists synchronously (the agent-state store
    // discipline): the durable history never waits on the debounce timer.
    store.flush()

    // Feedback is surprise-only (the agent-state discipline): a failure or a
    // divergence carries the comparison; a confirmed success stays silent
    // unless the prediction was high-risk, where the model still learns which
    // risky effects it just caused. Model-visible ⟺ logged: the message rides
    // additionalContexts, so the loop appends it as a `user/message` event.
    const riskLevel = entry.record.assessment.riskLevel
    const surprise = result.isError || entry.record.status === 'diverged'
    if (!surprise && riskLevel !== 'high' && riskLevel !== 'critical') return downstream

    const feedback = consequenceFeedback(exec, entry.record, result)
    if (downstream.kind === 'block') {
      return { kind: 'block', feedback: downstream.feedback, additionalContexts: [feedback, ...downstream.additionalContexts ?? []] }
    }
    return { ...downstream, additionalContexts: [feedback, ...downstream.additionalContexts ?? []] }
  })

  // ---------- Command: /env ----------
  ctx.commands.register({
    name: 'env',
    description: 'Show and manage environment rules (capabilities, constraints, permissions, telemetry).',
    input: {
      hint: '[list | add <id> <category> <description> | remove <id> | toggle <id> | telemetry | check <action>]',
    },
    handler: (invocation: CommandInvocation): CommandResult => {
      const raw = invocation.rawInput.trim()
      const parts = raw === '' ? [] : raw.split(/\s+/)
      const subcommand = (parts[0] ?? 'list').toLowerCase()

      if (subcommand === 'list') {
        const desc = envRules.describeEnvironment()
        return {
          kind: 'success',
          text: desc || 'No active environment rules.',
        }
      }

      if (subcommand === 'telemetry') {
        const t = envRules.getTelemetry()
        const text = '### Runtime Telemetry\n' +
          `- **OS platform**: \`${t.platform}\` (${t.arch})\n` +
          `- **Node.js**: \`${t.nodeVersion}\`\n` +
          `- **CPUs**: ${t.cpuCount} cores\n` +
          `- **Memory**: ${t.freeMemoryMb} MB free / ${t.totalMemoryMb} MB total\n`
        return { kind: 'success', text }
      }

      if (subcommand === 'check') {
        const action = parts[1]
        if (action === undefined) return { kind: 'error', text: 'Usage: /env check <action_name>' }
        const validation = envRules.validateAction(action, {})
        const text = `### Policy validation for \`${action}\` (advisory)\n` +
          `- **Allowed**: ${validation.allowed ? 'yes' : 'no'}\n` +
          renderFindings('Violations', validation.violations) +
          renderFindings('Warnings', validation.warnings)
        return { kind: 'success', text }
      }

      if (subcommand === 'add') {
        const id = parts[1]
        const categoryInput = parts[2]
        const description = parts.slice(3).join(' ')
        if (id === undefined || categoryInput === undefined || description === '') {
          return { kind: 'error', text: 'Usage: /env add <id> <capability|constraint|permission|resource> <description>' }
        }
        if (!RULE_CATEGORIES.includes(categoryInput as RuleCategory)) {
          return { kind: 'error', text: `Unknown category "${categoryInput}". Valid categories: ${RULE_CATEGORIES.join(', ')}.` }
        }
        const category = categoryInput as RuleCategory
        envRules.register({ id, category, description, active: true, metadata: {} })
        getStateStore(cwdOf(invocation.agent.session.header.cwd)).setActiveRuleIds(envRules.list(true).map(r => r.id))
        return { kind: 'success', text: `Rule "${id}" added (${category}).` }
      }

      if (subcommand === 'remove') {
        const id = parts[1]
        if (id === undefined) return { kind: 'error', text: 'Usage: /env remove <id>' }
        envRules.setActive(id, false)
        getStateStore(cwdOf(invocation.agent.session.header.cwd)).setActiveRuleIds(envRules.list(true).map(r => r.id))
        return { kind: 'success', text: `Rule "${id}" deactivated.` }
      }

      if (subcommand === 'toggle') {
        const id = parts[1]
        if (id === undefined) return { kind: 'error', text: 'Usage: /env toggle <id>' }
        const rule = envRules.getRule(id)
        if (rule === undefined) return { kind: 'error', text: `Rule "${id}" not found.` }
        // Capture before setActive: getRule hands out the live registry entry,
        // and setActive mutates it in place.
        const wasActive = rule.active
        envRules.setActive(id, !wasActive)
        getStateStore(cwdOf(invocation.agent.session.header.cwd)).setActiveRuleIds(envRules.list(true).map(r => r.id))
        return { kind: 'success', text: `Rule "${id}" ${wasActive ? 'deactivated' : 'activated'}.` }
      }

      return { kind: 'error', text: 'Unknown subcommand. Usage: /env [list | telemetry | check | add | remove | toggle]' }
    },
  })

  // ---------- Command: /worldstate ----------
  ctx.commands.register({
    name: 'worldstate',
    description: 'Inspect and manage the persistent world-model state (durable facts, task history, consequences, risk).',
    input: {
      hint: '[show | reset | set <key> <value> | facts | history | consequences | risk]',
    },
    handler: (invocation: CommandInvocation): CommandResult => {
      const raw = invocation.rawInput.trim()
      const parts = raw === '' ? [] : raw.split(/\s+/)
      const subcommand = (parts[0] ?? 'show').toLowerCase()

      const store = getStateStore(cwdOf(invocation.agent.session.header.cwd))
      store.setSession(invocation.agent.session.header.id)

      if (subcommand === 'show') {
        const snap = store.snapshot
        return {
          kind: 'success',
          text: '### Current World-Model State\n' +
            `- **File**: \`${store.filePath}\`\n` +
            `- **Last write**: ${snap.lastUpdated}\n` +
            `- **Total writes**: ${snap.writeCount}\n` +
            `- **Active rules**: ${snap.activeRuleIds.length}\n` +
            `- **Task history**: ${snap.taskHistory.length} entries\n` +
            `- **Saved facts**: ${Object.keys(snap.customFacts).length} keys\n\n` +
            '```json\n' + JSON.stringify(snap, null, 2) + '\n```',
        }
      }

      if (subcommand === 'reset') {
        store.reset()
        store.flush()
        return { kind: 'success', text: 'World-model state reset and synchronized to disk.' }
      }

      if (subcommand === 'set') {
        const key = parts[1]
        if (key === undefined) return { kind: 'error', text: 'Usage: /worldstate set <key> <value>' }
        const value = parts.slice(2).join(' ')
        store.setFact(key, value === '' ? undefined : value)
        store.flush()
        return { kind: 'success', text: `Fact "${key}" ${value === '' ? 'removed from' : 'set in'} the persistent store.` }
      }

      if (subcommand === 'facts') {
        const facts = store.getAllFacts()
        const entries = Object.entries(facts)
        if (entries.length === 0) return { kind: 'success', text: 'No custom facts recorded.' }
        const list = entries.map(([k, v]) => `- **${k}**: \`${JSON.stringify(v)}\``).join('\n')
        return { kind: 'success', text: `### Persistent facts (${entries.length})\n${list}` }
      }

      if (subcommand === 'history') {
        const history = store.snapshot.taskHistory
        if (history.length === 0) return { kind: 'success', text: 'No tasks in the history.' }
        const lines = history.slice(-20).map(t =>
          `- [${t.success ? '✅' : '❌'}] **${t.action}** — ${t.outcome} (${t.durationMs}ms) _(${t.timestamp})_`,
        ).join('\n')
        return { kind: 'success', text: `### Task history (${history.length} entries)\n${lines}` }
      }

      if (subcommand === 'consequences') {
        const recent = consequences.recent(15)
        if (recent.length === 0) return { kind: 'success', text: 'No consequences recorded in this session.' }
        const lines = recent.map((r) => {
          const riskBadge = r.assessment.riskLevel === 'critical' ? '🔴 CRITICAL' :
            r.assessment.riskLevel === 'high' ? '🟠 HIGH' :
              r.assessment.riskLevel === 'medium' ? '🟡 MEDIUM' : '🟢 LOW'
          const effects = r.predictedEffects.map(e => `    - ${e.kind}: \`${e.target}\``).join('\n')
          return `- **${r.action}** [${r.status.toUpperCase()}] [${riskBadge}] (Blast: ${r.assessment.blastRadius})\n${effects}`
        }).join('\n')
        const divergences = consequences.divergences()
        const footer = divergences.length > 0
          ? `\n\n⚠️ **${divergences.length} anomaly/divergence(s) detected**.`
          : ''
        return { kind: 'success', text: `### Recent consequences & risks\n${lines}${footer}` }
      }

      if (subcommand === 'risk') {
        const highRisk = consequences.highRiskActions()
        if (highRisk.length === 0) return { kind: 'success', text: 'No high-risk actions detected in this session.' }
        const lines = highRisk.map(r =>
          `- **${r.action}** [${r.assessment.riskLevel.toUpperCase()}] (Blast: ${r.assessment.blastRadius}) — ${r.assessment.warnings.join(', ')}`,
        ).join('\n')
        return { kind: 'success', text: `### High-risk actions detected\n${lines}` }
      }

      return { kind: 'error', text: 'Unknown subcommand. Usage: /worldstate [show | reset | set | facts | history | consequences | risk]' }
    },
  })

  // ---------- Tools: Model Interaction ----------
  ctx.tools.register(defineTool({
    name: 'world_model_predict',
    description: 'Computes in advance the consequences, risk level (low, medium, high, critical), and blast radius of an action before executing it.',
    parameters: {
      action: {
        type: 'string',
        description: 'Name of the tool or command to evaluate.',
      },
      argsJson: {
        type: 'string',
        description: 'Planned arguments as a JSON string (optional).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', required: true },
          riskLevel: { type: 'string', required: true },
          blastRadius: { type: 'string', required: true },
          reversible: { type: 'boolean', required: true },
          warnings: { type: 'array', required: true, items: { type: 'string' } },
          predictedEffects: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                target: { type: 'string', required: true },
                kind: { type: 'string', required: true },
                description: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Action: ${value.action} | Risk: ${value.riskLevel} | Blast: ${value.blastRadius} | Reversible: ${value.reversible}\nEffects: ${value.predictedEffects.map(e => `${e.kind}:${e.target}`).join(', ')}`,
      }],
    },
    execute: (args: { action: string; argsJson?: string }) => {
      let parsedArgs: Record<string, unknown> = {}
      if (args.argsJson) {
        let parsed: unknown
        try {
          parsed = JSON.parse(args.argsJson)
        } catch (error: unknown) {
          throw new Error(`world_model_predict: argsJson is not valid JSON (${String(error)})`)
        }
        // Understating risk on malformed arguments would be worse than failing
        // the call: the model retries with valid JSON.
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('world_model_predict: argsJson must be a JSON object of tool arguments')
        }
        parsedArgs = parsed as Record<string, unknown>
      }
      const record = consequences.predict(args.action, parsedArgs)
      return Promise.resolve({
        action: record.action,
        riskLevel: record.assessment.riskLevel,
        blastRadius: record.assessment.blastRadius,
        reversible: record.assessment.reversible,
        warnings: record.assessment.warnings,
        predictedEffects: record.predictedEffects,
      })
    },
  }))

  // 2. world_model_query
  ctx.tools.register(defineTool({
    name: 'world_model_query',
    description: 'Queries the persistent world-model state, saved facts, and environment rules.',
    parameters: {
      queryType: {
        type: 'string',
        enum: ['facts', 'history', 'rules', 'telemetry'],
        description: 'The kind of information to read.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          queryType: { type: 'string', required: true },
          content: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.content,
      }],
    },
    execute: (args: { queryType: 'facts' | 'history' | 'rules' | 'telemetry' }, exec: ToolRunContext) => {
      if (args.queryType === 'rules') {
        return Promise.resolve({ queryType: 'rules', content: envRules.describeEnvironment() })
      }
      if (args.queryType === 'telemetry') {
        return Promise.resolve({ queryType: 'telemetry', content: JSON.stringify(envRules.getTelemetry(), null, 2) })
      }
      const store = getStateStore(cwdOf(exec.agent?.session.header.cwd))
      /* v8 ignore start -- the queryType enum is closed and the tool-argument validator rejects unknown members before execute. */
      switch (args.queryType) {
        case 'facts':
          return Promise.resolve({ queryType: 'facts', content: JSON.stringify(store.getAllFacts(), null, 2) })
        default:
          return Promise.resolve({ queryType: 'history', content: JSON.stringify(store.snapshot.taskHistory.slice(-10), null, 2) })
      }
      /* v8 ignore stop */
    },
  }))

  // 3. world_model_save_fact
  ctx.tools.register(defineTool({
    name: 'world_model_save_fact',
    description: 'Permanently records an important fact or a learned rule in the project\'s persistent world state.',
    parameters: {
      key: {
        type: 'string',
        description: 'Identifier key of the fact (e.g. "preferred_runner", "build_command").',
      },
      valueJson: {
        type: 'string',
        description: 'Value to record, as JSON or plain text.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          key: { type: 'string', required: true },
          saved: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.message,
      }],
    },
    execute: (args: { key: string; valueJson: string }, exec: ToolRunContext) => {
      const store = getStateStore(cwdOf(exec.agent?.session.header.cwd))
      if (exec.agent !== undefined) store.setSession(exec.agent.session.header.id)
      let value: unknown = args.valueJson
      try { value = JSON.parse(args.valueJson) } catch {
        // Plain-text values are part of the tool contract: an unparseable
        // valueJson is stored verbatim, not an error.
      }
      store.setFact(args.key, value)
      store.flush()
      return Promise.resolve({ key: args.key, saved: true, message: `Fact "${args.key}" saved to the persistent world state.` })
    },
  }))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Render one validation-finding section, or nothing when the list is empty. */
function renderFindings(label: string, items: readonly string[]): string {
  if (items.length === 0) return ''
  return `- **${label}**:\n${items.map(item => `  - ${item}`).join('\n')}\n`
}

/**
 * Render the post-execution comparison as an agent-visible notice.
 *
 * Called only for surprises (failure, divergence) and confirmed high-risk
 * successes, so a routine matched success never injects a message.
 */
function consequenceFeedback(
  exec: ToolExecution,
  record: ConsequenceRecord,
  result: Readonly<ToolExecutionResult>,
): UserMessage {
  const lines: string[] = []
  if (result.isError) {
    lines.push(`[${exec.name}] settled failure — predicted ${record.assessment.riskLevel} risk. Error: ${result.error.message}`)
  } else if (record.status === 'diverged') {
    lines.push(`[${exec.name}] settled success but diverged from the prediction: ${record.divergenceReason}`)
  } else {
    lines.push(`[${exec.name}] succeeded — the predicted ${record.assessment.riskLevel} risk effects occurred`)
  }
  for (const effect of record.predictedEffects) {
    lines.push(`- ${effect.kind} ${effect.target}: ${effect.description}`)
  }
  if (record.assessment.warnings.length > 0) {
    lines.push(`- warnings: ${record.assessment.warnings.join('; ')}`)
  }
  return createUserMessage({
    content: [{ type: 'text', text: lines.join('\n') }],
    source: { ...PLUGIN_SOURCE, form: 'notice', summary: `${exec.name} ${result.isError ? 'failure' : 'risk notice'}` },
  })
}
