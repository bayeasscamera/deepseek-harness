# Agent Note: Prune unused SDK client server-request plumbing

Status: implemented

English | [中文](2026-08-18-prune-sdk-client-server-request-plumbing.zh.md)

## Problem

The Python `HarnessClient` (`python/sdk/src/deepseek_harness/client.py`) carried server-request machinery it never used: the `IncomingRequest` model, the `next_request()`, `respond()`, and `respond_error()` methods, the `notify()` method, and the `_requests` queue. The runtime protocol is directional — the client sends `initialize`, `session/prompt`, and `shutdown` requests and receives responses and notifications; the server never originates a request the client must answer, and the client never originates a notification. That half duplicated the server's request/response path without a caller, enlarging the public surface and the regression matrix.

## Decision

Remove the unused server-request and client-notification surface from the Python client. Delete `IncomingRequest` (`models.py`), the `_requests` queue, and the `notify()`, `next_request()`, `respond()`, and `respond_error()` methods. The reader loop's inbound-request branch becomes an explicit guard that drops server-originated request frames instead of enqueuing them; `_fail_waiters` no longer pushes to the removed queue. `HarnessClient` and `HarnessConfig` keep their shipped contract, and `session_prompt` still returns the queued `messageId`.

## Alternatives considered

Keep the symmetric peer for a possible future server-originated request (for example interactive permissions). No typed method or production caller exists, and the pre-release client can add the smallest required direction when that feature is designed instead of carrying dormant machinery. The TypeScript `HarnessClient` already uses only its directional half, so this keeps the two SDK twins consistent.

## Consequences

- `IncomingRequest`, `notify`, `next_request`, `respond`, and `respond_error` have no caller in `python/sdk` or its tests.
- The client still answers `initialize`/`session/prompt`/`shutdown` and fans server notifications out to subscribers.
- `python/sdk/tests/test_client.py` passes; the removed-helper tests were rewritten to drive notifications through `_handle_message` directly (preserving `broken_filter` error-handling coverage) or removed.
- `packages/sdk/client/tests/fake-runtime.ts` no longer documents a `session.finished` emission that production never sends; its doc describes the `turn/end` reason (`FAKE_REASON_KIND`) it actually emits.

## Risks

None for shipped behavior: the removed methods had no production caller. The stale `make-jsonrpc-directional` Agent Note, which assumed a `session.finished` + `{ accepted: true }` protocol, is archived as obsolete — production already returns an immediate `{ messageId }` receipt and streams events asynchronously.
