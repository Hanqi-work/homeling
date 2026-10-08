# Ticket #15 implementation notes

## Scope / authorized seams
- 用户已授权 public API、持久化、协调器、前端 seam。TDD 按 store / transport / output+clock / HTTP / SW handler 公共边界逐切片。
- 独立 workspace：homeling.ticket-15-push，base ca826f0528dc7760f631bddb63efa67f2cc24a61。仅 ticket-15-push bookmark；不动 integration、不发布、不启服务、不外发真实 push、不读既存秘密。
- #13 owns trusted events / task ownership / occurrenceKey；等待 frozen interface 后接线，不用 snapshot 推历史。
- #19 owns actual lock actor/commit/dispatch；业务 push 写受锁，系统已配置通知窄 actor、不续租。#11 owns settings shell。
- #16 owns debounce/coalesce/reliability；这里只交最小立即输出与持久去重/取消未发送。

## Decisions
- 独立 VAPID 存 external data-dir，0600/0700；只返回 public key。web-push per-request vapidDetails，绝不用共享全局 setVapidDetails，不碰 Collie。
- retract 取消未派发；SW 可按 tag 尝试本机关闭；不保证已发送跨设备撤回。
- secret 安全门仅枚举文件名，无实际秘密路径；.env/.env.* ignore 生效；身份 rolex / torolex@163.com 一致。

## Deviations
- jj workspace add --ignore-working-copy 实际建空 root workspace 后拒绝更新；只在独立新 workspace 新建指定 base change 并移动自有 bookmark，主 checkout untouched。
- modern-web-guidance 已调用；版本过期，查询无 push 专属指南（不擅改用户 skill）。库API由 Context7 官方 web-push 文档补齐。
