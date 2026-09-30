/**
 * `TavilySearchProvider`: a `WebSearchProvider` backed by the Tavily search API
 * (`POST /search`). The generated `answer` becomes `content`; sources prefer
 * structured `results[]` with `content` snippets mapped to `snippet` and
 * `published_date` mapped to `publishedAt`.
 * @module @deepseek-ai/dsh-web-search-tavily/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { TavilyError, TavilyResult, TavilySearchResponse } from './types.ts'

/** Stable id this provider registers under. */
export const TAVILY_PROVIDER_ID = 'tavily'

/** Default Tavily endpoint; `/search` is the operation. */
export const TAVILY_DEFAULT_BASE_URL = 'https://api.tavily.com'

/** Default retrieval depth sent as Tavily's `search_depth`. */
export const TAVILY_DEFAULT_SEARCH_DEPTH = 'basic'

/** Search depth values Tavily accepts. */
export type TavilySearchDepth = 'basic' | 'advanced' | 'fast' | 'ultra-fast'

/** Topic values Tavily accepts. */
export type TavilyTopic = 'general' | 'news' | 'finance'

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/** Resolved provider options (the plugin's `apply` supplies env-var and constant defaults). */
export interface TavilySearchProviderOptions {
  /** Tavily API key. Empty/absent makes the provider unavailable. */
  apiKey: string
  /** Endpoint base; `/search` is appended. */
  baseURL: string
  /** Default result count when a request carries no `maxResults`. Omitted = none. */
  numResults?: number
  /** Retrieval depth sent as Tavily's `search_depth`. */
  searchDepth: TavilySearchDepth
  /** Optional topic sent as Tavily's `topic`; omitted = no filter. */
  topic?: TavilyTopic
  /** Whether to request Tavily's LLM-generated `answer` as `content`. */
  includeAnswer: boolean
}

/**
 * Map one structured Tavily result to a normalized source.
 *
 * @param result - one entry of the response's `results[]`.
 * @returns the normalized source; blank fields are omitted rather than set empty.
 */
export function mapTavilyResult(result: TavilyResult): WebSearchSource {
  return {
    url: result.url,
    ...(result.title != null && result.title.length > 0 ? { title: result.title } : {}),
    ...(result.content != null && result.content.length > 0 ? { snippet: result.content } : {}),
    ...(result.published_date != null && result.published_date.length > 0
      ? { publishedAt: result.published_date }
      : {}),
  }
}

/**
 * Map a Tavily response envelope to a normalized search result. Prefers
 * structured `results[]`; the LLM-generated `answer` becomes `content` when
 * non-empty.
 *
 * @param response - the parsed search response body.
 * @returns the normalized result; `content` is omitted when the answer is empty.
 */
export function mapTavilyResponse(response: TavilySearchResponse): WebSearchResult {
  const answer = response.answer
  const sources: WebSearchSource[] = (response.results ?? []).map(mapTavilyResult)
  return {
    ...(answer != null && answer.length > 0 ? { content: answer } : {}),
    sources,
    truncated: false,
  }
}

/** The Tavily-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class TavilySearchProvider implements WebSearchProvider {
  readonly id = TAVILY_PROVIDER_ID

  constructor(private readonly options: TavilySearchProviderOptions) {}

  // Availability checks stay beside each provider's distinct config contract;
  // a shared base class would obscure which fields make this backend usable.
  /* jscpd:ignore-start */
  available(): boolean {
    return (
      this.options.apiKey.length > 0 &&
      URL.canParse(this.options.baseURL) &&
      (this.options.numResults === undefined || isPositiveInteger(this.options.numResults))
    )
  }
  /* jscpd:ignore-end */

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    // A per-request bound wins over the configured default; either may be absent.
    const maxResults = request.maxResults ?? this.options.numResults
    let response: Response
    // Dispatch mirrors the family's POST shape; the Tavily body stays
    // provider-local so failures keep naming Tavily.
    /* jscpd:ignore-start */
    try {
      response = await fetch(`${this.options.baseURL}/search`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify({
          api_key: this.options.apiKey,
          query: request.query,
          ...(maxResults !== undefined ? { max_results: maxResults } : {}),
          include_answer: this.options.includeAnswer,
          search_depth: this.options.searchDepth,
          ...(this.options.topic !== undefined ? { topic: this.options.topic } : {}),
        }),
        ...(signal !== undefined ? { signal } : {}),
      })
    } catch (error: unknown) {
      if (isAbortError(error))
        throw new WebError('Tavily search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Tavily search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', {
        cause: error,
      })
    }
    /* jscpd:ignore-end */

    if (!response.ok) {
      const status = response.status
      let message = `Tavily API error (HTTP ${status})`
      try {
        const parsed = (await response.json()) as TavilyError
        const detail =
          typeof parsed.detail === 'string'
            ? parsed.detail
            : (parsed.detail?.error ?? parsed.error ?? parsed.message)
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        // An abort fired mid-body must surface as WEB_ABORTED, not be swallowed
        // into a generic HTTP-error message — cancellation is not a provider
        // error (the seam's cancellation contract).
        if (isAbortError(error))
          throw new WebError('Tavily search aborted', 'WEB_ABORTED', { cause: error })
        // Otherwise: the HTTP status is already captured in `message` above; a
        // malformed/non-JSON error body (normal for gateway 5xx/429s) can only
        // cost a richer provider message, never the real error.
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      const payload = (await response.json()) as TavilySearchResponse
      return mapTavilyResponse(payload)
    } catch (error: unknown) {
      if (isAbortError(error))
        throw new WebError('Tavily search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(
        `Tavily returned an unprocessable response body: ${String(error)}`,
        'WEB_PROVIDER_ERROR',
        { cause: error },
      )
    }
  }
}

// These two predicates are intentionally local: exporting generic internals
// from the public web seam would add more API than these pure checks.
/* jscpd:ignore-start */
/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** True for a request limit that can be sent to Tavily (a positive whole number). */
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}
/* jscpd:ignore-end */
