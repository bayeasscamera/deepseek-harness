# Agent Note: a standalone formatter cannot own this repository's style

Status: rejected — the reformat introduced 7469 `oxlint` errors, and one of the four conflicting rules cannot be satisfied by any formatter configuration

English | [中文](2026-09-30-standalone-formatter-contradicts-stylistic-rules.zh.md)

## Problem

2915 of the repository's 3664 TypeScript/TSX files were not machine-formatted. Style was carried entirely by the `@stylistic` rules in [`.oxlintrc.json`](../../../../.oxlintrc.json) plus hand-maintained discipline, so no tool could reformat a file without risking a lint error. `oxfmt` 0.71.0 was installed and evaluated: it is the formatter of the same oxc project as the pinned `oxlint` 1.76.0, so one vendor would own both halves of the toolchain.

## Proposal

Install `oxfmt` with a configuration measured from the tree rather than guessed — `printWidth` 100 (p90 = 82, p99 = 129, 3 % over 100), `semi: false`, `singleQuote`, `trailingComma: all`, `arrowParens: "avoid"` (784 parenthesised against 2791 bare single-parameter samples) — exclude generator-owned artifacts, and gate a ratchet that fails when the unformatted-file count rises.

## Alternatives considered

**Kept the `@stylistic` rules as the formatter of record.** The repository already owns formatting, and `pnpm run lint:fix` (`oxlint --fix`) already rewrites the fixable subset in place.

**Adopt `oxfmt` and delete the four conflicting rules**, accepting one authority. This is a repository-wide style change, not a reformat: `requireForBlockBody` would add parentheses to roughly 3000 block-bodied arrow functions. It is the right answer only if the goal is to replace the linter's formatting rules, which is a convention decision rather than a tooling one.

**Keep `oxfmt` as an opt-in, non-enforcing tool.** Rejected because the two authorities disagree by construction, and running the advertised `format` command produces a tree that fails `lint`. An opt-in tool that breaks the gate is a trap, not a convenience.

## Consequences

The reformat produced 7469 new `oxlint` errors: 4450 `indent`, 3013 `arrow-parens`, 5 `comma-dangle`, 1 `semi`. One conflict is not reachable by configuration at all — [`arrow-parens`](../../../../.oxlintrc.json) carries `requireForBlockBody: true`, which requires `(x) => { … }`, and `oxfmt` exposes only `always` and `avoid`, so the dominant repository style conflicts with the rule on every block-bodied arrow. `indent` disagrees on continuation-line layout in constructs the formatter decides itself.

The measured drift therefore stands: 2915 unformatted files, with `pnpm run lint:fix` as the only mechanism that reduces it. `pnpm run format` is not a script this repository has.
