---
description: "The Tavily-backed search provider for ctx.web: how deployments mount vendor-native web search with an LLM answer plus portable snippets."
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-tavily

English | [中文](README.zh.md)

## Summary

With `dsh-web-search-tavily`, the harness searches the web through Tavily and gets a vendor-native LLM answer plus citeable sources with portable snippets. Choose it when a deployment has a Tavily API key and wants Tavily's relevance-ranked results with an optional generated answer. The answer becomes `content`; each hit maps `content` to `snippet` and `published_date` to `publishedAt`. The model-facing `web_search` tool lives in `dsh-tool-web`, and it works unchanged in native, `ptc`, and `both` tool presentations because the tools registry owns the PTC transport.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the provider in a composition that already loads the web service; it registers as the `tavily` search provider, so `ctx.web.search()` resolves it automatically when it is the only usable search backend — or pin it with `searchProvider: tavily`.

### When to choose it

Choose this backend when a deployment holds a Tavily API key and wants relevance-ranked results with an optional LLM answer. The provider is unavailable — and every search call fails with a structured error — when the key is empty or the endpoint base does not parse.

### Minimal configuration

Load the web service and the provider; the API key falls back to `$TAVILY_API_KEY` from the launch environment, and all other settings have safe defaults. Leave `apiKey` empty and export the key yourself — the provider stays unavailable until you supply one.

```yaml
- name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: tavily
- name: '@deepseek-ai/dsh-web-search-tavily'
  config:
    apiKey: !!js process.env.TAVILY_API_KEY
```

| Field | Default | Meaning |
|---|---|---|
| `apiKey` | `$TAVILY_API_KEY` | Tavily API key; empty or absent makes the provider unavailable |
| `baseURL` | `https://api.tavily.com` | Endpoint base; `/search` is appended. An unparseable value makes the provider unavailable |
| `numResults` | (unset) | Default result count when a request carries no `maxResults`; must be a positive integer |
| `searchDepth` | `basic` | Retrieval depth sent as Tavily's `search_depth`: `basic`, `advanced`, `fast`, or `ultra-fast` |
| `topic` | (unset) | Optional topic sent as Tavily's `topic`: `general`, `news`, or `finance` |
| `includeAnswer` | `true` | Whether to request Tavily's LLM-generated answer as `content` |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-web-search-tavily) is the exhaustive source for every accepted field and its JSDoc.

### What a search returns

Each Tavily hit maps to a `WebSearchSource`: `url`, `title`, the hit `content` as `snippet`, and `published_date` as `publishedAt`; blank fields are omitted, so a bare hit can be URL-only. A request's `maxResults` wins over the configured `numResults` default and is sent to Tavily as `max_results` — the final bound is enforced by the service, which truncates and flags. The LLM-generated `answer` becomes `content` when non-empty.

### Failures and recovery

Provider failures — HTTP errors, network failures, unparseable or wrong-shape bodies — surface as `WebError` `WEB_PROVIDER_ERROR`; an aborted request surfaces as `WEB_ABORTED`. HTTP redirects are rejected before the `Location` target is contacted and surface as `WEB_PROVIDER_ERROR`. Callers route on the code; the model-facing `web_search` tool surfaces failures to the model under its own error wrapper.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the provider; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The provider is a thin adapter over Tavily's API with one deliberate rule:

- **No invented answers.** `content` comes only from Tavily's `answer`; when it is empty the field is omitted rather than fabricating provider prose the model might trust.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, environment fallback, provider registration |
| [`src/provider.ts`](src/provider.ts) | The `TavilySearchProvider`: request dispatch, abort classification, result mapping |
| [`src/types.ts`](src/types.ts) | Tavily wire types: `TavilySearchResponse`, `TavilyResult`, `TavilyError` |
| — | No runtime invariant companion is published; this package exposes no independent event sequence or mutable data relation beyond contracts enforced at its owning seam. |

### Request and mapping flow

`search()` posts the query, `max_results`, `include_answer`, `search_depth`, and optional `topic` to `{baseURL}/search` (with the key in both the `api_key` body field and a `Bearer` header) with `redirect: 'error'`, so a redirect fails the request without contacting the target. The parsed `results[]` are mapped one by one, and the service applies the final `maxResults` bound on the way back. An abort — a `DOMException` named `AbortError` — becomes `WEB_ABORTED`; anything else becomes `WEB_PROVIDER_ERROR`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shared vocabulary to the service, the model-facing tools, and the design rationale.

- [Web subsystem](../../../docs/subsystems/web.md) — the exhaustive search request/result vocabulary and error codes.
- [Web package map](../README.md) — the family and each role.
- [dsh-web](../web/README.md) — the web service this provider registers into.
- [dsh-tool-web](../tool-web/README.md) — the model-facing `web_search` tool that renders this provider's sources (native and PTC mode alike).
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-web-search-tavily) — every accepted config field and its source declaration.
- [Web capability seam decision](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md) — why search and fetch share one provider-selection service.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-web`, which retains this provider's `maxResults`-bounded answer, URLs, titles, contents, and publication dates or its exact `Tavily search aborted`, `Tavily search request failed: <error>`, and `Tavily returned an unprocessable response body: <error>` failures under the consumer's error wrapper.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the provider is a poor fit. They are current package constraints.

- **There is no batch-wide native-search counter** — the tool's `searchMaxQueries` bounds `ctx.web.search` calls, but Tavily performs its own retrieval per call; deployments control cost through the consumer and provider settings because the service does not know provider-internal units.
- **Only `numResults`/`searchDepth`/`topic`/`includeAnswer` are exposed** — Tavily's other controls (time range, date bounds, domain include/exclude, raw content, images, favicons) wait on provider-neutral service fields ([seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md)).
- **Abort classification is error-shape-based** — only a `DOMException` named `AbortError` maps to `WEB_ABORTED`; an abort carrying a custom reason (such as `dsh-timeout`'s `TimeoutReason`) surfaces as `WEB_PROVIDER_ERROR`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The provider registers a search source into the web service and exposes no independent event sequence or mutable data relation beyond contracts enforced at its owning seam.
