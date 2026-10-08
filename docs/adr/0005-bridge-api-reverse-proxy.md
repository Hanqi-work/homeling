---
status: accepted
---

# daemon 反代只读 bridge API

## Context

新 UI 由 daemon 在 `/lite/` 同源托管，但 Collie bridge 位于 Tailscale listener 的根路径，daemon 自身收到的 URL 保留 `/lite/` 前缀。浏览器直连 bridge 的 loopback 端口在手机上不可达，并会引入跨源与身份校验差异。snapshot 只给 pane 元数据；消息正文需读取 bridge history。

## Decision

浏览器只向 daemon 同源请求 `/lite/api/*`。daemon 在自身 `checkAccess` 通过后，按 `/lite/api/` 前缀映射到 bridge loopback origin，并只代理以下 GET 路由：

- `GET /api/snapshot`
- `GET /api/pane/:id/history`

`history` 的 `limit`、`before` 等 query 原样传递。路径解码/遍历、非白名单路由、其他 HTTP 方法均拒绝；不代理 Collie `/chat`、写接口或未来新增的 bridge API。透传已验证的 `Tailscale-User-Login`，保留 bridge 自身的鉴权门。daemon 与 bridge 仍只监听 loopback。

## Options considered

- **浏览器直连 `:8787`**：手机访问时该地址指向手机自身，且 CORS / identity 处理分叉，拒绝。
- **对 bridge 开放宽泛 CORS**：扩大现有 bridge 暴露面，并违反 zero-touch，拒绝。
- **daemon 窄白名单反代**：浏览器同源，bridge 仍为只读数据源，选定。

## Consequences

- 前端必须使用 Vite base-relative `/lite/api/` URL；daemon 收到完整 `/lite/api/*`，不得假定前缀被 Tailscale 剥离。
- 新增反代 allowlist 时需同步更新此 ADR 与测试；默认拒绝，不因 bridge API 增长而自动放宽。
- daemon 不保存 bridge 数据、不写 Collie；bridge 中断时保留 UI 已有 transcript，并显示读取错误。
