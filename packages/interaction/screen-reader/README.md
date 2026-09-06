# @deepseek-ai/dsh-screen-reader

English | [中文](README.zh.md)

An accessibility plugin that formats session events as a clean, linear, semantic text stream tailored for VoiceOver, braille displays, and other assistive technologies — no ANSI escape codes, no animated spinners, no multi-column widgets. Provides a `/screenreader` command to toggle the mode and its verbosity at runtime.

## Config

```yaml
- id: screen-reader
  name: '@deepseek-ai/dsh-screen-reader'
```

No plugin-level configuration fields. Accessibility mode starts disabled and must be activated via `/screenreader on`.

## Behavior

- `/screenreader on` — enables linear accessibility output for this session.
- `/screenreader off` — disables it; standard rendering resumes.
- `/screenreader verbose | standard | concise` — sets the narrative detail level (default `standard`).
- `/screenreader` (no argument) — reports the current state and verbosity.
- `stripAnsiAndDecorations(text)` — exported utility that strips ANSI codes and Unicode box-drawing characters from any string.
- `formatLinearEvent(type, content, verbosity)` — pure formatter for a turn event (`user`, `agent`, `tool`, `error`): `concise` collapses to one labelled line, `standard` announces the label then the full content, `verbose` adds an explicit end-of-event marker. Labels are English.

## Model Experience

### Accessibility mode event formatting

#### What the model sees

Event payloads passed through `formatLinearEvent` appear as labelled plain-text blocks (`[User message]`, `[Assistant response]`, …) stripped of all ANSI decoration. The model receives the same semantic content in normalized linear form.

#### Token effect

Negligible change — ANSI sequences removed, content preserved. Verbose mode adds one end-marker line per event.

#### KV Cache effect

Content structure is unchanged; cache reuse is unaffected by accessibility-mode toggling between turns.

## Known Limitations and Deferred Work

- **Command-only toggle** — accessibility mode persists for the session duration but is not saved across sessions; users must re-enable it each session.
- **No terminal-renderer integration** — the plugin exposes the formatter and the toggle, but no renderer consumes them yet; wiring `formatLinearEvent` into the terminal output pipeline is deferred work.
