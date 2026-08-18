# Agent Note: 清理 SDK 客户端未使用的服务端请求管线

Status: implemented

中文 | [English](2026-08-18-prune-sdk-client-server-request-plumbing.md)

## 问题

Python 版 `HarnessClient`（`python/sdk/src/deepseek_harness/client.py`）携带了从未被使用的服务端请求相关代码：`IncomingRequest` 模型、`next_request()`、`respond()`、`respond_error()` 方法、`notify()` 方法，以及 `_requests` 队列。运行时协议是单向的——客户端发送 `initialize`、`session/prompt`、`shutdown` 请求并接收响应与通知；服务端不会发起需要客户端应答的请求，客户端也不会发起通知。这一半代码在没有任何调用方的情况下复制了服务端的请求/响应路径，扩大了公开接口面与回归矩阵。

## 决策

从 Python 客户端中移除未使用的服务端请求与客户端通知接口。删除 `IncomingRequest`（`models.py`）、`_requests` 队列，以及 `notify()`、`next_request()`、`respond()`、`respond_error()` 方法。读取循环中对入站请求的分支改为一个显式守卫：直接丢弃服务端发起的请求帧，而不是将其入队；`_fail_waiters` 不再向已移除的队列写入。`HarnessClient` 与 `HarnessConfig` 保持原有契约，`session_prompt` 仍返回排队的 `messageId`。

## 考虑的替代方案

保留对称对端以应对未来可能出现的服务端发起请求（例如交互式权限）。但目前既没有已类型化的方法，也没有生产调用方；未发布的客户端可以在该功能被设计出来时再补充所需的最小方向，而不是一直携带休眠的器件。TypeScript 版 `HarnessClient` 已经只使用其单向的一半，因此本次改动让两个 SDK 孪生实现保持一致。

## 验收标准

- `IncomingRequest`、`notify`、`next_request`、`respond`、`respond_error` 在 `python/sdk` 及其测试中没有任何调用方。
- 客户端仍能应答 `initialize`/`session/prompt`/`shutdown`，并把服务端通知分发给各订阅者。
- `python/sdk/tests/test_client.py` 通过；依赖被移除辅助方法的测试已改写为直接通过 `_handle_message` 驱动通知（保留 `broken_filter` 错误处理覆盖），或予以删除。
- `packages/sdk/client/tests/fake-runtime.ts` 不再描述生产环境从未发出的 `session.finished`；其文档改为描述它实际发出的 `turn/end` 原因（`FAKE_REASON_KIND`）。

## 风险

对已发布行为无风险：被移除的方法没有生产调用方。假定 `session.finished` + `{ accepted: true }` 协议的过时 Agent Note `make-jsonrpc-directional` 已作为废弃项归档——生产环境已经改为立即返回 `{ messageId }` 回执并异步流式推送事件。
