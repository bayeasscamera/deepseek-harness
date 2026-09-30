/**
 * Tavily-backed `WebSearchProvider` plugin. It contributes to the `ctx.web`
 * registry without owning the service.
 *
 * @module @deepseek-ai/dsh-web-search-tavily
 */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import {
  TavilySearchProvider,
  TAVILY_DEFAULT_BASE_URL,
  TAVILY_DEFAULT_SEARCH_DEPTH,
} from './provider.ts'

export {
  TAVILY_DEFAULT_BASE_URL,
  TAVILY_DEFAULT_SEARCH_DEPTH,
  TAVILY_PROVIDER_ID,
  TavilySearchProvider,
} from './provider.ts'
export type { TavilySearchDepth, TavilySearchProviderOptions, TavilyTopic } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-tavily'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Tavily API key. Falls back to `$TAVILY_API_KEY`. Empty → provider unavailable. */
  apiKey?: string
  /** Endpoint base; `/search` is appended. Defaults to the public API. */
  baseURL?: string
  /** Default result count when a request carries no `maxResults`. Omitted = none. */
  numResults?: number
  /** Retrieval depth sent as Tavily's `search_depth`. Defaults to `basic`. */
  searchDepth?: 'basic' | 'advanced' | 'fast' | 'ultra-fast'
  /** Optional topic sent as Tavily's `topic`. Omitted = no filter. */
  topic?: 'general' | 'news' | 'finance'
  /** Whether to request Tavily's LLM-generated answer as `content`. Defaults to true. */
  includeAnswer?: boolean
}

export const Config: z<Config> = z.object({
  apiKey: z.string(),
  baseURL: z.string(),
  numResults: z.number().step(1).min(1),
  searchDepth: z.union(['basic', 'advanced', 'fast', 'ultra-fast'] as const),
  topic: z.union(['general', 'news', 'finance'] as const),
  includeAnswer: z.boolean(),
})

/** Register the Tavily search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(
    new TavilySearchProvider({
      // Every environment layer may name this key: the product trusts the
      // project it is launched in, and the managed store is not involved here.
      apiKey: config.apiKey ?? launchEnvironmentOf(ctx).get('TAVILY_API_KEY')?.value ?? '',
      baseURL: config.baseURL ?? TAVILY_DEFAULT_BASE_URL,
      ...(config.numResults !== undefined ? { numResults: config.numResults } : {}),
      searchDepth: config.searchDepth ?? TAVILY_DEFAULT_SEARCH_DEPTH,
      ...(config.topic !== undefined ? { topic: config.topic } : {}),
      includeAnswer: config.includeAnswer ?? true,
    }),
  )
}
