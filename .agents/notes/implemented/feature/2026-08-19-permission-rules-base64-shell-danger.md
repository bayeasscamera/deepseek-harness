# Agent Note: Detect decode-and-execute obfuscation in the permission-rules danger linter

Status: implemented

English | [中文](2026-08-19-permission-rules-base64-shell-danger.zh.md)

## Problem

The `dsh-permission-rules` danger linter flags `curl | sh` and `wget | sh` as remote-execution hazards, but the same class with an encoding step in front — piping a decoded payload into a shell (`base64 -d | sh`, `base64 --decode | bash`) — passed the heuristic. An obfuscated download-and-run command would reach the model's `allow` path without the `ask` upgrade the linter exists to provide.

## Decision

Add one pattern to `DANGER_PATTERNS`: `/\bbase64\b.*\|\s*(ba|z)?sh\b/`. It matches `base64` anywhere in the command followed by a pipe into `sh`/`bash`/`zsh`, covering both `base64 -d` and `base64 --decode` forms. The heuristic only upgrades a decision to `ask` (never silently denies), so the user still approves.

## Alternatives considered

Also flag `rm -f` without `-r` and broad variable-expansion (`$(...)`/backticks). Rejected: the existing test deliberately pins `rm -f foo.txt` as safe (single-file force-delete is ordinary work), and flagging command substitution would produce false positives on ubiquitous legitimate commands (`echo $(date)`, `$(git rev-parse HEAD)`). The bounded, high-signal addition is the decode-and-execute pipe.

## Consequences

- `base64 ... | sh/bash/zsh` now upgrades to `ask`; plain encode/decode for data work (`base64 -d file > out`, `cat file | base64`) stays safe and is pinned by tests.
- One new test covers the positive and negative cases; the existing 2 tests pass unchanged.
