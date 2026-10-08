# Ticket #11 implementation notes

## Decisions
- 用户授权 public API / 持久化 / 前端行为 seams；测试卡片真实状态与 transcript 最近一句、路由/插槽、删除 API 结果及资源保留语义，采用逐切片 red-green。
- 独立 workspace `/Users/rolex/Documents/Codes/githubProject/MyProject/homeling.ticket-11-persona-home`；base ca826f0528dc7760f631bddb63efa67f2cc24a61；bookmark ticket-11-persona-home。secret ignore、Git/jj 身份均核验。
- 显式依赖 #19 contract-only revision a4750d622dd6dc8ad8508d386b0b0a65b69f1644（session-lock.ts）；未声称全票完成，不自行生成 system actor/bypass。#11复用现有 daemon DELETE，不增加用户写旁路，完整业务门禁依赖 #19 集成。
- App slots（homeSummary、memory(personaId)、activity(personaId)、customize(personaId)、settings）隔离后续票；未接入能力明确提示不可用。主对话路由不变，详情 /persona/:id/details；底栏 /、/new、/settings。settings 可接 React fragment 容纳多设置。
- 首页只显示 daemon registry persona，不收编 Collie panes；最近一句只从主 pane transcript 的非 abandoned user/assistant text 获取，不把 terminal title/thinking/tool 当成说话。
- 状态用现有真实 runtime projection；读取失败明确数据过期，不继续宣称实时 Thinking。
- 删除沿 ADR-0006：主 pane关闭；space保留归档；task不关闭。HTTP成功但 archived:false 明示归档命名失败；网络失败不可断言未执行，提示核对。
- 原生 dialog showModal 提供焦点约束/Escape；路由可深链接。现代指南已查询（本机 skill过期，未自行更改配置）。

## Deviations
- workspace add带 --ignore-working-copy 部分创建后失败，新工作区最初在root；只重定位自己的空change到指定ca826f05，未修改主checkout/integration bookmark。

## Verification
- 待逐切片实现、简化及独立review；不启动真实Collie/Herdr、不变更服务、不声称真机验过。
