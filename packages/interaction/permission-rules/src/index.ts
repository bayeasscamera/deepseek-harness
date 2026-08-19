/**
 * Fine-grained tool permission rules, integrated natively in the
 * `tools/pre-execute` waterfall. Each {@link PermissionRule} is evaluated
 * synchronously against the tool name and, when the tool is `bash`, against
 * the command string. The first matching rule's decision wins; if no rule
 * matches the call falls through to the next waterfall listener.
 *
 * A separate heuristic linter (`dangerousCommandHeuristic`) examines bash
 * commands for well-known destructive patterns regardless of rules and can
 * upgrade an `allow` to an `ask` or a `deny`.
 *
 * @module @deepseek-ai/dsh-permission-rules
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

export const name = 'permission-rules'

// ---------------------------------------------------------------------------
// Danger heuristics — patterns that indicate a destructive or exfiltrating
// shell command that the user should confirm before running.
// ---------------------------------------------------------------------------

/** A set of well-known destructive shell patterns to detect in bash commands. */
const DANGER_PATTERNS: readonly RegExp[] = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive|--force)\b/,
  /\bgit\s+push\b.*--force(?:-with-lease)?\b/,
  /\b(curl|wget)\b.*\|\s*(ba)?sh\b/,
  // Decode-and-execute obfuscation: piping a decoded payload into a shell is
  // the same remote-execution class as `curl | sh`, just with an encoding step
  // in front of it.
  /\bbase64\b.*\|\s*(ba|z)?sh\b/,
  /\bchmod\s+-R\s+777\b/,
  /\bdd\s+.*of=\/dev\/(sd|hd|nvme|disk)/,
  />\s*\/dev\/(sd|hd|nvme|disk)/,
  /\bmkfs\b/,
  /\bpkill\s+-9\b.*init|pid\s+1\b/,
  /\bsudo\s+.*rm\s+.*-rf\b/,
]

/**
 * Test a shell command string against the danger heuristics.
 * @param command - raw bash command line to inspect.
 * @returns a human-readable reason when dangerous, or `undefined` when safe.
 */
export function dangerousCommandHeuristic(command: string): string | undefined {
  for (const pattern of DANGER_PATTERNS) {
    if (pattern.test(command)) {
      return `command matches a dangerous pattern (${pattern.source}); please confirm`
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Rule vocabulary
// ---------------------------------------------------------------------------

/**
 * One permission rule applied during `tools/pre-execute`.
 * Rules match by `toolPattern` and optionally by `commandPattern` for bash.
 */
export interface PermissionRule {
  /**
   * A JavaScript regex string matched against the tool name.
   * Use `'^bash$'` to target only bash calls.
   */
  toolPattern: string
  /**
   * When present, also matched against the command argument (bash only).
   * Only evaluated when `toolPattern` matches.
   */
  commandPattern?: string
  /** Decision to apply when this rule matches. */
  decision: 'allow' | 'deny' | 'ask'
  /** Human-readable reason surfaced on `deny` or `ask`. */
  reason?: string
}

/** Plugin config. */
export interface Config {
  /**
   * Ordered list of permission rules. The first matching rule wins; later rules
   * are ignored. Evaluated before the next waterfall listener.
   */
  rules?: PermissionRule[]
  /**
   * When `true` (default), bash commands are passed through the danger heuristic
   * linter even when no rule matched. A detected dangerous pattern upgrades the
   * decision to `ask` (never silently allows it).
   */
  dangerLinter?: boolean
}

export const Config: z<Config> = z.object({
  rules: z.array(z.object({
    toolPattern: z.string().required(),
    commandPattern: z.string(),
    decision: z.union(['allow', 'deny', 'ask']).required(),
    reason: z.string(),
  })),
  dangerLinter: z.boolean().default(true),
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the raw command string from a bash tool call's arguments.
 * @param args - parsed arguments object from a tool execution.
 * @returns the command string, or `undefined` when not extractable.
 */
function bashCommand(args: unknown): string | undefined {
  if (
    typeof args === 'object' && args !== null
    && 'command' in args && typeof (args as Record<string, unknown>).command === 'string'
  ) {
    return (args as Record<string, unknown>).command as string
  }
  return undefined
}

/**
 * Evaluate the ordered rule list against one tool execution.
 * @param exec - the pending tool execution.
 * @param rules - the ordered rule list.
 * @returns the matching rule's decision, or `undefined` when no rule matched.
 */
function matchRules(exec: ToolExecution, rules: readonly PermissionRule[]): {
  decision: 'allow' | 'deny' | 'ask'
  reason?: string
} | undefined {
  for (const rule of rules) {
    const toolRe = new RegExp(rule.toolPattern)
    if (!toolRe.test(exec.name)) continue
    if (rule.commandPattern !== undefined) {
      const cmd = bashCommand(exec.arguments)
      if (cmd === undefined) continue
      const cmdRe = new RegExp(rule.commandPattern)
      if (!cmdRe.test(cmd)) continue
    }
    return { decision: rule.decision, ...rule.reason !== undefined ? { reason: rule.reason } : {} }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export function apply(ctx: Context, config: Config): void {
  const rules = config.rules ?? []
  const dangerLinter = config.dangerLinter ?? true

  // Native integration: registered directly in the waterfall pipeline, not as
  // an external observer — this listener runs inside the same event dispatch as
  // the tool runtime and shares the live execution object.
  ctx.on('tools/pre-execute', async (exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> => {
    // 1. Evaluate ordered user-defined rules.
    const ruleMatch = matchRules(exec, rules)
    if (ruleMatch !== undefined) {
      const { decision, reason } = ruleMatch
      if (decision === 'deny') return { kind: 'deny', reason: reason ?? `tool "${exec.name}" denied by permission rule` }
      if (decision === 'ask') return { kind: 'ask', ...reason !== undefined ? { reason } : {} }
      // decision === 'allow': fall through to danger linter, then allow.
    }

    // 2. Danger heuristic linter for bash commands.
    if (dangerLinter && exec.name === 'bash') {
      const cmd = bashCommand(exec.arguments)
      if (cmd !== undefined) {
        const dangerReason = dangerousCommandHeuristic(cmd)
        if (dangerReason !== undefined) {
          // Upgrade to ask rather than silently deny: the user may still approve.
          return { kind: 'ask', reason: dangerReason }
        }
      }
    }

    // If a rule explicitly allowed, return allow directly (skip next listener).
    if (ruleMatch?.decision === 'allow') return { kind: 'allow' }

    // No rule matched and no danger detected: delegate to the next listener.
    return next()
  })
}
