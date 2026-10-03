# Agent Note: Binary writes in the filesystem seam

Status: implemented

[English](2026-10-03-filesystem-binary-writes.md) | 中文

## Problem

`ctx.fs` 能读原始字节（`readBytes`、`readByteRange`），却只能写文本：`writeText` 接收 `string`、规范化行尾，并以 before/after 差异基础作答。因此，产出非文本产物的工具——演示文稿、压缩包、图片、工作簿——无法把它放进工作区：把字节编码成字符串会破坏所有高于 `0x7F` 的字节，而在工具里直接用 `node:fs` 写文件则会绕开这层 seam 的解析、按目标加锁、写入意图防护，以及围住它的沙箱策略。

## Decision

`FileSystem.writeBytes(target, content: Uint8Array, expected?, signal?, sandboxPolicy?)` 是这层 seam 的原始字节变更，返回 `FsWriteBytesOutcome { operation, version, bytes }`。它施加与 `writeText` 相同的防护——`createIfAbsent` 拒绝调用方从未读过的目标，`replaceIfVersion` 拒绝陈旧或不存在的目标——并经由各提供方已有的原子路径发布：本地后端经由它私有的、已同步的暂存目录，守卫式创建仍用同一个不可替换的硬链接发布；E2B 后端经由它的暂存目录、`chmod` 与提交式重命名。它刻意不保留差异基础：字节没有可作为差异的行结构，因此结果报告写入的字节数而非 `before`/`after`，展示层回退到整文件差异。

两个写入者共享防护。本地后端内联的防护块变成 `fsio.ts` 中的 `assertWriteIntent(existing, expected, displayPath)`，由 `writeText` 与 `writeBytes` 共同调用，于是文本与字节的拒绝码和消息完全一致，也不会各自漂移。E2B 后端本就有 `checkWriteIntent`，直接复用。本地的原子写入器（`fsio.ts` 的 `writeFileAtomic`）现在接收 `string | Uint8Array`，只对文本传入 utf8 编码。E2B 写入器把 `ArrayBuffer` 交给沙箱 SDK（这正是它的 `files.write` 所接受的类型），并通过 `content.slice().buffer` 复制，使指向更大缓冲区的视图永远不会连带发布它的邻居。

## Alternatives considered

**把 `writeText` 扩展为接收 `string | Uint8Array`。** 一个方法而非两个，也不需要新的结果类型。它输在文本约定在另一个方向上同样是承重的：`FsWriteOutcome.after` 是 `string`（LF 规范化后的差异基础），行尾规范化适用于文本且绝不能碰字节，而结果的每个现有消费方都得处理一个无法做差异的变体。两个方法让各自的约定都是完备的。

**经 `writeText` 走 base64。** 完全不动 seam，防护也顺带得到。它输在它并不产出产物：工作区里会是 base64 文本而不是 `.pptx`，解码又需要第二个工具或一次 shell 往返——模型为它根本不读的字节付 token。

**在工具里直接用 `node:fs` 写文件。** 这是做出可用功能最短的路径。它输在 seam 自身的条件上：它会绕开路径解析、按目标加锁、观察策略安装的写入意图防护，以及围住其他每次变更的沙箱策略，使一个工具成为唯一不适用隔离的地方。

**在文本后端旁另设一个纯二进制后端。** 这样可以完全不碰 `writeText` 的约定。它输在每个提供方仍然得实现字节发布——同样的暂存、防护与原子性——于是拆分只会复制最难的部分，并让工具面对两个文件系统服务去选择。

## Consequences

工具现在可以在会话工作区内产出二进制产物，并享有与文本写入相同的隔离、加锁与陈旧性防护——这正是演示文稿生成工作所需要的。代价是多了一个需要与第一个保持一致的变更方法：防护现在是共享代码，但发布路径在每个后端各存在两份（文本一份、字节一份），因为内容类型在写入点不同。字节写入不保留上下文基础，所以二进制覆写会以整文件变更而非 hunk 差异呈现；这是展示层的限制，不是数据上的。两个已交付的提供方都与各自的文本路径按同一套逐文件标准覆盖，seam 也写明：文本操作拒绝非 UTF-8 内容，而 `writeBytes` 按原样发布字节。
