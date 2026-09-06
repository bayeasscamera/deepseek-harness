# @deepseek-ai/dsh-auto-continue

[English](README.md) | 中文

自动续接保护插件：当模型在任务中途未给出完成标记即终止轮次时，自动恢复 agent 循环。检测未完成信号并注入续接提示，使 agent 无需人工干预继续执行。

## 配置

```yaml
- id: auto-continue
  name: '@deepseek-ai/dsh-auto-continue'
  config:
    enabled: true        # default true; set false to disable auto-continuation
    maxContinues: 10     # maximum consecutive auto-continues before requiring human input
    delayMs: 0           # optional delay in milliseconds between turn end and continuation
```

## 行为

- 监听未携带终止标记的 `agent/turn-end` 事件。
- 检测到未完成轮次且未达到 `maxContinues` 上限时，向下一轮注入系统续接消息。
- 统计连续自动续接次数，达到上限时停止并向用户展示诊断提示。
- 在接收到真实用户输入或成功完成任务时重置计数器。

## 模型体验

### 续接提示词注入

#### 模型所见

作为新用户轮次注入的简短系统提示（例如 `"Continue."`），促使模型从中断处继续推进任务。

#### Token 影响

每次自动续接事件增加一条简短消息，作为独立的对话历史条目，不会无限膨胀。

#### KV Cache 影响

续接消息追加到运行中的会话历史；上一轮之前的缓存前缀依然有效，仅新注入的消息重新编码。

## 已知局限与后续工作

- **启发式完成检测** — 依赖输出模式判断轮次是否真正结束，复杂多步任务可能存在误判。
- **无任务状态深度感知** — 不检查工具调用历史或待办队列，仅响应轮次结束信号。
- **固定续接文本** — 注入消息为静态文本，更智能的上下文感知提示需扩展插件。
