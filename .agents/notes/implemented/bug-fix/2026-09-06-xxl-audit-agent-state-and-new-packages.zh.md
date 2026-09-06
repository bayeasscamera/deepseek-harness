# Agent Note：XXL 审计处理——agent-state 反馈纪律、快照挂起根因与新包补全

Status: implemented

[English](2026-09-06-xxl-audit-agent-state-and-new-packages.md) | 中文

## 问题

2026-09-05 的 XXL 审计发现四类相互交织的缺陷。其一，headless 快照挂起：将 `agent-state` 挂载进 base bundle（380c2cd0af）后，其 post-execute 监听器会给每次已结算的工具调用附加一条 `[bash] settled success …` 比对通知，而无密钥 headless mock（`cli-mock-llm.ts`）仅凭 `messages.at(-1)` 决定下一个响应——通知遮住了 tool-result，mock 便永远重放同一个 bash 调用（约 50 Hz 下 992 次迭代，每次都重写存储）。其二，`agent-state` 违反了两条成文约定：pre-step 监听器不调用 `next()` 就返回 `{kind:'enter'}`，丢弃了后续监听器的贡献与运行时上下文投影；存储文档声称原子替换，而 `saveState` 只是普通 `writeFileSync`。测试期间还暴露出一个相关潜伏缺陷：`loadState` 对观察行做整体替换而非拼接，任何重载都只保留最新一条观察。其三，六个新 WIP 包是无法挂载的脚手架：引擎未接线、README 描述不存在的行为、路径穿越、丢弃 disposer、覆盖率门槛不可能通过。其四，已提交的包各自带有发现（仅咨询性的 denylist 伴随无界的熔断噪声、stat 哈希过期、纯文本的提升 confinement、大小写敏感的 Bearer 剥离、吞掉沙箱监听器错误）。

## 决策

**agent-state 只上报意外。** post-execute 监听器仍把每次已结算观察折入持久统计，但只在结果为失败或与预测不符时才把比对作为附加上下文附加；匹配的成功不注入任何消息。mock 改为向后扫描最近的 tool-result 块，因此无论哪些 guard 注入上下文，通知都无法再遮蔽它。pre-step 监听器以 `await next()` 委托，并把召回前置到合并后的决策之上。`saveState` 先写同目录 `.tmp` 再重命名；`loadState` 按持久化顺序拼接观察行；保留上限（`maxObservations`、`maxLessonsPerTool`）成为经过校验的 Config 字段。

**六个新包选择补全而非删除。** 每个包现在都具备其 README 所声称的接线：world-model 的后果引擎挂进工具管线（仅意外反馈、按 cwd 的存储 Map、schema 版本 fail-loud）；auto-continue 在 `agent/request-error` waterfall 上以每 agent 预算接管限流恢复；screen-reader 通过按上下文的 Service 接通 verbosity 并以 `assertNever` 收尾；ios-simulator 注入进程运行器使测试永不启动真实 `xcrun`；design-artboard 以与写入端相同的 stem 谓词校验读取路径并报告真实 mtime。六个包按工作区版本（`0.1.0-rc.5`）都是 release member：公开发布元数据、移除 `private`、依赖与导入匹配、逐文件 100% 覆盖率，且七个工具全部通过 gen-tool-catalog 清单编目，其完备性守卫现在也显式钉住非 `tool-*` 目录。

**已提交代码的修复保持 waterfall 语义。** host-runner 沙箱包装器区分 waterfall 调用（即使被包装监听器抛错也委托 `next()`，故障绝否决整条链），并在 emit 监听器上完成隔离记账后重抛。提升 confinement 在解析后用 `ctx.fs.contains` 复核，堵住纯文本前缀检查放行的 symlink 重定向。Bearer 剥离对 scheme 词大小写不敏感；typert 复用哈希改为基于内容；auto-verification 熔断器对每个目标只触发一次，其 README 声明 denylist 仅为咨询性且事后性。

**Onboarding 接管使除自身外的整个文档进入 inert。** 将设置面板 portal 到 `document.body` 逃出了此前仅针对 `#root` 的 inert 范围，使 portal 到 body 的对话框在接管期间仍可被键盘与读屏器触达；接管面现在对所有非自身入口时就已 inert 的 body 子元素置 inert，并在卸载时精确恢复这批元素。

## 曾考虑的替代方案

**只修 mock 不修 guard。** 否决：每次调用都发通知的行为在真实会话中同样会在每次工具调用后注入一条模型可见消息，这是任何组合都没有要求的无条件 token 开销。把匹配的成功挡在模型可见流之外同时修复了失步与噪声；mock 加固仍然保留，因为 fixture 脆弱是第二个独立缺陷。

**把 world-model 的引擎合并进 agent-state。** 暂缓并记录重叠：两者的启发式风险表会漂移，但删除用户编写的包是产品决策而非审计修复。共享机制（原子写入、仅意外反馈）已移植；风险表合并记为后续工作。

**对未推送的栈做 rebase，把放错位置的测试 hunk 从 974e6d3d0b 移入 fadc5ff600。** 跳过：十个提交上的重写风险大于纯 bisect 场景的不便，且分支最终树是自洽的。

## 后果

所有快照恢复无密钥回放（115/115），单元套件增长约两百个测试至 13 701，全部通过覆盖率、hygiene、duplication 与文档门槛。agent 会话不再携带每次工具调用一条的通知；模型可见反馈限于意外与已确认的高风险成功。新包可加载、有文档、已编目，但没有任何一个被挂进默认 profile——挂载仍是各 profile 明确的组合决策。
