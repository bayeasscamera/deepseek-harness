/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-auto-continue`.
 * @module @deepseek-ai/dsh-auto-continue/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-auto-continue'

/** Cordis companion plugin name. */
export const name = 'auto-continue-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the guard owns rate-limit recovery inside the
 * `agent/request-error` waterfall and keeps its per-agent budget in the
 * context service; it appends no durable session events, so there is no log
 * stream to validate.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
