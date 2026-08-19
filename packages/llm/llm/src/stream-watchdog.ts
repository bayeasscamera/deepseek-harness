/**
 * One shared stream-lifecycle loop for every LLM adapter. Each adapter owns
 * its own connection facts, request body, and chunk translation; what was
 * duplicated across `dsh-llm-deepseek` and `dsh-llm-pi-ai` was the idle-
 * watchdog demand loop, the in-loop timeout probe, and the iterator teardown.
 * This module owns that loop and classifies watchdog expiry in one place.
 *
 * The in-loop {@link timeoutOf} probe is load-bearing, not redundant: the two
 * adapters' transports react to the fused abort signal differently. A
 * DeepSeek body read *throws* when the watchdog aborts it, so the adapter's
 * `catch` classifies it. The pi-ai SDK instead converts the abort into an
 * `aborted` finish *chunk* and returns normally, so without the probe the
 * loop would yield that chunk and finish as `ABORTED` instead of `TIMEOUT`.
 * Probing after every demand — before honoring `done` or the value — makes
 * both transports classify a watchdog expiry the same way.
 *
 * @module @deepseek-ai/dsh-llm/stream-watchdog
 */

import { type IdleWatchdog, timeoutOf } from '@deepseek-ai/dsh-timeout'

/**
 * Run one adapter stream through a rearmable idle watchdog. The watchdog and
 * its stable signal are created by the adapter (it needs the signal to build
 * the request), so ownership stays with the caller; this helper only drives
 * the demand loop and tears the iterator down on exit.
 *
 * @param watchdog - the adapter's rearmable watchdog, fused with caller cancellation.
 * @param watchdogCode - capability-owned code stamped on the watchdog's timeout reason; used to
 *   distinguish this watchdog's expiry from a nested upstream deadline.
 * @param iterator - the adapter's chunk iterator; the watchdog arms around each outstanding demand.
 */
export interface WatchdogStreamOptions<T> {
  readonly watchdog: IdleWatchdog
  readonly watchdogCode: string
  readonly iterator: AsyncIterator<T>
}

/**
 * Drive one iterator through the watchdog, re-arming on every demand. After
 * each demand the watchdog is probed: if it fired, its {@link timeoutOf}
 * reason is thrown so the adapter's `catch` maps it to a `TIMEOUT` failure,
 * regardless of whether the transport threw or returned an abort-shaped chunk.
 * Otherwise values yield until the iterator reports `done`; on any other exit
 * the iterator is returned to so its underlying transport can release its
 * resources.
 *
 * @param options - the adapter's watchdog, its timeout code, and the chunk iterator to drive.
 * @returns the iterator's values until exhaustion; never swallows a failure.
 */
export async function* watchdogStream<T>(options: WatchdogStreamOptions<T>): AsyncGenerator<T> {
  const { watchdog, watchdogCode, iterator } = options
  let exhausted = false
  try {
    while (true) {
      const result = await watchdog.next(iterator)
      const idle = timeoutOf(watchdog.signal, watchdogCode)
      if (idle !== undefined) throw idle
      if (result.done) {
        exhausted = true
        return
      }
      yield result.value
    }
  } finally {
    // The consumer controller (owned by the adapter) already owns termination;
    // a return-time abort cannot add a second outcome.
    if (!exhausted && iterator.return !== undefined) {
      try {
        await iterator.return()
      } catch (_teardown) {
        // Intentionally empty: the consumer controller owns stream termination.
      }
    }
  }
}
