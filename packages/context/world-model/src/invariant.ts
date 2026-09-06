/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-world-model`.
 * @module @deepseek-ai/dsh-world-model/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-world-model'

/** Cordis companion plugin name. */
export const name = 'world-model-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: world-model is private to its own plugin — its
 * `tools/pre-execute` and `tools/post-execute` consequence listeners write only
 * through its StateStore and ConsequenceEngine, and every model-visible
 * feedback arrives as an additionalContext the loop logs as a `user/message`,
 * so the session log stays the source of truth.
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
