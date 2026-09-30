# Respond in French

English | [中文](french.zh.md)

This guide makes the app speak French end to end: the interface through the built-in French language pack, and the agent's replies through a French preset you own. The shipped presets stay untouched — you duplicate one and make the copy yours, so upgrades never overwrite your language choice.

## Interface in French

Open **Settings → General** and select **Français**. The whole interface switches immediately, including the preset names, and the choice persists across restarts. A browser that already prefers French selects it automatically before any stored choice arrives.

If the interface still shows another language afterwards, your stored preference names it explicitly: change it once in Settings → General and it stays.

## Replies in French

Duplicate the preset you use — **Settings → Agent presets → Standard mode → Duplicate** — and give the copy the identifier `francais`. Open its directory (`Preset files:` shows the path, under `<dshHome>/.agent-presets/francais`) and edit the two files below.

`preset.yml` names your copy:

```yaml
name: Mode Français
description: Agent de code complet qui répond toujours en français.
order: 1
```

In `agent.cordis.yml`, append the language rule to the persona `prefix` (keep the first line as is):

```yaml
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    suffix: Your working directory is {{cwd}}.
    prefix: >-
      You are a coding agent powered by the {{model}} model.
      You always respond to the user in French. All your prose — answers, explanations, summaries, questions, todo items, commit messages, plans — is written in French. Never respond in Chinese or any other language. Code, file paths, identifiers, commands, URLs, and quoted tool output stay verbatim; only your own words are French.
```

Give the same rule to delegated children so subagents answer in French too. On the `tool-subagent` and `tool-subagent-fork` rows of the same file, add:

```yaml
      config:
        provider: spawn
        toolName: subagent
        backgroundMode: continuable
        persona: You always respond to the user in French. Never respond in Chinese or any other language.
```

Then select your copy for new sessions — **Set as default**, or pick it per session in the new-session preset seat. A session can switch presets only before it has produced anything, so start fresh sessions on the French preset.

## What stays verbatim

Quoted evidence is never translated: `web_search` source snippets, file contents, error strings, commands, and code remain exactly as the world produced them, and the agent cites them as such. Session titles follow the conversation language. These are citations, not the agent answering in another language.
