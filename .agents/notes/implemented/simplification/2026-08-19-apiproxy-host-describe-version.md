# Agent Note: Report the real harness version from host.describe

Status: implemented

English | [中文](2026-08-19-apiproxy-host-describe-version.zh.md)

## Problem

`host.describe` in the API gateway returned a hardcoded `version: '0.0.1'` with a `TODO` to read the app's package.json. Every client that asks the host for its version (the web UI's about surface, diagnostics) saw a placeholder that never matched the running build.

## Decision

Thread the version through the existing `ApiProxyDefaults` resolve step instead of reaching into an app manifest:

- `ApiProxyDefaults` gains an optional `version?: string`.
- The gateway plugin (`ApiProxyService`) supplies it via a `readVersion()` that reads this package's own checked-in `package.json`. Every workspace package shares the monorepo version, so this equals the app version without a packages→apps dependency or an app-manifest read. The relative hop (`../package.json`) resolves identically from the source tree (`src/`) and the bundled artifact (`lib/`), mirroring `apps/cli`'s existing `readVersion()`.
- `createApiProxy` resolves `defaults.version ?? '0.0.0'` at its top (the explicit resolve step), so test harnesses that omit the field keep working and fall back to a sentinel.

## Alternatives considered

Read `apps/cli/package.json` from the gateway. Rejected: that inverts the layering (a `packages/host` package depending on an app's manifest) and breaks non-CLI carriers that mount the same gateway.

Make `version` required on `ApiProxyDefaults`. Rejected: it would force edits across ~20 test call sites for a value tests never assert; the convention-sanctioned default belongs in the owning implementation's resolve step, not hidden in `host.describe`.

## Consequences

- `host.describe` now reports the actual monorepo version; the `TODO` placeholder is gone.
- The other `0.0.1` literals in the repo (MCP client name, SDK server info, ACP agent info, subagent-codex wire) are separate wire-protocol identity strings and are intentionally untouched.
- No model-visible or session-log behavior changed; only the gateway's self-description field.
