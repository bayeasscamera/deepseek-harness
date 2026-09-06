/**
 * App-lifecycle tunables for the Electron shell. One home for the timing and
 * resource values the main process, the server manager, and the window agree
 * on; every entry is a deliberate choice, not an incidental literal.
 *
 * @module tunables
 */

/** Backend heap ceiling for the spawned `dsh web` child. */
export const SERVER_MAX_OLD_SPACE_MB = 4096

/** Deadline for the backend to report its URL before startup fails loud. */
export const SERVER_START_TIMEOUT_MS = 30_000

/** Grace window between SIGTERM and the SIGKILL escalation in `stop()`. */
export const STOP_GRACE_MS = 3_000

/** Delay before reloading the renderer after a renderer crash. */
export const RENDERER_RELOAD_DELAY_MS = 500

/** Per-attempt delay for the `did-fail-load` retry, scaled by attempt count. */
export const LOAD_RETRY_BASE_MS = 1_000

/** Retry budget for transient load failures before failing loud. */
export const LOAD_RETRY_MAX_ATTEMPTS = 5
