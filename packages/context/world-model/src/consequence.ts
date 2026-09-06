/**
 * Consequence engine: predicts the effects, risk level, blast radius,
 * and reversibility of actions before execution, then reconciles predictions
 * against actual outcomes.
 *
 * Capabilities:
 * 1. **Multi-dimensional prediction**: side effects, risk severity, blast radius, reversibility.
 * 2. **Destructive command detection**: flags irreversible shell operations.
 * 3. **Critical config awareness**: detects changes to package manifests and tsconfigs.
 * 4. **Post-execution reconciliation & anomaly detection**: tracks deviations and failure modes.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The kind of side-effect an action can produce. */
export type EffectKind = 'create' | 'modify' | 'delete' | 'read' | 'state-change' | 'network'

/** Risk assessment level for an action. */
export type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical'

/** Estimated radius of affected entities. */
export type BlastRadius = 'isolated' | 'file' | 'package' | 'workspace' | 'system'

/** One predicted or observed side-effect of an action. */
export interface Effect {
  /** Target resource, e.g. `"file:/path/to/foo.ts"` or `"system:shell"`. */
  readonly target: string
  /** What happens to the target. */
  readonly kind: EffectKind
  /** Human-readable explanation. */
  readonly description: string
}

/** Risk and impact assessment profile. */
export interface ImpactAssessment {
  /** Overall risk level. */
  readonly riskLevel: RiskLevel
  /** Estimated blast radius. */
  readonly blastRadius: BlastRadius
  /** Whether the operation is easily reversible without data loss. */
  readonly reversible: boolean
  /** Any safety warnings or preconditions. */
  readonly warnings: string[]
}

/** Reconciliation status after execution. */
export type ConsequenceStatus = 'pending' | 'confirmed' | 'diverged' | 'failed'

/** Full consequence record for one tool execution. */
export interface ConsequenceRecord {
  /** Monotonic sequential ID assigned at prediction time. */
  readonly taskId: string
  /** Name of the tool or command that was executed. */
  readonly action: string
  /** Arguments passed to the tool. */
  readonly args: Readonly<Record<string, unknown>>
  /** Impact and risk assessment profile. */
  readonly assessment: ImpactAssessment
  /** Effects predicted BEFORE execution. */
  predictedEffects: Effect[]
  /** Effects observed AFTER execution. */
  actualEffects: Effect[]
  /** Error message if execution failed. */
  error?: string
  /** ISO 8601 timestamp. */
  readonly timestamp: string
  /** Execution duration in ms (if measured). */
  durationMs?: number
  /** Current reconciliation status. */
  status: ConsequenceStatus
  /** Explanation of divergence if predicted != actual. */
  divergenceReason?: string
}

// ---------------------------------------------------------------------------
// Heuristics: Destructive commands & critical configs
// ---------------------------------------------------------------------------

/**
 * File paths whose mutation carries outsized blast radius. Fixed heuristic
 * content, not deployment tunables: the set encodes repo-convention config
 * files (package manifests, tsconfigs, cordis composition, lockfiles, agent
 * instructions, env files) and only changes with those conventions.
 */
const CRITICAL_FILE_PATTERNS = [
  /package\.json$/,
  /tsconfig.*\.json$/,
  /cordis\.ya?ml$/,
  /\.env(\..+)?$/,
  /pnpm-lock\.yaml$/,
  /AGENTS\.md$/,
]

/**
 * Shell command fragments that make an execution irreversible. Fixed heuristic
 * content, not deployment tunables: the fragments name destructive operations
 * (recursive deletion, history rewrite, disk tooling, forced process kill,
 * build-output clean) independent of any deployment.
 */
const DESTRUCTIVE_SHELL_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+|--recursive)/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-[a-zA-Z]*f/,
  /\b(mkfs|dd|fdisk|parted)\b/,
  /\bkill\s+-9\b/,
  /\bpnpm\s+run\s+clean\b/,
]

// ---------------------------------------------------------------------------
// Prediction heuristics
// ---------------------------------------------------------------------------

interface PredictionRule {
  match: RegExp
  assess: (args: Record<string, unknown>) => {
    effects: Effect[]
    assessment: ImpactAssessment
  }
}

const toStr = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : fallback

/**
 * Narrow parsed tool JSON arguments to the record shape the rules read. A
 * non-object payload (a raw string survives invalid-JSON parsing) carries no
 * named arguments.
 */
function toArgs(args: unknown): Record<string, unknown> {
  return typeof args === 'object' && args !== null && !Array.isArray(args)
    ? args as Record<string, unknown>
    : {}
}

/** Rule-specific risk profile for one file-mutation prediction. */
interface FileMutationProfile {
  /** Effect description rendered from the target path. */
  readonly describe: (targetPath: string) => string
  /** Risk level as a function of criticality of the target file. */
  readonly riskLevel: (isCritical: boolean) => RiskLevel
  /** Blast radius as a function of criticality of the target file. */
  readonly blastRadius: (isCritical: boolean) => BlastRadius
  /** Whether the mutation is reversible without data loss. */
  readonly reversible: boolean
  /** Warnings rendered from the target path and its criticality. */
  readonly warnings: (targetPath: string, isCritical: boolean) => readonly string[]
}

/**
 * Shared assessment for the file write/edit/delete rules: extract the target
 * path, test it against the critical-config patterns, and assemble the single
 * file effect with the rule-specific risk profile.
 */
function assessFileMutation(
  args: Record<string, unknown>,
  kind: Extract<EffectKind, 'create' | 'modify' | 'delete'>,
  profile: FileMutationProfile,
): { effects: Effect[]; assessment: ImpactAssessment } {
  const targetPath = toStr(args['path'] ?? args['TargetFile'] ?? args['target'], 'unknown')
  const isCritical = CRITICAL_FILE_PATTERNS.some(pattern => pattern.test(targetPath))
  return {
    effects: [{
      target: `file:${targetPath}`,
      kind,
      description: profile.describe(targetPath),
    }],
    assessment: {
      riskLevel: profile.riskLevel(isCritical),
      blastRadius: profile.blastRadius(isCritical),
      reversible: profile.reversible,
      warnings: [...profile.warnings(targetPath, isCritical)],
    },
  }
}

const RULES: ReadonlyArray<PredictionRule> = [
  // 1. File write/create
  {
    match: /^(write_to_file|write_file|create_file)$/,
    assess: args => assessFileMutation(args, 'create', {
      describe: targetPath => `Creates or overwrites the file \`${targetPath}\`.`,
      riskLevel: isCritical => isCritical ? 'high' : 'low',
      blastRadius: isCritical => isCritical ? 'workspace' : 'file',
      reversible: true,
      warnings: (targetPath, isCritical) => isCritical ? [`Modifies a critical configuration file: ${targetPath}`] : [],
    }),
  },
  // 2. File edit/replace
  {
    match: /^(replace_file_content|edit_file|patch_file)$/,
    assess: args => assessFileMutation(args, 'modify', {
      describe: targetPath => `Modifies the content of the file \`${targetPath}\`.`,
      riskLevel: isCritical => isCritical ? 'high' : 'low',
      blastRadius: isCritical => isCritical ? 'package' : 'file',
      reversible: true,
      warnings: (targetPath, isCritical) => isCritical ? [`Modifies a sensitive configuration file: ${targetPath}`] : [],
    }),
  },
  // 3. File deletion
  {
    match: /^(delete_file|remove_file|unlink)$/,
    assess: args => assessFileMutation(args, 'delete', {
      describe: targetPath => `Permanently deletes the file \`${targetPath}\`.`,
      riskLevel: isCritical => isCritical ? 'critical' : 'high',
      blastRadius: isCritical => isCritical ? 'workspace' : 'file',
      reversible: false,
      warnings: () => ['Irreversible deletion with no version-control safety net'],
    }),
  },
  // 4. File read / view
  {
    match: /^(read_file|view_file|cat)$/,
    assess: (args) => {
      const targetPath = toStr(args['path'] ?? args['AbsolutePath'] ?? args['target'], 'unknown')
      return {
        effects: [{
          target: `file:${targetPath}`,
          kind: 'read',
          description: `Reads the file \`${targetPath}\` without altering it.`,
        }],
        assessment: {
          riskLevel: 'none',
          blastRadius: 'isolated',
          reversible: true,
          warnings: [],
        },
      }
    },
  },
  // 5. Shell command execution
  {
    match: /^(run_command|bash|shell|exec)$/,
    assess: (args) => {
      const cmd = toStr(args['CommandLine'] ?? args['command'] ?? args['cmd'])
      const isDestructive = DESTRUCTIVE_SHELL_PATTERNS.some(p => p.test(cmd))
      return {
        effects: [{
          target: 'system:shell',
          kind: 'state-change',
          description: `Executes \`${cmd.slice(0, 80)}${cmd.length > 80 ? '...' : ''}\`.`,
        }],
        assessment: {
          riskLevel: isDestructive ? 'critical' : 'medium',
          blastRadius: isDestructive ? 'workspace' : 'system',
          reversible: !isDestructive,
          warnings: isDestructive ? [`Potentially destructive command detected: ${cmd}`] : [],
        },
      }
    },
  },
  // 6. Network / Web fetch
  {
    match: /^(search_web|web_fetch|read_url|read_url_content)$/,
    assess: (args) => {
      const url = toStr(args['Url'] ?? args['url'] ?? args['query'])
      return {
        effects: [{
          target: `network:${url.slice(0, 60)}`,
          kind: 'network',
          description: 'Read-only external request.',
        }],
        assessment: {
          riskLevel: 'none',
          blastRadius: 'isolated',
          reversible: true,
          warnings: [],
        },
      }
    },
  },
  // 7. Search & Discovery
  {
    match: /^(grep_search|find_by_name|list_dir|glob)$/,
    assess: (_args) => {
      return {
        effects: [{
          target: 'filesystem:search',
          kind: 'read',
          description: 'Read-only filesystem traversal.',
        }],
        assessment: {
          riskLevel: 'none',
          blastRadius: 'isolated',
          reversible: true,
          warnings: [],
        },
      }
    },
  },
]

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

let nextTaskId = 1

/** The consequence engine — tracks predictions, risk evaluations, and reconciliations. */
export class ConsequenceEngine {
  readonly #records: ConsequenceRecord[] = []
  readonly #capacity: number

  /** Default maximum number of consequence records held in memory. */
  static readonly DEFAULT_CAPACITY = 100

  constructor(options?: { capacity?: number }) {
    this.#capacity = options?.capacity ?? ConsequenceEngine.DEFAULT_CAPACITY
  }

  /**
   * Predict the effects and risk of a tool execution BEFORE it runs.
   * @param action - tool or action name to evaluate.
   * @param args - payload arguments passed to the action (any lossless JSON).
   * @returns pending consequence record with risk assessment.
   */
  predict(action: string, args: unknown): ConsequenceRecord {
    const ruleArgs = toArgs(args)
    let predicted: Effect[] = []
    let assessment: ImpactAssessment = {
      riskLevel: 'low',
      blastRadius: 'file',
      reversible: true,
      warnings: [],
    }

    for (const rule of RULES) {
      if (rule.match.test(action)) {
        const res = rule.assess(ruleArgs)
        predicted = res.effects
        assessment = res.assessment
        break
      }
    }

    if (predicted.length === 0) {
      predicted = [{
        target: `tool:${action}`,
        kind: 'state-change',
        description: `Execution of the generic tool "${action}".`,
      }]
    }

    const record: ConsequenceRecord = {
      taskId: String(nextTaskId++),
      action,
      args: structuredClone(ruleArgs),
      assessment,
      predictedEffects: predicted,
      actualEffects: [],
      timestamp: new Date().toISOString(),
      status: 'pending',
    }

    this.#records.push(record)
    if (this.#records.length > this.#capacity) {
      this.#records.splice(0, this.#records.length - this.#capacity)
    }

    return record
  }

  /**
   * Reconcile a pending record with the actual observed effects and outcome.
   * @param record - pending consequence record to reconcile.
   * @param actualEffects - real effects observed after execution.
   * @param options - execution metadata including error message or duration.
   */
  reconcile(
    record: ConsequenceRecord,
    actualEffects: Effect[],
    options?: { error?: string | undefined; durationMs?: number | undefined },
  ): void {
    record.actualEffects = actualEffects
    if (options?.durationMs !== undefined) record.durationMs = options.durationMs

    if (options?.error) {
      record.status = 'failed'
      record.error = options.error
      record.divergenceReason = `Execution failed: ${options.error}`
      return
    }

    const predictedKeys = new Set(record.predictedEffects.map(e => `${e.target}:${e.kind}`))
    const actualKeys = new Set(actualEffects.map(e => `${e.target}:${e.kind}`))

    let match = true
    const missing: string[] = []
    for (const pk of predictedKeys) {
      if (!actualKeys.has(pk)) {
        match = false
        missing.push(pk)
      }
    }

    if (match) {
      record.status = 'confirmed'
    } else {
      record.status = 'diverged'
      record.divergenceReason = `Actual effects differ from the prediction (missing: ${missing.join(', ')})`
    }
  }

  /**
   * Infer actual effects from a tool execution result.
   * @param action - executed action name.
   * @param args - payload arguments passed to the action (any lossless JSON).
   * @param success - whether execution succeeded.
   * @returns list of inferred effects.
   */
  inferActualEffects(action: string, args: unknown, success: boolean): Effect[] {
    if (!success) {
      return [{
        target: `tool:${action}`,
        kind: 'state-change',
        description: `The tool "${action}" failed; no effects were applied.`,
      }]
    }

    const ruleArgs = toArgs(args)
    for (const rule of RULES) {
      if (rule.match.test(action)) {
        return rule.assess(ruleArgs).effects
      }
    }

    return [{
      target: `tool:${action}`,
      kind: 'state-change',
      description: `The tool "${action}" completed successfully.`,
    }]
  }

  /**
   * Return all recorded consequence records.
   * @returns array of all tracked consequence records.
   */
  history(): readonly ConsequenceRecord[] {
    return this.#records
  }

  /**
   * Return records where predictions did not match reality.
   * @returns array of diverged or failed records.
   */
  divergences(): readonly ConsequenceRecord[] {
    return this.#records.filter(r => r.status === 'diverged' || r.status === 'failed')
  }

  /**
   * Return high-risk or critical records.
   * @returns array of high-risk or critical consequence records.
   */
  highRiskActions(): readonly ConsequenceRecord[] {
    return this.#records.filter(r => r.assessment.riskLevel === 'high' || r.assessment.riskLevel === 'critical')
  }

  /**
   * Return the last N records.
   * @param n - number of recent records to retrieve.
   * @returns slice of recent consequence records.
   */
  recent(n = 10): readonly ConsequenceRecord[] {
    return this.#records.slice(-n)
  }
}
