/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-prompt-budget`.
 * @module @deepseek-ai/dsh-prompt-budget/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-prompt-budget'

/** Cordis companion plugin name. */
export const name = 'prompt-budget-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this plugin observes the assembly waterfall and emits
 * a derived breakdown event; it owns no durable state, and the assembly it
 * prices is already validated by the system-prompt invariant companion.
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
