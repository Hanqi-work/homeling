import { useEffect, useRef, useState, type ReactElement } from "react";
import { sendPaneControlKey, type ControlKeyAction, type ControlKeyResult } from "./api.ts";

interface KeyView {
  confirming: ControlKeyAction | null;
  busy: boolean;
  unknown: boolean;
  feedback: string;
}
const INITIAL: KeyView = { confirming: null, busy: false, unknown: false, feedback: "" };

/** UI gesture model: explicit confirmation, synchronous exclusion, and sticky uncertain writes. */
export class ControlKeyInteraction {
  view: KeyView = INITIAL;
  private until = 0;
  constructor(private readonly changed: (view: KeyView) => void) {}
  private update(patch: Partial<KeyView>): void {
    this.view = { ...this.view, ...patch };
    this.changed(this.view);
  }
  choose(action: ControlKeyAction): void {
    if (this.view.busy || this.view.unknown || Date.now() < this.until) return;
    this.update({ confirming: action, feedback: "" });
  }
  cancel(): void { this.update({ confirming: null }); }
  async confirm(write: (action: ControlKeyAction) => Promise<ControlKeyResult>): Promise<void> {
    const action = this.view.confirming;
    if (!action || this.view.busy || this.view.unknown || Date.now() < this.until) return;
    this.update({ confirming: null, busy: true, feedback: "正在发送按键…" });
    let result: ControlKeyResult;
    try { result = await write(action); }
    catch { result = { outcome: "unknown" }; }
    this.until = Date.now() + 750;
    this.update({ busy: false, unknown: result.outcome === "unknown", feedback:
      result.outcome === "accepted" ? "按键请求已接受；不代表程序已处理，请查看终端状态。" :
      result.outcome === "unknown" ? "按键结果未知；不要重复发送或刷新后重试，请检查终端。" :
      `按键未发送：${result.error ?? "请求被拒绝"}` });
  }
}

export function SpecialKeyBar({ paneId, identity, disabled, onBusyChange }: { paneId: string; identity: string | null; disabled: boolean; onBusyChange?: (busy: boolean) => void }): ReactElement {
  const [view, setView] = useState<KeyView>(INITIAL);
  const interaction = useRef<ControlKeyInteraction | null>(null);
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  if (!interaction.current) interaction.current = new ControlKeyInteraction((next) => {
    setView(next);
    busyCallback.current?.(next.busy);
  });
  const model = interaction.current;
  // A changed target invalidates confirmation, never an in-flight or uncertain write.
  useEffect(() => { model.cancel(); }, [model, identity, disabled]);
  const locked = disabled || !identity || view.busy || view.unknown;
  const buttonClass = "min-h-11 rounded-lg border border-neutral-700 px-3 text-xs text-neutral-200 disabled:opacity-40";
  return (
    <section aria-label="特殊键" className="border-t border-neutral-800 py-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass} disabled={locked} onClick={() => model.choose("interrupt")}>Ctrl+C</button>
        <button type="button" className={buttonClass} disabled={locked} onClick={() => model.choose("escape")}>Esc</button>
        <button type="button" className={buttonClass} disabled title="请通过绑定请求的审批卡操作">Enter</button>
        <button type="button" className={buttonClass} disabled title="任意组合键无法安全绑定审批">Cmd</button>
      </div>
      <p className="mt-1 text-xs text-neutral-500">仅发送取消键，不用于批准权限；发送前核对终端，但检查与发送非原子，状态仍可能变化。Enter / Cmd 请通过审批卡操作。</p>
      {disabled || !identity ? <p className="text-xs text-amber-300">当前状态未确认、正在发送或待审批，特殊键不可用。</p> : null}
      {view.confirming && !locked ? (
        <div role="group" aria-label="确认发送特殊键" className="mt-2 rounded-lg border border-amber-800 p-3 text-sm text-amber-200">
          <p>{view.confirming === "interrupt" ? "Ctrl+C 可能中断当前任务。" : "Esc 可能取消当前操作或关闭提示。"}不会发送草稿。确认发送？</p>
          <div className="mt-2 flex gap-2">
            <button type="button" className={buttonClass} onClick={() => model.cancel()}>取消</button>
            <button type="button" className={buttonClass} onClick={() => {
              if (!locked && identity) void model.confirm((action) => sendPaneControlKey(paneId, action, identity));
            }}>确认发送</button>
          </div>
        </div>
      ) : null}
      <p role="status" aria-live="polite" className="mt-1 text-xs text-amber-200">{view.feedback}</p>
    </section>
  );
}
