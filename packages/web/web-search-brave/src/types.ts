/**
 * Wire types for the Brave Search API (`GET {base}/web/search`). Types
 * only — no runtime code. Brave nests web hits under `web.results[]`; each
 * entry carries a URL, optional title, an optional `description` snippet,
 * optional `extra_snippets[]`, and an optional `page_age` date.
 *
 * @module @deepseek-ai/dsh-web-search-brave/types
 */

/** One Brave web hit. */
export interface BraveResult {
  url: string
  title?: string | null
  description?: string | null
  extra_snippets?: string[] | null
  page_age?: string | null
}

/** Brave's search response envelope (web hits nest under `web`). */
export interface BraveSearchResponse {
  web?: {
    results?: BraveResult[]
  } | null
  /** Lenient fallback: some proxies flatten the envelope to `results[]`. */
  results?: BraveResult[]
}

/** Brave's error response envelope (best-effort; fields vary by failure). */
export interface BraveError {
  error?: string | { message?: string } | null
  message?: string
}
