# Collie bridge 只做可插拔 additive patch

## Status

accepted

Homeling 建立在 Collie 之上但不替代它：同一个人可以只装原版 Collie，也可以装 Collie + Homeling，两者不冲突。而本地的 Collie checkout 是 detached managed checkout，`collie update` 会 `git checkout --force` 丢弃所有 git-tracked 文件的本地编辑（`cli/update.ts:784`）。因此：对 bridge 的一切改动（通知摘要、persona 反代、`/lite` 深链接 fallback）都以 additive patch 形式存放在 homeling 仓库的 `patches/`，由 deploy 脚本在 Collie checkout 上应用；update 冲掉后重跑 apply 即恢复。同时尽量向上游提 PR，让补丁集趋零。

## Considered Options

- **直接改 `~/.local/share/collie/`**：被 self-update 覆盖，出局。
- **fork Collie 作为主仓**：使 Homeling 与上游强耦合，违背"不替代 Collie"。

## Consequences

- bridge 改动后需 `collie build` + restart 才生效（bridge 编译进二进制）；`web/dist` 例外，读盘即生效、免重启。
- 旧 UI、原版功能零破坏是硬约束：不改既有 API 契约，只加字段/端点。
