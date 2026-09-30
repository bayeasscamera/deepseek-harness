/**
 * Wire types for the Tavily search API (`POST {base}/search`). Types
 * only — no runtime code. Tavily returns a flat `results[]` plus an optional
 * LLM-generated `answer`; each entry carries a URL, optional title, optional
 * `content` snippet, and an optional `published_date` (news topics).
 *
 * @module @deepseek-ai/dsh-web-search-tavily/types
 */

/** Request body sent to Tavily's search endpoint. */
export interface TavilySearchRequest {
  api_key: string
  query: string
  max_results?: number
  include_answer?: boolean
  search_depth?: 'basic' | 'advanced' | 'fast' | 'ultra-fast'
  topic?: 'general' | 'news' | 'finance'
}

/** One entry of Tavily's flat `results[]`. */
export interface TavilyResult {
  url: string
  title?: string | null
  content?: string | null
  published_date?: string | null
}

/** Tavily's search response envelope. */
export interface TavilySearchResponse {
  answer?: string | null
  results?: TavilyResult[]
}

/** Tavily's error response envelope (best-effort; fields vary by failure). */
export interface TavilyError {
  detail?: string | { error?: string } | null
  error?: string
  message?: string
}
