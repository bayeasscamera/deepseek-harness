# Agent Note: 在 permission-rules 危险检查器中检测"解码后执行"混淆

Status: implemented

中文 | [English](2026-08-19-permission-rules-base64-shell-danger.md)

## 问题

`dsh-permission-rules` 的危险检查器会把 `curl | sh` 与 `wget | sh` 标记为远程执行风险，但同一类手法在前面加一步编码 —— 把解码后的载荷通过管道送入 shell（`base64 -d | sh`、`base64 --decode | bash`）—— 却能通过该启发式检查。一个被混淆的"下载即运行"命令会抵达模型的 `allow` 路径，而得不到检查器本应提供的 `ask` 升级。

## 决策

向 `DANGER_PATTERNS` 增加一条模式：`/\bbase64\b.*\|\s*(ba|z)?sh\b/`。它匹配命令中任意位置的 `base64` 后接管道进入 `sh`/`bash`/`zsh`，同时覆盖 `base64 -d` 与 `base64 --decode` 两种形式。该启发式只会把决策升级为 `ask`（绝不静默拒绝），因此用户仍会进行批准。

## 曾考虑的替代方案

同时标记不带 `-r` 的 `rm -f` 以及宽泛的变量展开（`$(...)`/反引号）。否决：既有测试刻意把 `rm -f foo.txt` 钉为安全（单文件强制删除是常规操作），而标记命令替换会对无处不在的合法命令产生误报（`echo $(date)`、`$(git rev-parse HEAD)`）。有界且高信噪比的补充是"解码后执行"的管道。

## 后果

- `base64 ... | sh/bash/zsh` 现在会升级为 `ask`；纯数据用途的编解码（`base64 -d file > out`、`cat file | base64`）保持安全，并由测试钉住。
- 新增一条测试覆盖正例与反例；既有两条测试原样通过。
