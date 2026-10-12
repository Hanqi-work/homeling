# 轮询快照而非 WebSocket

## Status

accepted

实时性以自适应轮询 `/api/snapshot` + `/api/refresh` 戳实现，v1 不引入 WebSocket。复用 Collie 既有契约（`GET /api/snapshot` 为真相源，浏览器自适应 poll），前端以 assistant-ui `ExternalStoreRuntime` 喂快照映射出的消息数组。t3code 的 WS RPC 订阅架构因此**只抄 UI 组件与数据形状，不搬 runtime**。

## Consequences

- 流式观感依赖轮询节奏，M1 实测；不丝滑时再评估 additive WS（届时 supersede 本 ADR）。
- 前端必须自写：稳定 message/tool ID、不可变替换、旧快照防回滚。
