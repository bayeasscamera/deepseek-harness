/**
 * Brave-backed `WebSearchProvider` plugin. It contributes to the `ctx.web`
 * registry without owning the service.
 *
 * @module @deepseek-ai/dsh-web-search-brave
 */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import { BraveSearchProvider, BRAVE_DEFAULT_BASE_URL } from './provider.ts'

export { BRAVE_DEFAULT_BASE_URL, BRAVE_PROVIDER_ID, BraveSearchProvider } from './provider.ts'
export type { BraveSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-brave'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Brave API key (`X-Subscription-Token`). Falls back to `$BRAVE_API_KEY`. Empty → provider unavailable. */
  apiKey?: string
  /** Endpoint base; `/web/search` is appended. Defaults to the public API. */
  baseURL?: string
  /** Default result count when a request carries no `maxResults`. Omitted = none. */
  numResults?: number
  /** Optional country bias sent as Brave's `country`. Omitted = none. */
  country?: string
  /** Optional search language sent as Brave's `search_lang`. Omitted = none. */
  searchLang?: string
}

export const Config: z<Config> = z.object({
  apiKey: z.string(),
  baseURL: z.string(),
  numResults: z.number().step(1).min(1),
  country: z.string(),
  searchLang: z.string(),
})

/** Register the Brave search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(
    new BraveSearchProvider({
      // Every environment layer may name this key: the product trusts the
      // project it is launched in, and the managed store is not involved here.
      apiKey: config.apiKey ?? launchEnvironmentOf(ctx).get('BRAVE_API_KEY')?.value ?? '',
      baseURL: config.baseURL ?? BRAVE_DEFAULT_BASE_URL,
      ...(config.numResults !== undefined ? { numResults: config.numResults } : {}),
      ...(config.country !== undefined ? { country: config.country } : {}),
      ...(config.searchLang !== undefined ? { searchLang: config.searchLang } : {}),
    }),
  )
}
