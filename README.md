# Homeling

住在自己电脑上的 AI 伙伴，手机上对话、派任务、审批、查看结果。目标是 Dots / Grok Bot / Muse 式的 persona agent；基于已有 herdr / Collie，**不是 Collie fork，也不替换旧 UI**。

**当前是开发中的 v1，不是正式发布。** 已接线的能力包括 pane 对话流（markdown/工具 trace）、显式发送与 history 送达确认、快捷回复、权限/选项卡片、allowlist 派任务、任务详情/只读终端镜像/中断、PWA 基础。persona、记忆、Activity、STT、特殊键、push、triage、头像/动效、idle-lock 和多语言由后续票增量补齐；本 README 随合入更新。PWA 真机安装与通知不能仅凭单元测试认定完成；**目前不提供 Homeling 自持 push**。

正式发布门禁：完成 [PRD §9](PRD.md#9-v1-功能清单验收基线) 全部必选能力，并通过对应设备验收。README / LICENSE 就位不等于 v1 已发布。

## 架构

Bun + TypeScript daemon 独立监听 `127.0.0.1:8790`，托管 React 19 / Vite 前端构建产物 `apps/web/dist`。手机经 Tailscale HTTPS 同源访问 `/lite/` 和 `/lite/api/*`；daemon 自持 Host / Origin / trusted-user 鉴权，并按窄白名单反代本机 Collie bridge `127.0.0.1:8787`。Collie 仍占据根 `/`，herdr 仍运行 agent panes。目标实体映射为 persona ↔ space、project ↔ tab、task ↔ pane，每 persona 一个长期主 pane；尚未交付的 registry / memory / push 不应当作当前 API。见 [GLOSSARY](GLOSSARY.md)、[ADR-0004](docs/adr/0004-zero-touch-no-collie-writes.md)、[ADR-0005](docs/adr/0005-bridge-api-reverse-proxy.md)。ADR-0001 只沿用独立 launchd 宿主设计，其旧 bridge 反代部署方案已由 ADR-0004/0005 取代。

```text
手机（tailnet） → Tailscale Serve HTTPS :443
                    ├─ /       → Collie bridge :8787（原样）
                    └─ /lite/  → Homeling daemon :8790
                                    ├─ apps/web/dist
                                    └─ /lite/api/* → 鉴权 / daemon 路由 / 窄 bridge 反代
```

## 自部署（macOS 用户登录会话）

### 1. 前置条件

- macOS、已登录的图形用户会话；launchd user agent 不是开机未登录服务。机器须保持在线/唤醒，睡眠时手机不可用。
- Bun（支持本仓库 lockfile；CI 使用 latest）、Git、`curl`、`shasum`，以及 PATH 中可用的 `tailscale` CLI。
- herdr / Collie **已独立安装并正常运行**，bridge 默认监听 `127.0.0.1:8787`；Collie checkout 默认 `~/.local/share/collie`，`bin/collie` 存在且工作区干净。
- Mac 和手机加入同一 tailnet，MagicDNS / HTTPS 证书可用，tailnet 策略允许手机访问 Mac HTTPS。只用 Serve，**不启用 Funnel**。
- `tailscale serve status --json` 中原有 HTTPS `:443` 的 `/` handler 指向 `http://127.0.0.1:8787`。不满足时先修复原有 Collie 部署，不让 Homeling 重设根 handler。
- 需要派任务时，先在 Collie 既有配置入口配置 `launchers.toml` allowlist 和 agent 凭据；Homeling 仅选择现有 launcher 行，不替你改 Collie 文件。

```bash
tailscale serve status --json
curl -fsS http://127.0.0.1:8787/api/snapshot
```

本地 snapshot 检查仍受 Collie 自己的鉴权配置约束。原版 Collie 的安装、配对和 provider 凭据不是本仓库管理范围。

### 2. 获取源码并检查

```bash
git clone https://github.com/toRolex/homeling.git
cd homeling
bun install --frozen-lockfile
bun run typecheck
bun test
bun run build
```

必须选择包含所需实现的 revision；未正式发布前不要假定默认分支等于 integration 开发进度。构建结果只在 `apps/web/dist`，不复制进 Collie。以下命令都在仓库根目录执行。

### 3. 配置身份并安装 daemon

将示例替换为**实际 Tailscale 登录名**与本机完整 MagicDNS 域名（无 scheme、端口或尾斜线）。登录名不是机器昵称，也不是显示姓名；应与 Serve 注入的 `Tailscale-User-Login` 完全一致。多个用户用逗号分隔，且这些用户访问 bridge 时也须满足 Collie 自己的权限。

```bash
export HOMELING_TRUSTED_USERS='you@example.com'
export HOMELING_TAILSCALE_HOST='your-mac.tailxxxx.ts.net'
export HOMELING_PORT=8790
bash scripts/install-launchd.sh
launchctl print "gui/$(id -u)/com.homeling.daemon"
curl -fsS http://127.0.0.1:8790/lite/api/health
```

正确安装入口是 `bash scripts/install-launchd.sh`，不是不存在的 workspace `install:launchd` script。脚本写入 `~/Library/LaunchAgents/com.homeling.daemon.plist`，记录 Bun 与 daemon entry 的绝对路径，配置 `RunAtLoad` / `KeepAlive`，日志位于 `~/.local/share/homeling/log/daemon.{out,err}.log`。不要用 `sudo` 安装此用户 agent。

**环境持久化边界**：安装脚本将 `HOMELING_PORT`、非空 `HOMELING_TRUSTED_USERS` 和 `HOMELING_TAILSCALE_HOST` 写入 plist 的 `EnvironmentVariables`；后续 shell export 不会改变已运行的 agent。修改它们后须带着完整配置重新运行安装脚本。重装会覆盖 plist，漏传身份配置会使远程访问 fail-closed。脚本不设置 WorkingDirectory，不依赖根目录 `.env`，也不自动持久化全部 shell 环境。

| 变量 | 默认 / 用途 | 安装脚本持久化 |
| --- | --- | --- |
| `HOMELING_PORT` | `8790`，daemon 始终绑定 loopback | 是 |
| `HOMELING_TRUSTED_USERS` | 空，拒绝远程用户；逗号分隔登录名 | 非空时 |
| `HOMELING_TAILSCALE_HOST` | 空，只允许本地 Host；填完整 DNS 名 | 非空时 |
| `HOMELING_REPO` | 安装脚本所在仓库；可指定绝对路径 | 通过 daemon entry 路径体现 |
| `HOMELING_WEB_DIST` | 本仓库 `apps/web/dist` | 否，仅 daemon 环境支持 |
| `HOMELING_BRIDGE_ORIGIN` | `http://127.0.0.1:8787`，仅支持 loopback HTTP origin | 否，仅 daemon 环境支持 |
| `HOMELING_ALLOW_ANY_HOST` | 关闭；不要在部署时打开 | 否 |

推荐保持默认端口/产物/bridge 地址。非默认 `WEB_DIST` / `BRIDGE_ORIGIN` 需自行在 plist 中明确配置并重新加载，单纯 export 后运行安装脚本不生效。不要关闭 Host 检查来解决 403。

### 4. 添加 `/lite/` 分流（保留根路径）

先保存金丝雀基线，再仅添加本项目的 handler。金丝雀需要 Bun / Git / Tailscale，默认面向单个 Serve listener。

```bash
export HOMELING_CANARY_STATE="$HOME/.local/share/homeling/canary-state.env"
bash scripts/canary.sh save
tailscale serve --bg --https=443 --set-path=/lite/ 8790
tailscale serve status --json
HOMELING_CANARY_DAEMON_URL=http://127.0.0.1:8790 bash scripts/canary.sh check
```

确认 `/` 仍指向原 Collie，`/lite/` 指向 `8790`。不要执行全局 Serve reset、覆写 `/` 或修改 `herdr.collie.plist`。如有自定义 Collie checkout，给 save/check 同时设置 `COLLIE_DIR`。保存基线前就须确认 Collie 干净、二进制存在、根 handler 正确：`save` 记录状态，**并不验证这些前置条件**。

在手机浏览器打开 `https://your-mac.tailxxxx.ts.net/lite/`，进入对话，再刷新深链接。再打开根路径确认旧 UI、旧通知仍正常。缺失/非 trusted 身份应被拒绝；**本地 curl 成功不能代替通过真实 Tailscale 入口的身份验收**。daemon health 仅证明 daemon 活着，不代表 bridge / agent 可用。

### 5. 重启与设备验收

```bash
launchctl kickstart -k "gui/$(id -u)/com.homeling.daemon"
HOMELING_CANARY_DAEMON_URL=http://127.0.0.1:8790 bash scripts/canary.sh check
```

daemon 启动可能需要片刻，若立即检查失败，先查 launchd / 日志，再重试。重启后手机再次打开 `/lite/`，刷新对话深链接，并检查根 UI。**canary 不会触发或证明重启**：它比较 Collie 工作区、二进制 mtime+SHA256、根 handler；设定可选 URL 后只多做一次 health 请求。它记录 Collie HEAD 但当前 `check` 不比较 HEAD。不要把它称作完整设备/通知回归。

手机走一轮“派活 → 审批 → 收结果”；确认发送正文进入 history 后才显示“已送达”（HTTP 2xx 不等于 agent 已消费）。中断按钮仅请求 Ctrl+C，不关闭 pane，不保证进程已终止，后续状态才是依据；launch 超时也不证明上游已回滚，残留需查看原始 pane / 旧 UI 排查。

PWA 可在手机浏览器添加到主屏；Service Worker 范围应仅为 `/lite/`。当前更新检测仅写 console，并提供调试入口 `window.__homelingApplyUpdate()`，**没有用户可见的更新提示或刷新按钮**。图标/安装/离线表现与根路径 SW 共存仍需实际设备验收；不宣称离线 agent 工作、锁屏 push 或 idle-lock 已完成。

## 更新与卸载

更新源码应使用你自己的版本控制流程，保留本地修改；此票不执行 push / 合入 / 正式发布。源码路径不变时，按下列流程构建并重启。Bun 安装位置或仓库路径改变时，先带完整身份配置重跑安装脚本。

```bash
bash scripts/canary.sh save
bash scripts/build-web.sh
launchctl kickstart -k "gui/$(id -u)/com.homeling.daemon"
HOMELING_CANARY_DAEMON_URL=http://127.0.0.1:8790 bash scripts/canary.sh check
```

`build-web.sh` 冻结安装依赖并构建 web，只写本仓库。更新后手动刷新并核对版本；若新 SW 仍处于 waiting，普通刷新未必切换版本，当前需通过浏览器调试入口调用 `window.__homelingApplyUpdate()`，再验证页面更新。排障时可仅清理 `/lite/` 的缓存/SW，不注销 Collie 根 SW。更新前后金丝雀命令使用同一 `HOMELING_CANARY_STATE`。

卸载只删自己的 handler 与 user agent，不动 Collie，也不终止已有 herdr panes：

```bash
bash scripts/canary.sh save
tailscale serve --https=443 --set-path=/lite/ off
launchctl bootout "gui/$(id -u)/com.homeling.daemon"
rm "$HOME/Library/LaunchAgents/com.homeling.daemon.plist"
bash scripts/canary.sh check
```

agent 若已停止，bootout 可能提示找不到服务，先确认状态。日志与 canary 基线在 `~/.local/share/homeling`，默认保留；备份后可自行删除。源码与 `apps/web/dist` 可自行移除，不需要恢复 Collie 文件。

## 开发与 CI

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
bun run build
```

[CI](.github/workflows/ci.yml) 在 Linux 上执行这四项，覆盖仓库现有各票测试，包括部署 README 命令一致性与隔离的 installer smoke。CI 不会访问真实 Collie、修改 Tailscale、运行 macOS launchd 或验证手机通知，因此“CI 全绿”不替代真机验收，也不证明待实现票已完成。

本地调试入口：

```bash
bun run dev:daemon
# 另一个终端
bun run dev:web
```

Vite 当前开发代理直连 bridge，是开发便利入口，**不是 daemon 鉴权/部署的等价验收路径**。要验证真实部署边界，请构建后使用 daemon `/lite/`，经 Tailscale 访问，不要把 Vite 端口暴露给手机当正式部署。

## Zero-touch 与安全

- 不写 `~/.local/share/collie/`，不改 bridge，不重编译 `bin/collie`；无 patch / rsync 部署路线。安装只写 Homeling plist 与日志目录，构建只写本仓库产物。
- Tailscale 共享配置仅增删 `/lite/`；根 `/`、旧 UI、旧通知配置保持原样。未来 Homeling push 也须独立于 Collie 通道，不能代用户静音旧通知。
- daemon 仅监听 loopback；远程请求必须有可信登录身份和配置的 Host。直连 loopback 的健康检查允许本机访问，是有意的本地信任边界，不是未鉴权远程入口。
- 写请求受 Origin / JSON body 门禁和窄路由限制；不要扩大反代到任意 `/api/*`，不要以公网反代或 Funnel 替代 tailnet。
- `.env` / `.env.*`（示例除外）、日志、产物被忽略；不要提交 provider token、tailnet 密钥、真实 transcript 或 push 私钥。忽略规则不能清除已提交秘密；检查差异与历史，发现泄漏应先轮换凭据再处理历史。
- 本项目安装脚本与 canary 不收集/上传凭据。业务流复用 Collie / agent API，模型请求与内容处理仍遵循所选 provider 的政策。

## 常见问题

| 表现 | 优先检查 |
| --- | --- |
| `/lite/` 401 | trusted-user 是否为真实登录名；Tailscale 是否注入身份；重装时是否漏传配置 |
| `/lite/` 403 | plist 中 DNS 名是否正确；请求 Host / Origin 是否匹配；不要打开 allow-any-host |
| 静态页面 404 / 空白 | `bun run build` 是否成功，`apps/web/dist/index.html` 是否存在 |
| 页面可用但对话 502 | bridge 是否在线，loopback 8787 是否可访问，Collie 自身鉴权是否允许该用户 |
| launch 被拒绝 | launcher command 是否与 allowlist 精确一致，agent 及其凭据是否已配置 |
| launchd 起不来 | `launchctl print`、daemon.err.log；plist 的绝对 Bun / repo 路径是否仍有效 |
| canary 失败 | 停止继续部署；查清 Collie 工作区/二进制/根 handler 变化，不自动 reset 或清理 Collie |

## 许可证

[MIT](LICENSE)，Copyright (c) 2026 rolex。许可证仅覆盖本仓库；Collie、herdr 与各依赖保留各自许可证，部署不复制或重新许可它们。
