# Ticket #12 implementation notes

## Scope / authorized seams
用户已授权 API、持久化、前端 seams：memory GET/PUT（CAS）、Markdown 存储、kind 注入策略、persona-service launch/message、锁 dispatch/commit、独立编辑组件。TDD 逐切片；fake Herdr / bridge / 临时 fixture，不碰真实 agent、Collie 或服务。

## Decisions
- 独立 jj workspace / bookmark ticket-12-persona-memory，base ca826f05。安全门无敏感候选；身份 rolex <torolex@163.com> 对齐。
- memory 限定 facts/preferences/project 三个 Markdown 文档；路径不接受用户文件名。UTF-8 严格校验、字节限制、CAS 与跨实例互斥，失败不覆盖已有内容。
- pi 采用官方 append-system-prompt 参数与 Homeling 数据目录的冻结会话文件；仅识别简单、明确 pi launcher，复杂 shell/其他 kind 降级首条消息 prefix + unsupported 明示。运行中不热吸收。
- #11 负责壳，#12 只新增独立编辑组件和窄接线。#19 负责实际锁契约，最终合绿色 revision 后接实际 dispatch/commit；不以缺省system绕过。

## Dependencies
- #11 a1684f67586794c43，#19 a23ad61028907d541：已请求 actual service green revision。显式合入 a4750d62（MutationAdmission）和 9065918e7e70f9c493263b1d8c58bef4732e3f2d（scoped system capabilities）；尚不代表完整 #19 已验收。
- 已 merge integrate-v1 @ 3a322b2fc942b158e31ab97fbd02ea91315467cb（#9）。

## TDD / review findings
- store/API/strategy/session helper 公开seam按红→绿实现；fake pi executable 经 /bin/sh 真正执行生成命令，证明 apostrophe/空格路径参数可运行，仍不等于真机 pi。
- 顾问发现并修复：提交后读取损坏 sibling 导致已保存却400 → 提交前读并校验所有文档、提交后返回已构造结果；pi regex拒绝CR/LF；freeze复用严格Unicode/NUL校验，组合上限150KB。
- 首次锁拒绝不创建目录；临时写和rename分别dispatch，rename前失锁清理自身临时文件/锁/新建空目录，不抢他人的锁；commit后不撤销已完成保存。
- 前端独立PersonaMemoryEditor export(props personaId, optional fake fetcher)，16测试绿，#11槽由父统一接入。

## Message display follow-up seam
- session-memory.ts injectedMessagePresentation返回 daemon生成注入的精确证据：attemptId(CSPRNG UUID)、personaId、paneId、confirmationText全文、displayText原草稿、provenance=daemon-injection、historyBinding=required；原文无转换则不生成证据。重复同文/新pane产生独立attemptId；用户自己输入prefix保持其原草稿，绝不字符串strip。
- 服务响应须挂personaMessagePresentation，保留personaConfirmationText供现有delivery/history精确对账。此记录本身不是history entry绑定，也不授权替换任意同文历史；最终统一修复者须绑定具体TranscriptEntry.id + pane/session + attempt成功匹配，再只改展示文本，处理重复同文及重启。未持久化此展示映射、未声称注入气泡问题已完全解决。

## Deviations
- 真机 pi 验收留人工；自动化只证明 fake launch 的参数与冻结内容、注入策略和副作用门禁，不宣称真机验证。
