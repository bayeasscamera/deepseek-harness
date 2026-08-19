# Agent Note: Wire the WIP rule packages into the invariant-companion and hygiene gates

Status: implemented

English | [中文](2026-08-19-wire-wip-rule-packages-hygiene.zh.md)

## Problem

Three packages committed as WIP (`0b6d88bc46`) failed `pnpm run hygiene`, blocking the whole gate at its first failing step. `verify-package-invariants` requires every package that ships an `invariant.ts` companion to declare `@deepseek-ai/dsh-invariants` as both a `workspace:^` peerDependency and devDependency and to reference `runtime-diagnostics/invariants` in its tsconfig; `dsh-context-rules` and `dsh-permission-rules` each carry an invariant companion but had neither declaration. `knip` additionally flagged three unused dependencies: `dsh-tools` in `context-rules`, `dsh-shell` in `permission-rules`, and `schemastery` in `prompt-budget`.

## Decision

Make each manifest match the package's actual imports:

- `dsh-context-rules`: add `dsh-invariants` peer+dev and the `runtime-diagnostics/invariants` tsconfig reference; drop the unused `dsh-llm` and `dsh-tools` peers (its source imports only `cordis`, `dsh-agent`, `dsh-system-prompt`, `schemastery`, and `dsh-invariants`).
- `dsh-permission-rules`: add `dsh-invariants` peer+dev and the tsconfig reference; drop the unused `dsh-agent` and `dsh-shell` peers (its source imports only `cordis`, `dsh-tools`, `schemastery`, and `dsh-invariants`).
- `dsh-prompt-budget`: drop the unused `schemastery` dependency and its tsconfig reference (the plugin has no `Config` schema and `apply` takes no config).

## Alternatives considered

Silence the gate with knip `ignoreDependencies` entries and leave the manifests as-is. Rejected: the flagged deps are genuinely unimported, so ignoring them would hide a real manifest/source mismatch instead of fixing it, and the repo convention is narrow justified exceptions, not blanket ignores for drift.

Delete the invariant companions from the two rule packages to escape the gate. Rejected: the companions are the package-owned invariant registration every sibling package carries; removing them would diverge from the invariant-companion convention rather than satisfy it.

## Consequences

- `pnpm run hygiene` now passes end-to-end (exit 0) instead of aborting at `knip`; the downstream sub-gates (`publint`, `constraints`, invariant companions, cordis-config, NodeNext, runtime closure, vendored links) all run and pass.
- The three manifests now describe exactly what their source imports; a future sync or dependency audit starts from a truthful baseline.
- No runtime behavior changed — the edits touch only `package.json` dependency sections and tsconfig `references`, plus a `pnpm install` to refresh the lockfile.
