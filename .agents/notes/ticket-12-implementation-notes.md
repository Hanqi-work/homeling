# Ticket #12 implementation notes

## Scope / authorized seams
用户已授权 API、持久化、前端 seams：memory GET/PUT（CAS）、Markdown 存储、kind 注入策略、persona-service launch/message、锁 dispatch/commit、独立编辑组件。TDD 逐切片；fake Herdr / bridge / 临时 fixture，不碰真实 agent、Collie 或服务。

## Decisions
- 独立 jj workspace / bookmark ticket-12-persona-memory，base ca826f05。安全门无敏感候选；身份 rolex <torolex@163.com> 对齐。
- memory 限定 facts/preferences/project 三个 Markdown 文档；路径不接受用户文件名。UTF-8 严格校验、字节限制、CAS 与跨实例互斥，失败不覆盖已有内容。
- pi 采用官方 append-system-prompt 参数与 Homeling 数据目录的冻结会话文件；仅识别简单、明确 pi launcher，复杂 shell/其他 kind 降级首条消息 prefix + unsupported 明示。运行中不热吸收。
- #11 负责壳，#12 只新增独立编辑组件和窄接线。#19 负责实际锁契约，最终合绿色 revision 后接实际 dispatch/commit；不以缺省system绕过。

## Dependencies
- #19 显式合入 a4750d62（MutationAdmission）、9065918e7e70f9c493263b1d8c58bef4732e3f2d（scoped system capabilities）、2bd322514809197ded5a5bb655537872b3bbf4ea（mandatory service/HTTP guards）及 72f573300b5a0a17ad67a93be5fa59c8c47788fd（runtime 不缓存请求 admission）。不是声称完整 #19 已验收。
- #11 显式合入 ddd9d6bf88c5e74df627a34b4e297795b1f36675 绿色 shell contract；main.tsx仅追加独立Editor import和slots.memory，未改App/首页壳；最终须包含#11后续修复及integration latest。
- 初始 base ca826f05；已 merge integrate-v1 @ 3a322b2fc942b158e31ab97fbd02ea91315467cb（#9），最终 merge integration latest @ 96bd5b2123bfd9d9e712c210a0b06495b9b053cc（#11 最终 e9d9ddb 已合）。

## TDD / review findings
- store/API/strategy/session helper 公开seam按红→绿实现；fake pi executable 经 /bin/sh 真正执行生成命令，证明 apostrophe/空格路径参数可运行，仍不等于真机 pi。
- 顾问发现并修复：提交后读取损坏 sibling 导致已保存却400 → 提交前读并校验所有文档、提交后返回已构造结果；pi regex拒绝CR/LF；freeze复用严格Unicode/NUL校验，组合上限150KB。
- 首次锁拒绝不创建目录；临时写和rename分别dispatch，rename前失锁清理自身临时文件/锁/新建空目录，不抢他人的锁；commit后不撤销已完成保存。
- 前端独立PersonaMemoryEditor export(props personaId, optional fake fetcher)，16测试绿；已在独立workspace main.tsx两行窄接#11memory slot，父/merger协调保留其他slots。
- actual service/API五个测试红→绿：pi create/recovery读取冻结文件且普通消息不加prefix；fallback保存后旧session不吸收、恢复新session读取；unknown跨解锁/daemon registry重建仍sticky不重放；shell readiness失锁禁止launcher派发；HTTP GET纯读、PUTsession/Origin双门禁。
- 消息派发前以用户admission实际提交durable unknown意图；已派发unknown/partial保留sticky，明确接受/拒绝仅登记该尝试结果。未派发锁拒绝只清自身意图，不改其他字段，不赋system。新pane恢复显式重置旧会话状态，不重放原消息。
- 简化四轴审查：复用0项；采纳mergeDrafts、writeExclusiveFile、strategy metadata分离及底层errno分类4项；跳过跨阶段祖先stat去重，保留安全检查。独立模块12绿、UI16绿。
- 完整依赖组合全量检查：327 tests / 54 files 通过，bun run typecheck、bun run build通过（待最终integration merge后复跑）。交付顾问静态复核无具体阻塞；独立code-reviewer（af518980b30b0c514）终审0阻塞，另跑33个fake/临时fixture测试全绿。
- #19升级后#8 STT/#9 control-key旧测试仍走未解锁入口；只迁移为显式fake认证fixture，保留原缺identity/Origin拒绝负例，不改生产guard。macOS临时fixture先realpath，避免系统/var别名触发严格symlink拒绝。

## Message display follow-up seam
- session-memory.ts injectedMessagePresentation返回 daemon生成注入的精确证据：attemptId(CSPRNG UUID)、personaId、paneId、confirmationText全文、displayText原草稿、provenance=daemon-injection、historyBinding=required；原文无转换则不生成证据。重复同文/新pane产生独立attemptId；用户自己输入prefix保持其原草稿，绝不字符串strip。
- 服务响应须挂personaMessagePresentation，保留personaConfirmationText供现有delivery/history精确对账。此记录本身不是history entry绑定，也不授权替换任意同文历史；最终统一修复者须绑定具体TranscriptEntry.id + pane/session + attempt成功匹配，再只改展示文本，处理重复同文及重启。未持久化此展示映射、未声称注入气泡问题已完全解决。

## Deviations
- 真机 pi 验收留人工；自动化只证明 fake launch 的参数与冻结内容、注入策略和副作用门禁，不宣称真机验证。所有测试仅temp/fake，不操作真实agent、Collie秘密/服务。完整#19解锁UI/凭据bootstrap仍由其票负责，#12已消费actual绿色服务契约，未配置凭据拒写。
- 按用户unknown/partial sticky要求，将#10旧partial后允许下一条消息的契约收紧为409，精确confirmation仍保留。GET/解锁不清sticky；只有对应旧pane消失且新会话恢复后reset，不自动重放旧消息。
- 本票注入 persona长期主pane会话；一次性task pane的会话上下文未收编为persona主记忆编辑/注入路径，仍保持原任务契约。

## Manual acceptance / env
- 新增HOMELING_MEMORY_DIR；默认HOMELING_DATA_DIR/memory，未指定data-dir时~/Library/Application Support/Homeling/memory。只daemon环境支持，installer不自动持久化该变量；README写明绝对路径/0700/0600/无symlink。
- 本机操作者先按#19完成解锁凭据配置；手机persona详情Memory编辑facts/preferences/project保存，当前pane不吸收；真实pi新会话询问事实并确认可引用。另验证unsupported首msgprefix提示及锁后保存拒绝/解锁不重放。未实际执行这些真机步骤。
- presentation mapping精确history entry绑定属最终统一修复pointer，不能宣称注入正文气泡已隐藏；不得strip用户自行输入同样prefix。
