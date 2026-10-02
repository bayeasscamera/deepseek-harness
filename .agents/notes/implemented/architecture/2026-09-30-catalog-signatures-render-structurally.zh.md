# Agent Note: Cordis 目录的签名按结构渲染，而非取自源码文本

Status: implemented

[English](2026-09-30-catalog-signatures-render-structurally.md) | 中文

## Problem

[`memberText`](../../../../packages/typert/generator/src/analyzer.ts) 通过复制声明的源码文本、并把每个空白序列压缩成单个空格来生成签名。Cordis 目录投影器把该字符串用作事件签名，而 [`FaceModelEmitter`](../../../../packages/typert/generator/src/emitter.ts) 则从类型模型对同一签名做结构化重新渲染。

两者只是一次巧合地一致：它们读到的都是源码碰巧具有的排版。任何会改变声明折行的因素——某行越过打印宽度、一个格式化工具、一次手工编辑——都会让已提交的目录与运行时 emitter 产生分歧，而这种分歧表现为 `tools-catalog` 关于参数列表内部空白的失败，而不是一个能被定位的缺陷。

## Decision

目录通过与 emitter 相同的 renderer 渲染事件签名，并以引号包裹的事件名前缀开头，与 emitter 的做法一致：

```ts ignore-check
signature: `${quote(event.name)}${this.renderer.renderSignature(node.signature)}`,
```

服务成员继续使用 `member.text`，因为 emitter 的 `runtimeMember` 使用 `renderMember(member, true)`，其 `sourceModifiers` 参数返回源码文本并保留仅存在于源码的修饰符（例如 `async`）。改为结构化渲染成员会丢掉 `async`，从而在另一个方向上破坏往返一致性。

现在只有一套签名 renderer，目录也不再依赖源码排版。

## Alternatives considered

出于对称性而同样对成员做结构化渲染，曾被尝试并回退：不用 `sourceModifiers` 的 `renderMember` 输出 `create(exec: ToolExecutionInput)`，而 emitter 输出 `async create(exec: ToolExecutionInput)`。与 emitter 相矛盾的对称性不是简化。

## Consequences

通过源码文本进入目录的签名仍然跟踪源码排版，因此任何会重新折行的变更必须在同一变更中重新生成目录；`gen-cordis-catalog` 是逐字节证明这一点的 gate。事件签名现在与格式无关，因此未来的格式化工具不会触及它们。
