---
status: accepted
---

# Zero-touch：Homeling 不写 Collie 安装目录的任何文件

Homeling 建立在 Collie 之上但不替代它，且用户曾被改动过程弄坏过自己的 Collie——"绝不打架"因此升格为硬约束。我们决定采用 **zero-touch 部署**：Homeling 不向 `~/.local/share/collie/` 写任何文件、不改一行 bridge 代码、不重编译 `bin/collie`。可证伪的不变量：`git -C ~/.local/share/collie status` 永远干净。

实现方式：

- **手机侧分流**：`tailscale serve --bg --https=443 --set-path=/lite/ 8790` 把新 UI 与 persona API 指向 persona daemon；Collie 根 handler（`/` → :8787）原样保留。多 path handler 在同一 listener 上共存互不覆盖（Collie 自身文档与 `front-door.ts` 均以此 为前提，且 Collie 有占用保护、只写自己的 path）。分流是 tailscale 配置层动作，不碰 Collie 代码。
- **鉴权自持**：`Tailscale-User-Login` 等 identity header 由 tailscaled 对同一 listener 的所有 handler 注入（非 bridge 层行为），daemon 照 Collie `checkAccess` 语义自建校验（trusted user + fail-closed + loopback 信任）。
- **通知自持**：daemon 自带 push 管道（VAPID / 订阅 / debounce / coalesce / retract，观察对象是 herdr socket 而非 bridge）；Collie 自身通知**保持开启**（用户决策：双通道并存，v1 接受同事件可能双响），用户可随时经既有 `POST /api/notifications/prefs` 自行静音 Collie 侧（配置层，可逆），Homeling 不代做。

## Status

superseded by ADR-0004 之前的本 ADR（patch 方案）被否：patch 应用失败、`collie update` 的 `git checkout --force`（`cli/update.ts:784`）冲掉补丁、rebase 冲突，都是把用户 Collie 弄坏的暴露面。

## Considered Options

- **additive patch（已否，见 ADR-0002）**：功能最顺（复用 bridge 鉴权与 push 管道），但破坏风险不可接受。
- **新 UI 产物放 `web/dist/lite/`**：已证伪——`collie build`/`update` 会 `removeTree(web/dist)` 整目录替换（`cli/build.ts:379-380`），自定义产物必被清。
- **zero-touch（采纳）**：代价是 daemon 变厚（自带通知协调器与鉴权），这笔复杂度买断"永不打架"。

## Consequences

- PRD §10 原"bridge additive 改动清单"作废：通知摘要与 persona API 全部移入 daemon；深链接、SPA fallback 由 daemon 自持静态服务天然解决。
- daemon 常驻宿主沿用 ADR-0001 的独立 launchd agent；默认端口 8790。
- Collie 升级与 Homeling 完全解耦：任何一方 update/install 都不影响另一方。
- Homeling 侧唯一触碰系统级共享状态的是 `tailscale serve` 配置——只增删自己的 `/lite/` path，永不写根 handler。
