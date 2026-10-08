# Spec #1 续接实现记录

## 上下文
- 2026-10-08 从 `~/.agents/homeling-notes/HANDOFF.md` 续接；integration 为 `integrate-v1`，基线 a3500fa。
- 任务快照：`~/.agents/homeling-notes/issues-20261008-resume.json`；审查沉淀：`00-context.md`。

## 决策与因果
- 保留 #10 原 worktree 的未提交实现，不 reset、不覆盖；当前没有可续接子代理，由 opus 接手收尾。
- 已解锁 #8/#9/#21 并行推进，implementer 使用 fable/opus。
- 沿用 handoff 的 issue 交付流程：合入、验证、推送后评论并标记 ready-for-human；真机验收未完成不冒称通过、不自动关闭。
- 版本控制先完成 jj 接入核对：已有 colocated .jj，身份匹配 Git，.env 忽略生效且未发现被跟踪密钥。
- 不使用 dynamic workflow；不新建 PR。
- 用户在测试边界/许可/权限询问后原始确认：「全部授权，完全信任你。我现在要去睡觉，我醒来要看见你完成所有东西。」据此继续四票，选择 MIT（无既有冲突时）；已拒操作只有在此次真实用户新授权范围内才重试。
- 顾问建议 #10 后先冻结 #19 服务端写守卫契约，再并行 #11/#12/#13/#15；公共接线随合入串行，最终检查所有 PATCH/PUT/DELETE/POST 受锁保护。#17 首页接线等 #11，#16 等 #15，#18/#20 等 #11。
- #9 上游输入检查与按键写入非原子，不能宣称屏幕绑定消除所有竞态；危险可授权键优先禁用并明确解释，守住审批专属通道，不为交付冒称完整 AC。

## Deviations
- handoff 的 `wt`/原生 Git 修改命令与当前 jj 规则不一致，采用 jj 历史/bookmark 操作；工作目录必须隔离，已有 #10 worktree 保留。
