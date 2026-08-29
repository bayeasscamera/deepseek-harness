/**
 * Persisted agent-state contracts: predicted-action intentions, settled
 * observations, and per-tool rolling statistics.
 *
 * @module @deepseek-ai/dsh-agent-state/types
 */

/** Risk classification of one tool action. */
export type ActionRisk = 'read-only' | 'reversible' | 'irreversible'

/** One consequence predicted before an action runs. */
export interface PredictedConsequence {
  /** Short machine-readable effect tag, e.g. writes-file, spawns-process. */
  readonly effect: string
  /** Human-readable one-line explanation of the effect. */
  readonly detail: string
}

/** The full predicted outlook for one tool call. */
export interface ActionPrediction {
  /** Risk classification after inspecting the tool and its arguments. */
  readonly risk: ActionRisk
  /** Predicted consequences, most significant first; empty when read-only. */
  readonly consequences: readonly PredictedConsequence[]
  /** Targets the action may mutate (file paths, commands), for later diffing. */
  readonly targets: readonly string[]
  /** Whether the tool's own convention makes undo impossible (rm -f, truncate). */
  readonly reversibleByConvention: boolean
}

/** One settled action outcome compared against its prediction. */
export interface ActionObservation {
  /** Stable id, also the consolidation key. */
  readonly id: string
  /** Tool name that ran. */
  readonly tool: string
  /** Outcome shape of the settled result. */
  readonly outcome: 'success' | 'failure'
  /** Whether the settled result matched the predicted risk class. */
  readonly matchedPrediction: boolean
  /** Notable unexpected effects worth remembering, empty when none. */
  readonly unexpected: readonly string[]
  /** One-lesson summary for the durable store. */
  readonly lesson: string
  /** Wall-clock time in milliseconds since the epoch. */
  readonly at: number
}

/** Rolling per-tool statistics persisted across sessions. */
export interface ToolStat {
  /** Tool name the row tracks. */
  readonly tool: string
  /** Settled successes counted. */
  successes: number
  /** Settled failures (isError results, denies included) counted. */
  failures: number
  /** Distinct lessons kept for this tool, most recent first. */
  lessons: string[]
}

/** The durable store shape persisted as one JSON object per line. */
export interface PersistedState {
  /** Store format revision, bumped on incompatible changes. */
  readonly version: 1
  /** Per-tool rolling statistics, one row per tool. */
  tools: Record<string, ToolStat>
  /** Most recent observations, newest first, bounded by the store. */
  observations: ActionObservation[]
}
