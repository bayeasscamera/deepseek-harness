---
description: "office 分组地图：在会话工作区里产出办公文档的面向模型工具，供使用者与维护者浏览本分组。"
kind: "package-group"
---

# packages/office

[English](README.md) | 中文

## 概述

office 分组负责产出人们在办公软件里打开的产物。它目前包含一个产品包：把描述好的演示大纲变成会话工作区里真实 `.pptx` 的工具，字节经文件系统 seam 写入，因此与任何其他变更享有同样的隔离、防护与原子发布。分组负责产物格式与模型契约；文件落在哪里、这次写入是否被允许，属于它所写入的文件系统与沙箱 seam。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 作用 | ctx key |
|---|---|---|
| [`tool-slides`](tool-slides/README.zh.md) | 让 agent 依据结构化大纲写出一份 PowerPoint 演示 | 注册到 `ctx.tools` |

-----

<a id="related-documentation"></a>
## 相关文档

- [文件系统子系统](../../docs/subsystems/filesystem.zh.md) —— 每次产物写入所经过的 seam，包含二进制变更。
- [沙箱子系统](../../docs/subsystems/sandbox.zh.md) —— 决定一次写入是否被允许的策略。
- [生成的工具目录](../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-slides) —— 模型收到的 `write_presentation` schema。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文 —— 点击展开</summary>

无。

</details>
