# Spec #1 标签纠错与验收续接

## 决策与因果
- 用户指出全部实现票应由 agent 完成，要求恢复 ready-for-agent、逐票核验并继续 implement-spec/PR 流程；本轮 PR 请求取代此前不开 PR 的限制，不授权合 main 或实际部署。
- 仓库 triage 定义 ready-for-human 为需要人工实现，不能将其当作等待验收。前序批量标记及本轮沿用该判断均错误；20/20 代码集成不等于全部 AC 满足。
- 读取远端全部 21 票正文、标签及开放 PR，确认 #2–#21 错标 ready-for-human，#1 已为 ready-for-agent。批量 mutation 返回 HTTP 504，先独立读回确认 #2–#16 已生效，仅补写 #17–#21；最终读回全部 21 票 ready-for-agent、OPEN。未关闭或分配任何票。
- 原 fixer SendMessage 返回 No transcript found，当前暴露接口无法恢复旧 agent；原记录、workspace 和私有备份保留，备份 SHA256 与交接一致。用户最新要求继续流程后，由唯一 Opus 继任 fixer 原地接管现有七文件 RED WIP；不重建、不 reset、不另建并行写者、不读取代理原始日志。
- 独立只读验收者按 fresh 工单正文与既有证据整理 AC 矩阵，不从提交数或标签推断完成。继任 fixer 只写原独立 workspace，主独占 integration/tracker/PR。
- 已创建并读回 draft PR https://github.com/toRolex/homeling/pull/22：integrate-v1 → main，head 59ccc9882d773e1d1700db0cc7bc3b37f757a808。关闭引用只在合并时生效；未验收通过不得 ready/merge。远端 main 63ba44e3 是 integration 祖先，不是未集成的新变更。

## 验证
- 已有 integration 59ccc988 的 522 tests / 0 fail、typecheck/build、CI 通过；不覆盖未合入 fixer WIP。
- 标签纠错与 PR 创建已独立读回。逐票 AC 核对已完成，矩阵 `/Users/rolex/.agents/homeling-notes/spec-1-ticket-acceptance-recheck-20261009.md` 区分自动化覆盖、真实环境待证和明确实现缺口；#13/#17/#20 仅为条件性关闭候选。
- 继任 fixer 实际回执：七文件 WIP 与备份 MATCH；runtime 从复现 23/3 修到窄测 26/0；手动锁确认新增实际 AppRoot 交互回归通过。尚无最终 fulltests/typecheck/build 或合入证据，不能据此宣称全部修复。
- 窄顾问实际结论：#6 缺 launch 操作持久结果/终态清理确认；#9 缺原子 prompt-generation 校验并写键及 Cmd 契约；#16 缺可信 request generation 与可恢复事件游标。现 zero-touch 上游公共接口不足以证明相关 AC；已传唯一 fixer 补守卫公共入口回归，不通过猜测或放宽安全伪造闭环。
- PR #22 已更新并读回上述验收矩阵摘要、runtime 26/0 和能力阻塞，保持 draft。修复后全量验证、最终 UI 确认和新 tip CI 仍待执行。
- 最终 fixer 冻结 0e5c113e42e9f1b81b0285e543d1c7ea80eb7f1d，并 jj new 离开到空 child；主核身份、祖先、审查末 delta（与04f4846仅notes差异）、备份hash后串行合入，保留主纠错记录。主实际复验 528 tests / 0 fail、92files、6638assert；typecheck/build exit0。不是沿用实施者结果。
- 浏览器复用 space1/p1、ownership=agent，最新 dist 一批最终确认：快捷回复44px、Save真实Tab聚焦自动滚动避fixed nav；锁POST公开模拟失败时server unlocked、UI持续未确认告警；原对话idle-lock解锁保留草稿/路径且零重放；德语设置/新建、triage两人→模拟审批后1人、任务详情/raw mirror、unknown Retry原生风险确认取消及history503都不重发。截图与详细边界 `/private/tmp/homeling-final-ui-confirm-WmdEZ4/CONFIRMATION.md`。
- UI-only契约check/三套verify通过；公开fake无真实auth/handler/provider/设备保证。机械detector仅跑一次，变更五个TSX/CSS目标结果[]。locator/原生dialog属性/stale ref造成的自动化错误均先观察，不报告为产品失败。不创建新space、不碰用户tabs，不继续polish。

## CI 与 tracker 后续
- 首次主冻结/push 为 85ee3af1bd79fa74ac295d6fb16a8af5798f621c；已 jj new 离开。HTTPS push 两次 LibreSSL SSL_ERROR_SYSCALL 后先读回远端未更新；curl 与两种本机 Git 的只读 ls-remote 均可连接，按安装版 jj help 文档仅当次命令显式 git.executable-path=/opt/homebrew/bin/git 后推送成功。未持久改配置或关闭 TLS 校验，未证明根因就是二进制差异。Context7 resolve 当时 fetch failed，不声称官方文档查询成功。
- 两个同 SHA 新 CI 均 failure，实际 527/1：scripts/deployment-docs.test.ts:75 的 canary shell 正常 save→check 在Linux失败。本机528/0不代替CI；唯一fixer以85新child继续跨平台TDD，不skip/改pin/放宽守卫，不修改共享0e绿色。失败证据 `/tmp/homeling-final-ci-failure-Tynbpb`，run37934872845。
- Draft PR #22已更新失败与真实边界并readback。Spec #1、#12、#19新增评论并独立读回；所有21票仍 OPEN + ready-for-agent，不close、转人工或标PR ready。
- 原始freeze/WIP/stale/私有备份保留；space1已finish，自建QA监听18790已停止，最终UI不再重复polish。CI脚本局部修复不要求重做UI批。

## Deviations
- 原同 ID fixer 无法通过当前会话接口恢复；按用户最新继续实施要求，唯一继任实施者保留现场续接，未覆盖或删除原成果。不能将其描述为原 agent 成功恢复。
