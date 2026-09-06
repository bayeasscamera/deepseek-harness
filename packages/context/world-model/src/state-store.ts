/**
 * Persistent world state store. Reads and writes `.dsh/world-state.json`
 * inside the session workspace.
 *
 * Robustness guarantees:
 * 1. **Atomic writes**: writes to a temporary file and atomically renames it
 *    to prevent partial/corrupted writes on crash.
 * 2. **Automatic backup & recovery**: maintains `.dsh/world-state.json.bak` and
 *    recovers automatically if the primary state file is corrupt.
 * 3. **Debounced flushing**: groups rapid consecutive mutations into a single disk sync.
 * 4. **Fail-loud schema versioning**: a file written by a newer schema is
 *    rejected instead of silently downgraded; malformed version-1 fields are repaired.
 *
 * @module
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Branded } from '@deepseek-ai/dsh-brand'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Opaque session id recorded in the world state. Same brand as the dsh-session
 * `SessionId`: values minted there flow in without a cast; a raw string does not.
 */
export type WorldSessionId = Branded<'SessionId'>

/** A single completed task recorded in the history ring. */
export interface TaskRecord {
  /** Opaque identifier for the task (tool name or command). */
  readonly action: string
  /** ISO 8601 timestamp of when the task finished. */
  readonly timestamp: string
  /** Short human-readable outcome. */
  readonly outcome: string
  /** Whether the action completed successfully. */
  readonly success: boolean
  /** Duration of the task in milliseconds (optional). */
  readonly durationMs?: number | undefined
}

/** The full world state persisted to disk. */
export interface WorldState {
  /**
   * On-disk schema version, stamped from {@link WORLD_STATE_SCHEMA_VERSION}.
   * A store refuses to load a file whose version exceeds the build's own
   * (see the constant); version-1 files with malformed fields are repaired.
   */
  readonly version: 1
  /** ISO 8601 timestamp of the last write. */
  lastUpdated: string
  /** ID of the last active session (informational). */
  sessionId: WorldSessionId
  /** Total number of successful flushes in store lifetime. */
  writeCount: number
  /** IDs of environment rules currently marked active. */
  activeRuleIds: string[]
  /**
   * Ring buffer of the most recent task records.
   * Oldest record is evicted when the buffer exceeds capacity.
   */
  taskHistory: TaskRecord[]
  /** Arbitrary agent-set key/value facts (serialisable values only). */
  customFacts: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Current on-disk schema version. Bump on any structural change a future
 * reader could misread; load rejects newer files with a clear error rather
 * than silently downgrading them (the session-persistence fail-loud pattern).
 */
export const WORLD_STATE_SCHEMA_VERSION = 1

const DEFAULT_HISTORY_CAP = 50

/** Debounce window coalescing rapid mutations into one disk write.
 * Fixed heuristic: it trades disk churn against crash-window size the same way in every deployment. */
const DEBOUNCE_MS = 500

const STATE_FILE = '.dsh/world-state.json'
const BACKUP_EXT = '.bak'

/**
 * Return a clean, valid default WorldState.
 */
function emptyState(): WorldState {
  return {
    version: WORLD_STATE_SCHEMA_VERSION,
    lastUpdated: new Date().toISOString(),
    sessionId: '' as WorldSessionId,
    writeCount: 0,
    activeRuleIds: [],
    taskHistory: [],
    customFacts: {},
  }
}

// ---------------------------------------------------------------------------
// StateStore
// ---------------------------------------------------------------------------

/** Manages reading, mutating, and atomic debounced persistence of the world state. */
export class StateStore {
  #state: WorldState
  #stateFile: string
  #backupFile: string
  #historyCap: number
  #flushTimer: ReturnType<typeof setTimeout> | undefined = undefined

  constructor(cwd: string, options?: { historyCap?: number }) {
    this.#stateFile = join(cwd, STATE_FILE)
    this.#backupFile = this.#stateFile + BACKUP_EXT
    this.#historyCap = options?.historyCap ?? DEFAULT_HISTORY_CAP
    this.#state = this.#loadWithRecovery()
  }

  // -------------------------------------------------------------------------
  // Public accessors
  // -------------------------------------------------------------------------

  /** Snapshot of the current state (isolated deep clone). */
  get snapshot(): WorldState {
    return structuredClone(this.#state)
  }

  /** Absolute path to the active state file on disk. */
  get filePath(): string {
    return this.#stateFile
  }

  /**
   * Set the active session ID.
   * @param sessionId - unique session identifier.
   */
  setSession(sessionId: WorldSessionId): void {
    this.#state.sessionId = sessionId
    this.#scheduleFlush()
  }

  /**
   * Overwrite the set of active rule IDs.
   * @param ids - active rule identifiers.
   */
  setActiveRuleIds(ids: string[]): void {
    this.#state.activeRuleIds = [...ids]
    this.#scheduleFlush()
  }

  /**
   * Append a completed task to the history ring.
   * The oldest record is evicted when the buffer exceeds history capacity.
   * @param record - executed task details and outcome.
   */
  recordTask(record: TaskRecord): void {
    this.#state.taskHistory.push(record)
    if (this.#state.taskHistory.length > this.#historyCap) {
      this.#state.taskHistory.splice(0, this.#state.taskHistory.length - this.#historyCap)
    }
    this.#scheduleFlush()
  }

  /**
   * Set a custom fact. Pass `undefined` to delete the key.
   * @param key - unique key identifier.
   * @param value - payload value or undefined to remove.
   */
  setFact(key: string, value: unknown): void {
    if (value === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete this.#state.customFacts[key]
    } else {
      this.#state.customFacts[key] = value
    }
    this.#scheduleFlush()
  }

  /**
   * Read a custom fact.
   * @param key - unique key identifier.
   * @returns stored value or undefined if not found.
   */
  getFact(key: string): unknown {
    return this.#state.customFacts[key]
  }

  /**
   * Return all custom facts.
   * @returns shallow copy of all custom facts.
   */
  getAllFacts(): Readonly<Record<string, unknown>> {
    return structuredClone(this.#state.customFacts)
  }

  /** Clear all custom facts. */
  clearFacts(): void {
    this.#state.customFacts = {}
    this.#scheduleFlush()
  }

  /** Reset state to empty (keeps the file path). */
  reset(): void {
    this.#state = emptyState()
    this.#scheduleFlush()
  }

  /** Reload state from disk (useful after external process modifications). */
  reload(): void {
    this.#clearTimer()
    this.#state = this.#loadWithRecovery()
  }

  /** Force an immediate atomic flush to disk, bypassing the debounce. */
  flush(): void {
    this.#clearTimer()
    this.#atomicWrite()
  }

  // -------------------------------------------------------------------------
  // Private helpers: Atomic write & recovery
  // -------------------------------------------------------------------------

  /**
   * Load the state file, falling back to backup file if corrupted,
   * or repairing the schema with default fields if malformed.
   */
  #loadWithRecovery(): WorldState {
    const primary = this.#tryReadFile(this.#stateFile)
    if (primary !== null) return this.#sanitizeState(primary)

    const backup = this.#tryReadFile(this.#backupFile)
    if (backup !== null) return this.#sanitizeState(backup)

    return emptyState()
  }

  /**
   * Safely attempt to read and parse a JSON state file.
   */
  #tryReadFile(filePath: string): Record<string, unknown> | null {
    if (!existsSync(filePath)) return null
    try {
      const raw = readFileSync(filePath, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // Corrupt or unreadable JSON on the durable/state-recovery boundary:
      // the caller falls back to the backup file, then to an empty state.
    }
    return null
  }

  /**
   * Version gate plus self-healing validation: a file from a NEWER schema
   * fails loud instead of being silently downgraded; version-1 files have
   * every required property checked and repaired to a valid default.
   */
  #sanitizeState(data: Record<string, unknown>): WorldState {
    const version = data['version']
    if (typeof version === 'number' && version > WORLD_STATE_SCHEMA_VERSION) {
      throw new Error(`world state file at "${this.#stateFile}" has schema version ${version}, incompatible with this build (${WORLD_STATE_SCHEMA_VERSION})`)
    }

    const fresh = emptyState()
    return {
      version: WORLD_STATE_SCHEMA_VERSION,
      lastUpdated: typeof data['lastUpdated'] === 'string' ? data['lastUpdated'] : fresh.lastUpdated,
      sessionId: typeof data['sessionId'] === 'string' ? data['sessionId'] as WorldSessionId : fresh.sessionId,
      writeCount: typeof data['writeCount'] === 'number' ? data['writeCount'] : 0,
      activeRuleIds: Array.isArray(data['activeRuleIds'])
        ? data['activeRuleIds'].filter((id): id is string => typeof id === 'string')
        : [],
      taskHistory: Array.isArray(data['taskHistory'])
        ? data['taskHistory'].filter((item): item is TaskRecord =>
          item !== null && typeof item === 'object' && typeof (item as TaskRecord).action === 'string',
        )
        : [],
      customFacts: data['customFacts'] !== null && typeof data['customFacts'] === 'object' && !Array.isArray(data['customFacts'])
        ? (data['customFacts'] as Record<string, unknown>)
        : {},
    }
  }

  /**
   * Performs an atomic write:
   * 1. Writes payload to `.tmp` file in target directory.
   * 2. Backs up current state to `.bak` if existing.
   * 3. Renames `.tmp` to target file atomically.
   */
  #atomicWrite(): void {
    this.#state.lastUpdated = new Date().toISOString()
    this.#state.writeCount = this.#state.writeCount + 1

    const dir = dirname(this.#stateFile)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const tmpFile = `${this.#stateFile}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
    const content = JSON.stringify(this.#state, null, 2) + '\n'

    try {
      // 1. Write to temp file
      writeFileSync(tmpFile, content, 'utf8')

      // 2. Backup existing valid state file before replacement
      if (existsSync(this.#stateFile)) {
        try {
          writeFileSync(this.#backupFile, readFileSync(this.#stateFile, 'utf8'), 'utf8')
        } catch {
          // Backup refresh is best-effort: the previous `.bak` (or none) remains
          // and the primary write below must not be blocked by a backup failure.
        }
      }

      // 3. Atomic rename
      renameSync(tmpFile, this.#stateFile)
    } catch (err) {
      // Clean up tmpFile on failure
      if (existsSync(tmpFile)) {
        try { unlinkSync(tmpFile) } catch {
          // Orphaned temp file: the original write error is rethrown below and
          // nothing else can act on a temp-file unlink failure.
        }
      }
      throw err
    }
  }

  #scheduleFlush(): void {
    this.#clearTimer()
    this.#flushTimer = setTimeout(() => {
      try {
        this.#atomicWrite()
      } catch {
        // Debounced-flush failure: a timer callback has no caller to receive
        // the error; the in-memory state stays authoritative and the next
        // mutation reschedules the write.
      }
    }, DEBOUNCE_MS)
  }

  #clearTimer(): void {
    if (this.#flushTimer !== undefined) {
      clearTimeout(this.#flushTimer)
      this.#flushTimer = undefined
    }
  }
}
