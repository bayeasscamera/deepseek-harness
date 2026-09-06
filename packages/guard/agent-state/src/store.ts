/**
 * Durable per-workspace agent-state store: one JSON object per line, rewritten
 * atomically from the in-memory index on every mutation (the dsh-memory
 * derived-file pattern; the session log remains the source of truth for
 * model-visible events).
 *
 * @module @deepseek-ai/dsh-agent-state/store
 */

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ActionObservation, PersistedState } from './types.ts'

/** Retention limits applied when folding observations, overridable via plugin Config. */
export interface StoreLimits {
  /** Bounded observation history kept in the store. */
  maxObservations: number
  /** Distinct lessons retained per tool row. */
  maxLessonsPerTool: number
}

/** Fresh empty store. */
function emptyState(): PersistedState {
  return { version: 1, tools: {}, observations: [] }
}

/**
 * Derive the per-workspace store path from the harness home and the session
 * cwd: agents in different workspaces keep independent durable states.
 * @param cwd - the session working directory scoping the store.
 * @returns absolute path of the workspace's state file.
 */
export function storePathFor(cwd: string): string {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const key = createHash('sha256').update(cwd).digest('hex').slice(0, 16)
  return join(home, 'agent-state', key, 'state.jsonl')
}

/**
 * Parse the store file; a missing, empty, or corrupt file starts fresh
 * (the store is derived data, never a correctness boundary).
 * @param path - store file to read.
 * @returns the parsed state, or a fresh empty one.
 */
export function loadState(path: string): PersistedState {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return emptyState()
  }
  const state = emptyState()
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line) as Partial<PersistedState>
      if (row.version !== 1) continue
      if (row.tools !== undefined) {
        state.tools = row.tools
      }
      // Observation rows are written newest-first and each carries one
      // observation; concat preserves the persisted order instead of letting
      // the last row erase the history.
      if (Array.isArray(row.observations)) {
        state.observations = [...state.observations, ...row.observations]
      }
    } catch {
      // A torn or hand-edited line never blocks the agent; skip it.
    }
  }
  return state
}

/**
 * Serialize the state back as one JSON row per line, replacing the file
 * atomically: the payload lands in a sibling `.tmp` file and one `renameSync`
 * swaps it in, so a concurrent reader or a crash mid-write never observes a
 * torn store. The store is derived data; a lost final flush is acceptable, a
 * torn one is not.
 * @param path - store file to write.
 * @param state - the state to persist.
 */
export function saveState(path: string, state: PersistedState): void {
  mkdirSync(dirname(path), { recursive: true })
  const toolsRow = JSON.stringify({ version: 1, tools: state.tools })
  const observationRows = state.observations.map(observation => JSON.stringify({ version: 1, observations: [observation] }))
  const tmpPath = `${path}.tmp`
  try {
    writeFileSync(tmpPath, [toolsRow, ...observationRows].join('\n') + '\n')
    renameSync(tmpPath, path)
  } catch (err) {
    // The swap failed; drop the half-written temp file so the next save starts clean.
    try { unlinkSync(tmpPath) } catch { /* the temp file was never created or is already gone */ }
    throw err
  }
}

/**
 * Record one settled observation and advance the tool's rolling statistics.
 * @param state - the state to mutate (the caller persists afterwards).
 * @param observation - the settled outcome to fold in.
 * @param limits - retention caps trimming the observation history and per-tool lessons.
 */
export function recordObservation(state: PersistedState, observation: ActionObservation, limits: StoreLimits): void {
  state.observations = [observation, ...state.observations].slice(0, limits.maxObservations)
  const row = state.tools[observation.tool]
  if (row === undefined) {
    state.tools[observation.tool] = {
      tool: observation.tool,
      successes: observation.outcome === 'success' ? 1 : 0,
      failures: observation.outcome === 'failure' ? 1 : 0,
      lessons: observation.lesson === '' ? [] : [observation.lesson],
    }
    return
  }
  if (observation.outcome === 'success') row.successes += 1
  if (observation.outcome === 'failure') row.failures += 1
  if (observation.lesson !== '' && !row.lessons.includes(observation.lesson)) {
    row.lessons = [observation.lesson, ...row.lessons].slice(0, limits.maxLessonsPerTool)
  }
}
