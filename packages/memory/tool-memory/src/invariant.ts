/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-memory`.
 * @module @deepseek-ai/dsh-tool-memory/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-memory'

/** Cordis companion plugin name. */
export const name = 'tool-memory-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: every mutation this tool drives is a logged tool call
 * validated at the registry's schema boundary, and the memory service owns the
 * durable store; there is no separate event stream this package observes.
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
