# GLOSSARY

> Homeling 的单一 domain 词汇表。只收术语与含义，不含实现细节；实现决策见 PRD 与 `docs/adr/`。

## 核心实体

**persona**
一个常驻人格：有名字、圆头 avatar（颜色 + 脸 + 可选宠物）、固定 system prompt、记忆文件，并绑定一个项目空间。用户可养多个（如"工作"、"生活"各一个），一个 persona 专注一类任务。对应 Dots 的 "dot"。

**persona daemon**
本机常驻服务：管理 N 个 persona 的定义、记忆与主动性（push 触发），下层调 herdr 派活，上层供前端调用。Homeling 的核心新代码。

**memory**
persona 的持久记忆，以 markdown 文件集合存在（facts / preferences / 项目笔记）。每次会话注入到 persona 之下运行的 agent 上下文中。

**activity**
一个 persona 的活动流：任务创建 / 完成 / 失败等事件的时间线。是前端 Activity 面板和主动 push 的数据来源。

## 与 herdr / Collie 的映射

**herdr**
现有 agent 编排器。层级：workspace > tab > pane；pane 里跑具体 agent 进程（claude code / codex / pi 等）。

**Collie**
现有 herdr 插件：Bun bridge（HTTP 轮询 JSON API + Web Push）+ 手机 PWA，经 Tailscale 暴露。Homeling 复用其 bridge，替换其前端。

**space**
Collie/herdr 的顶层分组。与 persona 一一对应。

**archived space**
已删除 persona 留下的 Herdr space。保留作为归档，不再属于活动 persona。

**project**
Collie/herdr 的 tab，在 persona 详情页呈现为"项目"分组（默认折叠）。与 tab 一一对应。

**task**
persona 的一次性工作 = 一个新 pane 里的 agent 会话。在对话流中渲染为任务 chip，展开为任务详情页。与 pane 一一对应；稳定 ID 使用 bridge 返回的 `paneId`。

**thread（主对话）**
用户与一个 persona 的日常对话 = 该 persona 专属的一个**长期常驻主 pane**（区别于派任务的短期 task pane）。N 个 persona 即 N 个主 pane；每个 persona 恰有一个，经 daemon 创建与寻址。

**agent kind**
pane 里实际运行的 agent 种类（claude code / codex / pi…）。persona daemon 与具体 kind 无关；记忆注入按 kind 适配。

## 前端 / 交付

**新 UI（/lite）**
Homeling 重写的消费级前端，挂 basePath `/lite` 与 Collie 旧 UI 共存。旧 UI 保留为排查保险丝。

**triage**
"N 个伙伴需要你"的汇总状态：agent 被 permission/option 提示阻塞时浮出到首页，直达处理。

**needs-you**
某个 agent 正等待用户输入（权限批准 / 选项选择）的状态。

**launcher 行**
`launchers.toml` allowlist 中的一条启动命令。persona 派任务（launch 新 pane）只能使用 allowlist 内的行。

## 部署不变量

**zero-touch**
Homeling 与 Collie 的共存原则：Homeling 不向 Collie 安装目录写任何文件、不改 bridge 代码、不重编译其二进制。可证伪不变量：`git -C ~/.local/share/collie status` 永远干净。新 UI 与 persona API 由 daemon 经 `tailscale serve` 的 `/lite/` path 独立暴露；见 ADR-0004。

**路径分流**
tailscale serve 同一 listener 上的 path→本地端口映射（`/` → bridge :8787，`/lite/` → daemon :8790）。是配置层动作，Homeling 只增删自己的 `/lite/`，永不写根 handler。

## 明确不是什么

- **persona ≠ pane**：一个 persona 下有多个 task（panes），不是一格一人。
- **persona ≠ 换皮**：persona daemon 是新代码，前端只是它的 view。
- **Homeling ≠ Collie fork（产品意义上）**：Collie bridge 只做 additive 改动；Homeling 的身份是 persona 层 + 消费级前端。
