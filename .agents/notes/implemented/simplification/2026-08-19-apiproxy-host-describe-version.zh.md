# Agent Note: host.describe 报告真实的 harness 版本

Status: implemented

中文 | [English](2026-08-19-apiproxy-host-describe-version.md)

## 问题

API 网关中的 `host.describe` 返回硬编码的 `version: '0.0.1'`，并带有一条读取应用 package.json 的 `TODO`。每个向宿主询问版本的客户端（web UI 的关于页面、诊断信息）看到的都是一个永远与运行中构建不匹配的占位符。

## 决策

把版本经由既有的 `ApiProxyDefaults` 解析步骤传入，而不是去读取应用的 manifest：

- `ApiProxyDefaults` 新增可选字段 `version?: string`。
- 网关插件（`ApiProxyService`）通过一个 `readVersion()` 提供该值，它读取本包自己受版本控制的 `package.json`。工作区所有包共享 monorepo 版本，因此这等于应用版本，且无需 packages→apps 依赖，也无需读取应用 manifest。相对跳转（`../package.json`）从源码树（`src/`）与打包产物（`lib/`）解析结果一致，与 `apps/cli` 既有的 `readVersion()` 相同。
- `createApiProxy` 在其顶部解析 `defaults.version ?? '0.0.0'`（显式解析步骤），因此省略该字段的测试桩仍可工作并回退到一个哨兵值。

## 曾考虑的替代方案

从网关读取 `apps/cli/package.json`。否决：这会颠倒分层（一个 `packages/host` 包依赖应用的 manifest），并破坏挂载同一网关的非 CLI 载体。

把 `version` 设为 `ApiProxyDefaults` 的必填字段。否决：这会为了一个测试从不对其断言的值，迫使约 20 处测试调用点全部修改；约定所认可的默认值应放在所属实现的解析步骤中，而不是藏在 `host.describe` 里。

## 后果

- `host.describe` 现在报告真实的 monorepo 版本；`TODO` 占位符已移除。
- 仓库中其他 `0.0.1` 字面量（MCP 客户端名、SDK server info、ACP agent info、subagent-codex wire）是各自独立的线上协议身份字符串，有意不予改动。
- 模型可见行为与会话日志行为均未改变；只有网关的自我描述字段变了。
