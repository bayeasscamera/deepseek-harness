---
description: "The Brave-backed search provider for ctx.web: how deployments mount vendor-native web search with portable snippets and publication dates."
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-brave

English | [中文](README.zh.md)

## Summary

With `dsh-web-search-brave`, the harness searches the web through Brave and gets vendor-native results with portable snippets and publication dates. Choose it when a deployment has a Brave API key and wants Brave's web index. Brave returns no generated answer, so results carry no `content` — only citeable sources. A result with neither a `description` nor a non-blank `extra_snippets[]` entry is dropped, so a call can return fewer sources than requested. The model-facing `web_search` tool lives in `dsh-tool-web`, and it works unchanged in native, `ptc`, and `both` tool presentations because the tools registry owns the PTC transport.

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

Mount the provider in a composition that already loads the web service; it registers as the `brave` search provider, so `ctx.web.search()` resolves it automatically when it is the only usable search backend — or pin it with `searchProvider: brave`.

### When to choose it

Choose this backend when a deployment holds a Brave API key and wants Brave's web index with per-result snippets. The provider is unavailable — and every search call fails with a structured error — when the key is empty or the endpoint base does not parse.

### Minimal configuration

Load the web service and the provider; the API key falls back to `$BRAVE_API_KEY` from the launch environment, and all other settings have safe defaults. Leave `apiKey` empty and export the key yourself — the provider stays unavailable until you supply one.

```yaml
- name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: brave
- name: '@deepseek-ai/dsh-web-search-brave'
  config:
    apiKey: !!js process.env.BRAVE_API_KEY
```

| Field | Default | Meaning |
|---|---|---|
| `apiKey` | `$BRAVE_API_KEY` | Brave API key (`X-Subscription-Token`); empty or absent makes the provider unavailable |
| `baseURL` | `https://api.search.brave.com/res/v1` | Endpoint base; `/web/search` is appended. An unparseable value makes the provider unavailable |
| `numResults` | (unset) | Default result count when a request carries no `maxResults`; must be a positive integer |
| `country` | (unset) | Optional country bias sent as Brave's `country` |
| `searchLang` | (unset) | Optional search language sent as Brave's `search_lang` |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-web-search-brave) is the exhaustive source for every accepted field and its JSDoc.

### What a search returns

Each Brave hit maps to a `WebSearchSource`: `url`, `title`, the `description` (or the first non-blank `extra_snippets[]` entry) as `snippet`, and `page_age` as `publishedAt`; a hit with no usable snippet has no portable text and is dropped. A request's `maxResults` wins over the configured `numResults` default and is sent to Brave as `count` — the final bound is enforced by the service, which truncates and flags. Brave returns no generated answer, so the result carries no `content`.

### Failures and recovery

Provider failures — HTTP errors, network failures, unparseable or wrong-shape bodies — surface as `WebError` `WEB_PROVIDER_ERROR`; an aborted request surfaces as `WEB_ABORTED`. HTTP redirects are rejected before the `Location` target is contacted and surface as `WEB_PROVIDER_ERROR`. Callers route on the code; the model-facing `web_search` tool surfaces failures to the model under its own error wrapper.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the provider; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The provider is a thin adapter over Brave's API with two deliberate rules:

- **Portable snippets only.** A source gains a `snippet` only from a real `description` or `extra_snippets[]` entry; inventing one from other fields would make the seam lie, so snippet-less results are dropped entirely.
- **No invented answers.** Brave returns no generated answer, so `content` is omitted rather than fabricating provider prose the model might trust.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, environment fallback, provider registration |
| [`src/provider.ts`](src/provider.ts) | The `BraveSearchProvider`: request dispatch, abort classification, result mapping |
| [`src/types.ts`](src/types.ts) | Brave wire types: `BraveSearchResponse`, `BraveResult`, `BraveError` |
| — | No runtime invariant companion is published; this package exposes no independent event sequence or mutable data relation beyond contracts enforced at its owning seam. |

### Request and mapping flow

`search()` sends the query plus the optional `count`/`country`/`search_lang` parameters to `{baseURL}/web/search` as a `GET` with `redirect: 'error'`, so a redirect fails the request without contacting the target. The parsed `web.results[]` (with a flattened `results[]` fallback) are mapped one by one, snippet-less entries dropped, and the service applies the final `maxResults` bound on the way back. An abort — a `DOMException` named `AbortError` — becomes `WEB_ABORTED`; anything else becomes `WEB_PROVIDER_ERROR`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shared vocabulary to the service, the model-facing tools, and the design rationale.

- [Web subsystem](../../../docs/subsystems/web.md) — the exhaustive search request/result vocabulary and error codes.
- [Web package map](../README.md) — the family and each role.
- [dsh-web](../web/README.md) — the web service this provider registers into.
- [dsh-tool-web](../tool-web/README.md) — the model-facing `web_search` tool that renders this provider's sources (native and PTC mode alike).
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-web-search-brave) — every accepted config field and its source declaration.
- [Web capability seam decision](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md) — why search and fetch share one provider-selection service.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-web`, which retains this provider's `maxResults`-bounded URLs, titles, descriptions, and page ages or its exact `Brave search aborted`, `Brave search request failed: <error>`, and `Brave returned an unprocessable response body: <error>` failures under the consumer's error wrapper.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the provider is a poor fit. They are current package constraints.

- **A result with no usable snippet is dropped entirely** — there is no portable text to map, so fewer sources than requested can return.
- **Only `numResults`/`country`/`searchLang` are exposed** — Brave's other controls (freshness, safesearch, extra snippets flag, spellcheck, result filters) wait on provider-neutral service fields ([seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md)).
- **Abort classification is error-shape-based** — only a `DOMException` named `AbortError` maps to `WEB_ABORTED`; an abort carrying a custom reason (such as `dsh-timeout`'s `TimeoutReason`) surfaces as `WEB_PROVIDER_ERROR`.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The provider registers a search source into the web service and exposes no independent event sequence or mutable data relation beyond contracts enforced at its owning seam.
