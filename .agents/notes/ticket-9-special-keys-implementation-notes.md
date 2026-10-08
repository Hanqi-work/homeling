# Ticket #9 special keys

## Boundaries

执行器确认的公共测试边界：daemon HTTP 写入口、前端 API、特殊键条交互。未称用户已确认；继承协调器安全收敛决定。

## Decisions

- 保留浏览器 raw `/keys` 禁令。新增固定语义 `/control-key` 入口，仅 `interrupt`→`ctrl+c`、`escape`→`Escape`。
- 上游 `expected_prompt` 是尾部连续区域匹配，并非原子条件输入。取消键也只用于已连接、非 blocked 的已知 pane；snapshot identity→screen→snapshot identity/status→带完整 expected_prompt 的 keys，已缓存 pending 也拒写。
- 前端确认取消操作、同步防双击，不走文本 send queue，不自动重试；HTTP 成功仅表示上游接受，不表示 TUI 消费。

## Deviations

- Enter、Cmd、任意 Ctrl 组合不开放：审批竞态不能原子防住，zero-touch 不修改 Collie。明确禁用及说明，不以假文本键代替。
- modern-web-guidance 已加载；其 npx 外部来源命令遭权限拒绝，未绕过。React 官方 useRef/useState 文档已通过 Context7 查证。

## Checks

- red→green：首个 daemon 入口返回 405（红）→绑定 Ctrl-C 真载荷（绿）；API 缺少导出（红）→单次语义写入（绿）；UI 缺组件（红）→确认/取消状态模型（绿）。
- 全套 217 tests 绿，类型检查与构建绿；其后补并发互斥/畸形响应回归，待最终复跑。
- 顾问复核：修复 identity key 重挂载丢失在途状态；SpecialKeyBar 保持 pane 生命周期，身份变化只取消确认，保留 busy/unknown。submitDraft 同步检查 controlBusyRef 后才清草稿。
- 简化审查无必须修项，保留安全校验与明确写前/写后错误分支，不为减少行数合并 unknown 逻辑。
- 真机遗留：手机经 Tailscale 点按 Ctrl+C/Escape，观察目标 TUI 行为；不在用户现有 pane 上自动执行取消键。Cmd/Enter 禁用是明确范围偏离，不宣称全部按键已验收。
