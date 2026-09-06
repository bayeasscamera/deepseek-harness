# @deepseek-ai/dsh-ios-simulator

English | [中文](README.zh.md)

An iOS Simulator integration extension that lists available simulators, manages their lifecycle (boot/shutdown), and captures screenshots for UI verification workflows. Registers simulator management commands and the `ios_simulator_screenshot` model tool.

## Config

```yaml
- id: ios-simulator
  name: '@deepseek-ai/dsh-ios-simulator'
```

No plugin-level configuration fields. Requires Xcode and the `xcrun simctl` CLI to be available on the host machine.

## Behavior

- Lists booted and available iOS simulators via `xcrun simctl list devices --json`.
- Boots a specific simulator by UDID.
- Shuts down a booted simulator.
- Captures a PNG screenshot from a booted simulator and saves it to the specified output path.
- `ios_simulator_screenshot` tool — takes a simulator UDID and output path, returns `{ success, filePath, udid }`.

## Model Experience

### Screenshot tool result

#### What the model sees

The `ios_simulator_screenshot` tool accepts `udid` (simulator identifier) and `outputPath` (where to save the PNG). On success it returns `{ success: true, filePath, udid }` so the model can reference the captured image in subsequent analysis or reporting steps. The generated [`ios_simulator_screenshot` and `ios_list_devices` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-ios-simulator) carry the exact parameter set.

#### Token effect

Negligible — tool output is a compact JSON object. The model may incur additional tokens if it reads back the screenshot file for visual analysis.

#### KV Cache effect

Screenshot captures do not inject persistent system-prompt context. File paths are ephemeral within the turn's tool output.

### Device list query

#### What the model sees

Querying available simulators returns a structured list of `{ udid, name, state }` objects so the model can select the correct device identifier before booting or capturing.

#### Token effect

Proportional to the number of installed simulators. Typically 10–50 entries, each approximately 80–120 characters of JSON.

#### KV Cache effect

Device list output appends to the running conversation; subsequent turns benefit from the cached prefix up to the list response.

## Known Limitations and Deferred Work

- **macOS only** — `xcrun simctl` is not available on Linux or Windows; the plugin fails silently on unsupported platforms.
- **Xcode dependency** — requires Xcode Command Line Tools; not suitable for CI environments without Xcode installed.
- **Single screenshot per call** — video recording and continuous capture are not supported.
