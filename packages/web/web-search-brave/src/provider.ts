/**
 * `BraveSearchProvider`: a `WebSearchProvider` backed by the Brave Search API
 * (`GET /web/search` with `X-Subscription-Token`). It maps `description` (then
 * the first non-blank `extra_snippets[]` entry) to `snippet`, maps `page_age`
 * to `publishedAt`, drops entries without a snippet, and omits `content`
 * because Brave returns no generated answer.
 * @module @deepseek-ai/dsh-web-search-brave/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { BraveError, BraveResult, BraveSearchResponse } from './types.ts'

/** Stable id this provider registers under. */
export const BRAVE_PROVIDER_ID = 'brave'

/** Default Brave endpoint base; `/web/search` is the operation. */
export const BRAVE_DEFAULT_BASE_URL = 'https://api.search.brave.com/res/v1'

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/** Resolved provider options (the plugin's `apply` supplies env-var and constant defaults). */
export interface BraveSearchProviderOptions {
  /** Brave API key (the `X-Subscription-Token` value). Empty/absent makes the provider unavailable. */
  apiKey: string
  /** Endpoint base; `/web/search` is appended. */
  baseURL: string
  /** Default result count when a request carries no `maxResults`. Omitted = none. */
  numResults?: number
  /** Optional country bias sent as Brave's `country`. Omitted = none. */
  country?: string
  /** Optional search language sent as Brave's `search_lang`. Omitted = none. */
  searchLang?: string
}

/**
 * Map one Brave result to a normalized source, or `undefined` when it carries no
 * portable snippet (neither `description` nor `extra_snippets[]` has a non-blank
 * entry — the seam has no other field to derive a snippet from).
 *
 * @param result - one Brave web hit.
 * @returns the normalized source, or `undefined` when the entry has no
 *   non-blank snippet.
 */
export function mapBraveResult(result: BraveResult): WebSearchSource | undefined {
  const candidates = [result.description ?? undefined, ...(result.extra_snippets ?? [])]
  const snippet = candidates.find(
    candidate => candidate !== undefined && candidate.trim().length > 0,
  )
  if (snippet === undefined) return undefined
  return {
    url: result.url,
    ...(result.title != null && result.title.length > 0 ? { title: result.title } : {}),
    snippet,
    ...(result.page_age != null && result.page_age.length > 0
      ? { publishedAt: result.page_age }
      : {}),
  }
}

/**
 * Map a Brave response envelope to a normalized search result.
 *
 * @param response - the parsed `GET /web/search` response body.
 * @returns the normalized result; snippet-less entries are dropped
 *   ({@link mapBraveResult}).
 */
export function mapBraveResponse(response: BraveSearchResponse): WebSearchResult {
  const hits = response.web?.results ?? response.results ?? []
  const sources = (Array.isArray(hits) ? hits : [])
    .map(mapBraveResult)
    .filter((source): source is WebSearchSource => source !== undefined)
  // Brave returns no generated answer, so `content` is omitted. The web service owns the
  // final `maxResults` truncation, so this provider reports `truncated: false`.
  return { sources, truncated: false }
}

/**
 * Build the `GET /web/search` URL for one query.
 * @param baseURL - Endpoint base; `/web/search` is appended.
 * @param query - Search query text.
 * @param options - Provider options carrying the optional country and language parameters.
 * @param numResults - Requested result count, or undefined to send no `count`.
 * @returns the absolute search URL with its query parameters.
 */
export function braveSearchUrl(
  baseURL: string,
  query: string,
  options: BraveSearchProviderOptions,
  numResults: number | undefined,
): string {
  const params = new URLSearchParams({ q: query })
  if (numResults !== undefined) params.set('count', String(numResults))
  if (options.country !== undefined && options.country.length > 0)
    params.set('country', options.country)
  if (options.searchLang !== undefined && options.searchLang.length > 0)
    params.set('search_lang', options.searchLang)
  return `${baseURL}/web/search?${params.toString()}`
}

/** The Brave-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class BraveSearchProvider implements WebSearchProvider {
  readonly id = BRAVE_PROVIDER_ID

  constructor(private readonly options: BraveSearchProviderOptions) {}

  available(): boolean {
    return (
      this.options.apiKey.length > 0 &&
      isValidBaseUrl(this.options.baseURL) &&
      (this.options.numResults === undefined || isPositiveInteger(this.options.numResults))
    )
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    // A per-request bound wins over the configured default; either may be absent.
    const numResults = request.maxResults ?? this.options.numResults
    const url = braveSearchUrl(this.options.baseURL, request.query, this.options, numResults)
    let response: Response
    try {
      response = await fetch(url, {
        method: 'GET',
        redirect: 'error',
        headers: {
          'x-subscription-token': this.options.apiKey,
          accept: 'application/json',
          'user-agent': USER_AGENT,
        },
        ...(signal !== undefined ? { signal } : {}),
      })
    } catch (error: unknown) {
      if (isAbortError(error))
        throw new WebError('Brave search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Brave search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', {
        cause: error,
      })
    }

    if (!response.ok) {
      const status = response.status
      let message = `Brave API error (HTTP ${status})`
      try {
        const parsed = (await response.json()) as BraveError
        const detail =
          typeof parsed.error === 'string'
            ? parsed.error
            : (parsed.error?.message ?? parsed.message)
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        // An abort fired mid-body must surface as WEB_ABORTED, not be swallowed
        // into a generic HTTP-error message — cancellation is not a provider
        // error (the seam's cancellation contract).
        if (isAbortError(error))
          throw new WebError('Brave search aborted', 'WEB_ABORTED', { cause: error })
        // Otherwise: the HTTP status is already captured in `message` above; a
        // malformed/non-JSON error body (normal for gateway 5xx/429s) can only
        // cost a richer provider message, never the real error.
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    // Cancellation and body-parse handling mirror the family's seam contract
    // verbatim; shared helpers would obscure which provider a failure names.
    /* jscpd:ignore-start */
    try {
      const payload = (await response.json()) as BraveSearchResponse
      return mapBraveResponse(payload)
    } catch (error: unknown) {
      if (isAbortError(error))
        throw new WebError('Brave search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(
        `Brave returned an unprocessable response body: ${String(error)}`,
        'WEB_PROVIDER_ERROR',
        { cause: error },
      )
    }
  }
}

/** True when `baseURL` parses as an absolute URL (a cheap local config check). */
function isValidBaseUrl(baseURL: string): boolean {
  return URL.canParse(baseURL)
}

/** True for a request limit that can be sent to Brave (a positive whole number). */
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
/* jscpd:ignore-end */
