# @deepseek-ai/dsh-ios-simulator

[English](README.md) | 中文

iOS 模拟器集成扩展：列出可用模拟器、管理生命周期（启动/关闭）并截图用于 UI 验证工作流。注册模拟器管理命令与 `ios_simulator_screenshot` 模型工具。

## 配置

```yaml
- id: ios-simulator
  name: '@deepseek-ai/dsh-ios-simulator'
```

无插件级配置项。需宿主环境安装 Xcode 及 `xcrun simctl` CLI。

## 行为

- 通过 `xcrun simctl list devices --json` 列出已启动和可用的 iOS 模拟器。
- 按 UDID 启动指定模拟器。
- 关闭已启动的模拟器。
- 从运行中的模拟器截取 PNG 截图并保存到指定输出路径。
- `ios_simulator_screenshot` 工具 — 接收模拟器 UDID 和保存路径，返回 `{ success, filePath, udid }`。

## 模型体验

### 截图工具结果

#### 模型所见

`ios_simulator_screenshot` 工具接收 `udid` 与 `outputPath`。执行成功时返回 `{ success: true, filePath, udid }`，供模型在后续分析中引用。生成的 [`ios_simulator_screenshot` 和 `ios_list_devices` schema](../../../docs/tool-catalog.md#deepseek-aidsh-ios-simulator) 载有精确的参数集。

#### Token 影响

可忽略 — 工具输出为紧凑 JSON 对象。模型若读取图像进行视觉分析会产生额外 Token。

#### KV Cache 影响

截图不注入持久系统提示词上下文。文件路径仅在当轮工具输出中有效。

### 设备列表查询

#### 模型所见

查询可用模拟器返回 `{ udid, name, state }` 列表，便于模型在启动或截图前选取正确的设备标识。

#### Token 影响

与安装的模拟器数量成正比，通常为 10–50 个条目。

#### KV Cache 影响

列表输出追加到对话历史中，后续轮次直接复用前缀缓存。

## 已知局限与后续工作

- **仅限 macOS** — `xcrun simctl` 不支持 Linux 与 Windows，在非 macOS 环境下静默失败。
- **依赖 Xcode** — 需要 Xcode 命令行工具，不适用于无 Xcode 的 CI 镜像。
- **单次单张截图** — 暂不支持录屏或连续截图功能。
