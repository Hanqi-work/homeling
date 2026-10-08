---
status: accepted
---

# daemon 反代 bridge API

## Context

新 UI 由 daemon 在 `/lite/` 同源托管，但 Collie bridge 位于 Tailscale listener 的根路径，daemon 自身收到的 URL 保留 `/lite/` 前缀。浏览器直连 bridge 的 loopback 端口在手机上不可达，并会引入跨源与身份校验差异。snapshot 只给 pane 元数据；消息正文需读取 bridge history。

## Decision

浏览器只向 daemon 同源请求 `/lite/api/*`。daemon 在自身 `checkAccess` 通过后，按 `/lite/api/` 前缀映射到 bridge loopback origin，并只代理以下路由：

- `GET /api/snapshot`
- `GET /api/pane/:id`（pane 当前终端屏幕；用于有限提取 pending prompt/preview，也作为只读文本镜像来源）
- `GET /api/pane/:id/history`
- `GET /api/launchers`
- `POST /api/pane/:id/reply`
- daemon 语义路由 `POST /lite/api/pane/:id/stop` 映射到 Collie 现有的 `POST /api/pane/:id/keys`，只发送 daemon 固定构造的 `{"keys":["ctrl+c"]}`；浏览器任意按键写入仍被拒绝。该操作只请求中断，不关闭 pane，也不保证进程已终止；后续 snapshot 才是权威状态。
- `POST /api/launch`
- `POST /api/pane/:id/keys`（仅 daemon 请求审批服务内部使用；携带上游 `expected_prompt` binding）

`history` 的 `limit`、`before` 等 query 原样传递。launch body 原样转发；客户端只提交 `launchers.toml` 中精确匹配的 `command`，以及可选的 `paneId`。路径解码/遍历、非白名单路由、其他 HTTP 方法均拒绝；不代理 Collie `/chat`、其他写接口或未来新增的 bridge API。POST 继续经过 daemon `checkAccess` 的 Host、Origin、身份校验；只有直接 loopback peer 且 loopback Host 才允许无 Origin，Tailscale Serve 的 loopback 代理 peer 不视为本机。非 loopback POST 必须携带与配置 Tailscale HTTPS origin 完全匹配的 Origin，且 body 必须为 `application/json`。透传已验证的 `Tailscale-User-Login`，保留 bridge 自身的鉴权门。daemon 与 bridge 仍只监听 loopback。Launch 请求有 60 秒代理等待超时，超时以结构化 `launch.timeout` 返回，客户端不创建 task chip。Collie launch 不响应取消，因此超时不代表 pane 已回滚；没有可靠关联 pane 前 daemon 不做 snapshot 差分猜测或自动 close，超时残留需人工真机验收。daemon `/requests/:id/approve` 只接受 optionId；keys 路由虽在内部 URL allowlist 中，但浏览器直连 proxy 明确拒绝。

Collie snapshot 不含请求模型；daemon 只从 `status: blocked` 的 pane 当前屏幕提取明确识别的 numbered prompt-select / preview-select，未知或不完整的屏幕不生成可执行卡。pending id 由 daemon 对每次屏幕请求代际生成，刷新未变化时复用；pane 归属由 space/workspace 标识映射 persona。optionId→keys 映射留在 daemon，浏览器不能提交任意键。审批前重新读取 pane 并校验相同请求；通过 `/keys` 提交时仍发送 Collie `expected_prompt`，preview 选择先移指针、重读确认，再单独发 Enter。请求状态在 daemon 内存维护；结果不明的写请求按已处理封锁重试，防止双击造成重复按键。

## 送达边界（ticket #4）

HTTP 2xx 只表示 Collie 接受了 reply 请求，不表示 agent 已消费文本。发送时记录文本与发送时间；只有后续 `GET /api/pane/:id/history` 出现 `role: "user"`、文本完全相同且解析后的 `ts >= sentAt` 的条目，才确认“已送达”。多条相同文本按发送时间先进先出，与不同 history 条目一一匹配。确认前乐观消息独立保留，不因旧 history 快照回滚；确认后用 history 条目替代临时消息并显示已送达。

## daemon 层 CSRF 缓解（ticket #4）

Collie 写 handler 不校验 Content-Type，因此浏览器的 `text/plain` 简单表单可以尝试跨站 POST JSON 形态的 body；zero-touch 原则下不修改上游。daemon 是新增边界，从严要求非 loopback 调用使用匹配的 Tailscale HTTPS Origin，并且 reply、keys 与 daemon approval body 必须是 `application/json`（可带参数）；无 Origin 仅对直接 loopback peer + loopback Host 豁免。Tailscale Serve 到 daemon 的 peer 虽是 loopback，但 tailnet Host 不属于本机豁免，仍需身份与 Origin。

## Options considered

- **浏览器直连 `:8787`**：手机访问时该地址指向手机自身，且 CORS / identity 处理分叉，拒绝。
- **对 bridge 开放宽泛 CORS**：扩大现有 bridge 暴露面，并违反 zero-touch，拒绝。
- **daemon 窄白名单反代**：浏览器同源，bridge 只开放明确列出的读路由、pane reply 与受控 keys，选定。

## Consequences

- 前端必须使用 Vite base-relative `/lite/api/` URL；daemon 收到完整 `/lite/api/*`，不得假定前缀被 Tailscale 剥离。
- 新增反代 allowlist 时需同步更新此 ADR 与测试；默认拒绝，不因 bridge API 增长而自动放宽。
- daemon 不保存 bridge 数据，不修改 Collie 安装文件；写入仅通过 bridge 的 `/reply` API。bridge 中断时保留 UI 已有 transcript，并显示读取错误。
