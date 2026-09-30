# 用法语回答

[English](french.md) | 中文

本指南让应用全程说法语：界面通过内置法语语言包，agent 的回复通过一个属于你的法语 preset。随附的 preset 保持不动——你复制一份并改成自己的，因此升级永远不会覆盖你的语言选择。

## 法语界面

打开**设置 → 常规**并选择 **Français**。整个界面会立即切换，包括 preset 名称，选择在重启后依然保留。偏好法语的浏览器会在已存选择到达之前自动选用它。

如果之后界面仍显示其他语言，说明已存偏好明确指定了它：在“设置 → 常规”中改一次即可保持。

## 法语回复

复制你使用的 preset——**设置 → Agent presets → Standard mode → Duplicate**——并给副本指定标识符 `francais`。打开它的目录（`Preset files:` 会显示路径，位于 `<dshHome>/.agent-presets/francais`），编辑下面两个文件。

`preset.yml` 为你的副本命名：

```yaml
name: Mode Français
description: Agent de code complet qui répond toujours en français.
order: 1
```

在 `agent.cordis.yml` 中，把语言规则追加到人设 `prefix`（首行保持不变）：

```yaml
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    suffix: Your working directory is {{cwd}}.
    prefix: >-
      You are a coding agent powered by the {{model}} model.
      You always respond to the user in French. All your prose — answers, explanations, summaries, questions, todo items, commit messages, plans — is written in French. Never respond in Chinese or any other language. Code, file paths, identifiers, commands, URLs, and quoted tool output stay verbatim; only your own words are French.
```

把同样的规则交给委派的子实体，让 subagent 也用法语回答。在同一文件的 `tool-subagent` 与 `tool-subagent-fork` 行上添加：

```yaml
      config:
        provider: spawn
        toolName: subagent
        backgroundMode: continuable
        persona: You always respond to the user in French. Never respond in Chinese or any other language.
```

然后让新会话使用你的副本——**Set as default**，或在新建会话的 preset 席位中逐个选择。会话只有在尚未产出任何内容时才能切换 preset，因此请在法语 preset 上开始新会话。

## 保持原文的内容

引用的证据从不翻译：`web_search` 的来源片段、文件内容、错误串、命令与代码都与来源完全一致，agent 会如实引用它们。会话标题跟随会话语言。这些是引用，不是 agent 在用另一种语言回答。
