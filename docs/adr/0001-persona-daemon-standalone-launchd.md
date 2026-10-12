# Persona daemon 作为独立 launchd 常驻服务

## Status

accepted

Persona 层是新代码（Homeling 的核心增量），但它是**长驻网络守护进程**，不能住进 herdr plugin pane（pane 会随 detach/重启而死），也不进 herdr 核心。与 Collie bridge 同一先例：launchd user agent（本机 `herdr.collie` plist 已验证此模式）。daemon 自身只听 localhost，对外经 Collie bridge 反代转发以复用 Tailscale 鉴权 / 同源门 / 配对 token。

## Consequences

- daemon 的生死管理是 launchd（RunAtLoad + KeepAlive），不是 herdr。
- 前端永不直连 daemon 端口；所有请求走 bridge 的 additive 反代端点。
- 新增一个 plist（如 `herdr.homeling.plist`），随项目仓库维护安装脚本。
