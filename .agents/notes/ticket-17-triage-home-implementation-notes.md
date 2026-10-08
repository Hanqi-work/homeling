# Ticket 17 implementation notes

## Scope / approved seams
- 用户已批准公开前端/事件 seams；测试 HomeTriage 渲染、导航、GET 轮询生命周期，使用 DOM + fake transport，不访问真实服务/浏览器。
- 基线 integrate-v1 96bd5b2123bfd9d9e712c210a0b06495b9b053cc；独立 jj workspace ticket-17-triage-home，禁止修改 integration bookmark/主 checkout。

## Decisions
- 独立 HomeTriage，唯一主接线是 App slots.homeSummary；不改 App 结构及其他 slots/providers。
- requests 与 registry 同轮 GET；仅 pending 且真实 registry personaId 可匹配时计数，同 persona 多请求只计一次，但展示每个请求的上下文链接。
- 主 pane 导航 /persona/:id；task pane 导航 /persona/:id/p/:paneId（已有审批上下文路由）；不依赖 task 内存 store。
- 复用串行轮询，隐藏页面停止并废弃在途响应；显式 suspended seam 供 #19 接线。所有请求仅 GET，不发送 activity/续 lease。
- 等待 #15 green 真实归属契约；当前 personaId=workspaceId 错误不可当身份使用。

## Guidance
- 已加载 jj/tdd/browser-tools/modern-web-guidance/pre-implement；现代前端指导提示 skill 版本过期，未改配置；已读取 accessibility，React 官方文档确认 effect cleanup 丢弃旧响应。

## Deviations
- 无浏览器验收（用户禁止）；真机手机验收留人工。
