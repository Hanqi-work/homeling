# Ticket 17 implementation notes

## Scope / approved seams
- 用户已批准公开前端/事件 seams；测试 HomeTriage 渲染、导航、GET 轮询生命周期，使用 DOM + fake transport，不访问真实服务/浏览器。
- 基线 integrate-v1 96bd5b2123bfd9d9e712c210a0b06495b9b053cc；独立 jj workspace ticket-17-triage-home，禁止修改 integration bookmark/主 checkout。

## Decisions
- 独立 HomeTriage，唯一主接线是 App slots.homeSummary；不改 App 结构及其他 slots/providers。
- requests 与 registry 同轮 GET；仅 pending 且真实 registry personaId 可匹配时计数，同 persona 多请求只计一次，但展示每个请求的上下文链接。
- 主 pane 导航 /persona/:id；task pane 导航 /p/:paneId?occurrence=<trusted ledger UUID>，不依赖 task 内存 store。actual /persona/:id/p/:paneId 会重定向主聊，/t 暂无审批卡，故不可用于直达处理。
- task occurrence 使用 #13 durable ActivityResponse.occurrences append 顺序的最后同 pane 记录（不是时间戳，不倒退找旧 active）；再 GET activity/task/:key 全局权威确认 current/liveAvailable/live 及 UUID/pane/persona/space/active，未确认时保留计数并展示明确不可处理降级，不 fallback unscoped 写页。
- 已显式 merge #13 scoped API green 5a5c50895c473c5ee0ccb2e233b5a4ad1db398dc（非整票 ready）；复用共享 fetchActivity/fetchTaskOccurrence/ActivityTaskResponse，删去临时同义 API helper。
- #13/#19 合并冲突保留 scoped task 路径 + sessionMutationFetch、upstreamFetch/原 admission 派发门禁；保留 main Activity slot + AppRoot/SessionBoundary，不丢其他槽位。#13 Activity.interaction live 测试最小补 session ready fixture，非生产解锁。
- 复用串行轮询，隐藏页面停止并废弃在途响应；显式 suspended seam 供 #19 接线。所有请求仅 GET，不发送 activity/续 lease。
- 已显式 merge #15 green 0a579bf8ff4b65b578569de81305d56b0467a2db（含 #13/#19 契约依赖，非 #15 整票 ready），消费 optional 真实 personaId registry resolver；未改审批 id/signature。
- 显式 merge #19 actual root green d1c283cbe37ce2caa5a495ac72bb8525d3831266（非整票 ready）。main 保留 AppRoot/SessionBoundary 所有 Routes，只传 homeSummary SessionAwareHomeTriage。wrapper 消费 useSessionSnapshot，locked 或 !ready 时真实暂停，不仅 overlay。
- #19 合并冲突：daemon index 保留 #13 的只读 Activity routes，runtime 使用 #19 upstreamFetch；未把用户操作洗成 system。main 采用 AppRoot 真 root，不恢复旧 Routes。
- root fake-server DOM 证明初锁无 triage GET，unlock 只读 catch-up 未 ready 时 triage 不启动，ready 后启动，relock 隐藏并停止。suspended 清空旧数据，解锁等待本组件新读不闪回旧计数（红→绿）。
- 四轴 simplify-code 独立只读审查及 code-simplifier 复核：均无高置信简化问题，fix list 为空。
- TDD 首个测试红（缺组件），distinct + deep link 实现绿；task 实际入口纠正测试红→绿；trusted occurrence URL 测试红→绿；global current/liveAvailable 拒绝测试红→绿。
- 取消 fence：活动读取 await 后/每个 task lookup 前及 await 后检查 signal.aborted。忽略 abort 的 transport 旧响应曾触发额外 GET（红），修后活动回调 GET0、多请求中途锁定不启动第二 GET（绿）。
- actual #13 green 仅 /t 使用 ActivityTaskBoundary，/p 尚未消费 occurrence。已通知父/#15（其唯一负责 /p guard），新增真实 daemon ActivityLedger/handleRequest+fake bridge 联测，证明当下 /p 仍 raw history（红）；历史/wrong-pane/unknown 路由不得卡/composer/raw history 的测试亦红，等待 #15 additive green，禁止假称 URL 带 UUID 就安全。

## Guidance
- 已加载 jj/tdd/browser-tools/modern-web-guidance/pre-implement；现代前端指导提示 skill 版本过期，未改配置；已读取 accessibility，React 官方文档确认 effect cleanup 丢弃旧响应。

## Deviations
- 无浏览器验收（用户禁止）；真机手机验收留人工。
