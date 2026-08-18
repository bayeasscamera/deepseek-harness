/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-permission-rules`.
 * @module @deepseek-ai/dsh-permission-rules/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-permission-rules'

/** Cordis companion plugin name. */
export const name = 'permission-rules-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this plugin intercepts `tools/pre-execute` and short-circuits
 * early on rule matches; the tool pipeline owns which executions proceed.
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
