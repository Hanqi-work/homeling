---
status: accepted
---

# Persona 与 Herdr space 的生命周期

## Context

Persona 不是 pane：每个 persona 拥有一个 Herdr space 和一个长期主 pane；task pane 属于该 persona 的 space。创建、daemon 重启、pane 退出与删除必须保持这一关联，同时不收编既有 Collie spaces，也不直接改写 Herdr 状态文件。

## Decision

- 创建顺序为：读取 Collie 的 launcher allowlist → 通过 Herdr JSON-RPC 创建 space/root shell pane → 在 pane 中提交 allowlisted launcher → 原子写入 persona registry。只有 registry 提交成功后才公布 persona。
- 任一步失败都不保留 persona 记录。已知创建的 pane 尽力通过 `pane.close` 回滚；Herdr 没有可用的 workspace-close RPC，因此留下的空/部分 space 或 transport 结果不明的创建必须进入 registry 的 orphan 清单，不能伪装成成功 persona。
- daemon 启动后、Herdr 生命周期事件到达时以及周期对账时，以 `session.snapshot` 为运行时真相。主 pane 缺失但 space 存在时，复用 persona 保存的 launcher（仍须与当前 `launchers.toml` allowlist 精确匹配）在该 space 新建 tab/pane，并原子更新 `mainPaneId`；Herdr 不可用时不改 registry。若 space 本身消失，保留 persona 记录并报告不可自动恢复。
- `POST /lite/api/launch` 的 `personaId` 模式也只接受 allowlist 中精确匹配的 command，并在对应 persona 的 space 内创建 task tab/pane；旧任务不迁移。
- 删除的语义固定为：关闭该 persona 的主 pane、从活动 persona registry 中移除，并保留其 Herdr space；将 space 标记为 `[Archived] <name>`，同时在 registry 的 archive 索引中保留 spaceId 与归档时间。任务 pane 不被递归关闭；既有非 Homeling spaces 不受影响。
- `PATCH` 的 pause 只暂停 Homeling 通过 persona API 新发消息的能力，不杀掉已有 agent；改名同步更新 Herdr space label。

## Options considered

- **关闭整个 workspace**：当前核验的 Herdr bridge API 没有 workspace-close RPC；自行调用未验证命令会有关闭错误 space 的风险，拒绝。
- **物理删除 registry 前直接删掉关联信息**：无法解释保留空间或后续清理，拒绝；使用独立 archive/orphan 索引。
- **恢复时另建新 space**：会割裂 persona 历史与项目归属，拒绝；只在原 space 内新建 pane。

## Consequences

- persona、task、space 关联以 registry 的 `spaceId` 为持久映射；实时 pane 状态从 Herdr snapshot 投影，不将旧 task pane 自动迁移。
- 部分成功时 registry 可含孤儿/归档清单，但不得出现没有可用主 pane 的活动 persona。
- Herdr API 没有 workspace 删除能力是当前限制；孤儿空 space 可能需要人工清理，daemon 不修改 Herdr 状态文件。
