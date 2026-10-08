# Ticket #12 implementation notes

## Scope / authorized seams
用户已授权 API、持久化、前端 seams：memory GET/PUT（CAS）、Markdown 存储、kind 注入策略、persona-service launch/message、锁 dispatch/commit、独立编辑组件。TDD 逐切片；fake Herdr / bridge / 临时 fixture，不碰真实 agent、Collie 或服务。

## Decisions
- 独立 jj workspace / bookmark ticket-12-persona-memory，base ca826f05。安全门无敏感候选；身份 rolex <torolex@163.com> 对齐。
- memory 限定 facts/preferences/project 三个 Markdown 文档；路径不接受用户文件名。UTF-8 严格校验、字节限制、CAS 与跨实例互斥，失败不覆盖已有内容。
- pi 采用官方 append-system-prompt 参数与 Homeling 数据目录的冻结会话文件；仅识别简单、明确 pi launcher，复杂 shell/其他 kind 降级首条消息 prefix + unsupported 明示。运行中不热吸收。
- #11 负责壳，#12 只新增独立编辑组件和窄接线。#19 负责实际锁契约，最终合绿色 revision 后接实际 dispatch/commit；不以缺省system绕过。

## Dependencies
- #11 a1684f67586794c43，#19 a23ad61028907d541：已请求 actual contract / green revision。

## Deviations
- 真机 pi 验收留人工；自动化只证明 fake launch 的参数与冻结内容、注入策略和副作用门禁，不宣称真机验证。
