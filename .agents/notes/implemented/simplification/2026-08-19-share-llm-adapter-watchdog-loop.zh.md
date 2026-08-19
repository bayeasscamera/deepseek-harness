# Agent Note: 共享 LLM 适配器的空闲看门狗流循环

Status: implemented

中文 | [English](2026-08-19-share-llm-adapter-watchdog-loop.md)

## 问题

`dsh-llm-deepseek` 与 `dsh-llm-pi-ai` 各自手写了一遍围绕 `idleWatchdog` 的同一套流生命周期循环：融合调用方取消信号、在每次未完成的迭代器请求外围武装看门狗、在未耗尽退出时拆除迭代器，并对结果分类。两份拷贝已经漂移：`dsh-llm-pi-ai` 在每次请求之后探测 `timeoutOf(watchdog.signal, …)` 并在循环内抛出该原因；`dsh-llm-deepseek` 只在 `catch` 中分类。两者的拆除逻辑也不同：pi-ai 在循环的 `finally` 内先中止自己的 consumer 控制器再归还迭代器，deepseek 则在外层 `finally` 中做。这种漂移并非外观问题：pi-ai SDK 会把看门狗中止转换为一个 `aborted` 结束*块*并正常返回，因此没有循环内探测的循环会把看门狗超时呈现为 `ABORTED` 而非 `TIMEOUT` —— 正是重试策略会据此做出错误决策的误分类（`ABORTED` 不可重试，`TIMEOUT` 可重试）。

## 决策

将该循环提取为 `@deepseek-ai/dsh-llm` 中的 `watchdogStream({ watchdog, watchdogCode, iterator })`（新增 `src/stream-watchdog.ts`，从包根导出）。该辅助函数驱动请求循环，在每次请求之后探测看门狗，一旦其已触发就抛出它的 `TimeoutReason` —— 且先于对 `done` 结果的采纳，因此即使某个传输在中止时正常返回也能被分类为超时；在任何未耗尽的退出路径上归还迭代器，只吞掉拆除自身的中止。分类仍归适配器所有：每个适配器既有的 `catch` 依旧把传播上来的原因经 `timeoutOf` 映射为自己的 `TIMEOUT`/`ABORTED`/`TRANSPORT` `LlmError`，每个适配器也依旧拥有自己的 consumer 控制器、凭据快照与请求构造。`dsh-llm` 本就 peer 依赖 `dsh-timeout`，因此没有新增依赖边。两个适配器现在都调用这同一个辅助函数；pi-ai 冗余的内层 `try`/`finally` 收拢进其外层 `catch`/`finally`。

## 曾考虑的替代方案

把辅助函数放进 `dsh-timeout`。否决：超时库只通过中止信号通知，并刻意把结果翻译留给各能力自持；一个为 LLM seam 的块迭代契约而存在的循环应当归属该 seam，而 `dsh-llm` 本就为这种组合 peer 依赖 `dsh-timeout`。

保留两份循环并用测试钉住漂移。否决：漂移本身就是缺陷面 —— 两份对正确性敏感的循环还会再次漂移，而 pi-ai 的探测之所以存在，正是因为其中一种传输会把中止藏成块；共享循环把这一事实变成一条有文档的不变量，而不是两条隐式约定。

## 后果

- 一个请求循环同时服务两个适配器；未来的传输怪癖（中止呈现为块、中止呈现为抛出、或两者皆非）只需处理一次，`watchdogStream` 的单元测试套件直接钉住了"先探测后采纳 `done`"的顺序、失败时的拆除、以及吞掉拆除失败这三类行为。
- DeepSeek 的分类获得了探测能力：最后一次请求在与空闲区间到期的同一 tick 内解析出 `done` 的流，现在报告 `TIMEOUT` 而非静默成功。空闲区间就是契约，因此与最后一个块竞速胜出的超时仍然是一次超时；既有的 deepseek 76 项测试与 pi-ai 45 项测试套件原样通过。
- 适配器保留一切部署专属内容：连接事实、凭据解析、请求序列化，以及 `LlmError` 的措辞与代码。模型可见行为、会话事件与线上格式均未改变。
