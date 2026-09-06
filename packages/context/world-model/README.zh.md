# @deepseek-ai/dsh-world-model

[English](README.md) | 中文

环境智能上下文插件，提供三项联动核心能力：声明式环境规则与策略校验器、原子级持久化状态存储（`.dsh/world-state.json`）以及在执行前评估工具调用的启发式风险与后果预测引擎。

命令：`/env`、`/worldstate`。工具：`world_model_predict`、`world_model_query`、`world_model_save_fact`。

## 配置

```yaml
- id: world-model
  name: '@deepseek-ai/dsh-world-model'
  config:
    maxRules: 30         # maximum environment rules injected into the system prompt
    maxHistory: 50       # maximum task-history entries stored on disk
    maxConsequences: 100 # maximum consequence history entries held in memory
```

## 行为

- 启动时注册内置环境规则（ESM-only、no-credential-commit、文件系统写入权限等）。
- 向系统提示词注入 `## Environment Rules` 区域，列出当前启用的能力、权限与约束以及运行时硬件遥测数据。
- 原子化记录任务历史、活跃规则 ID 和自定义事实到 `.dsh/world-state.json` 并带有备份自愈机制。
- 执行前风险预测：根据工具名称与参数，评估影响、风险等级（`none`/`low`/`medium`/`high`/`critical`）、爆炸半径与可逆性。

## 模型体验

### 环境规则系统提示词注入

#### 模型所见

系统提示词中注入的 `## Environment Rules` 区域，按类别以 `- **id**: description` 形式列出能力、权限和约束，并附带一行运行时遥测信息。

##### 示例注入

```markdown
## Environment Rules

### Capabilities
- **tool:run_command**: Shell command execution is enabled.

### Constraints
- **constraint:no-credential-commit**: Never commit or log secrets, API keys, or credentials.
- **constraint:esm-only**: All TypeScript/JavaScript in this project is ESM. CJS-only imports are forbidden.

### Runtime Telemetry
- **Platform**: darwin (arm64) | Node: v22.19.0 | Memory: 8192 MB free / 16384 MB total
```

#### Token 影响

与启用的规则数量成正比（受 `maxRules` 上限约束）。遥测信息增加一行。自会话开始未启用的规则不出现。

#### KV Cache 影响

规则注入在用户消息之前的系统提示词位置；除非在会话中途动态切换规则，否则跨轮次保持稳定。

### 风险预测工具输出

#### 模型所见

`world_model_predict` 返回包含 `riskLevel`、`blastRadius`、`reversible`、`warnings` 和 `predictedEffects` 数组的结构化 JSON，使模型能够在执行破坏性工具前进行推理。生成的 [`world_model_predict`、`world_model_query` 和 `world_model_save_fact` schema](../../../docs/tool-catalog.md#deepseek-aidsh-world-model) 载有精确的名称、描述与参数。

#### Token 影响

可忽略 — 工具输出为紧凑 JSON 对象。仅在调用高风险工具前按需触发。

#### KV Cache 影响

工具输出追加到轮次的 assistant 消息中；后续轮次直接复用前缀缓存。

## 已知局限与后续工作

- **纯启发式规则** — 后果规则为手工配置模式，不进行代码变更的完整 AST 静态分析。
- **单进程状态存储** — 持久化状态不支持并发多进程写入，专为单 agent 会话设计。
- **规则优先级** — 所有活跃规则具有相同权重，暂不支持用权限覆盖约束的优先级机制。
