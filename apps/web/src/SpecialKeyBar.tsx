import { useEffect, useRef, useState, type ReactElement } from "react";
import { sendPaneControlKey, type ControlKeyAction, type ControlKeyResult } from "./api.ts";
import { useLocale } from "./locale.tsx";
import type { LocalizedCopy } from "./ui-copy.ts";

interface KeyView {
  confirming: ControlKeyAction | null;
  busy: boolean;
  unknown: boolean;
  feedback: string;
  copy?: LocalizedCopy;
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
    this.update({ confirming: action, feedback: "", copy: undefined });
  }
  cancel(): void { this.update({ confirming: null }); }
  async confirm(write: (action: ControlKeyAction) => Promise<ControlKeyResult>): Promise<void> {
    const action = this.view.confirming;
    if (!action || this.view.busy || this.view.unknown || Date.now() < this.until) return;
    this.update({ confirming: null, busy: true, feedback: "正在发送按键…", copy: { key: "specialKey.sending" } });
    let result: ControlKeyResult;
    try { result = await write(action); }
    catch { result = { outcome: "unknown" }; }
    this.until = Date.now() + 750;
    this.update({ busy: false, unknown: result.outcome === "unknown", copy: result.outcome === "accepted" ? { key: "specialKey.accepted" } : result.outcome === "unknown" ? { key: "specialKey.unknown" } : { key: "specialKey.notSent", params: { error: result.error ?? "" } }, feedback:
      result.outcome === "accepted" ? "按键请求已接受；不代表程序已处理，请查看终端状态。" :
      result.outcome === "unknown" ? "按键结果未知；不要重复发送或刷新后重试，请检查终端。" :
      `按键未发送：${result.error ?? "请求被拒绝"}` });
  }
}

export function SpecialKeyBar({ paneId, identity, disabled, onBlockedChange, occurrenceKey }: { paneId: string; identity: string | null; disabled: boolean; onBlockedChange?: (busy: boolean) => void; occurrenceKey?: string }): ReactElement {
  const { t } = useLocale();
  const [view, setView] = useState<KeyView>(INITIAL);
  const interaction = useRef<ControlKeyInteraction | null>(null);
  const busyCallback = useRef(onBlockedChange);
  busyCallback.current = onBlockedChange;
  if (!interaction.current) interaction.current = new ControlKeyInteraction((next) => {
    setView(next);
    busyCallback.current?.(next.busy || next.unknown);
  });
  const model = interaction.current;
  // A changed target invalidates confirmation, never an in-flight or uncertain write.
  useEffect(() => { model.cancel(); }, [model, identity, disabled]);
  const locked = disabled || !identity || view.busy || view.unknown;
  const buttonClass = "min-h-11 rounded-lg border border-neutral-700 px-3 text-xs text-neutral-200 disabled:opacity-40";
  return (
    <section aria-label={t("specialKey.label")} className="border-t border-neutral-800 py-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass} disabled={locked} onClick={() => model.choose("interrupt")}>Ctrl+C</button>
        <button type="button" className={buttonClass} disabled={locked} onClick={() => model.choose("escape")}>Esc</button>
        <button type="button" className={buttonClass} disabled title={t("specialKey.useApprovalCard")}>Enter</button>
        <button type="button" className={buttonClass} disabled title={t("specialKey.unsafeCombination")}>Cmd</button>
      </div>
      <p className="mt-1 text-xs text-neutral-500">{t("specialKey.safetyHint")}</p>
      {disabled || !identity ? <p className="text-xs text-amber-300">{t("specialKey.unavailable")}</p> : null}
      {view.confirming && !locked ? (
        <div role="group" aria-label={t("specialKey.confirmationLabel")} className="mt-2 rounded-lg border border-amber-800 p-3 text-sm text-amber-200">
          <p>{t(view.confirming === "interrupt" ? "specialKey.interruptConfirmation" : "specialKey.escapeConfirmation", { key: view.confirming === "interrupt" ? "Ctrl+C" : "Esc" })}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" className={buttonClass} onClick={() => model.cancel()}>{t("common.cancel")}</button>
            <button type="button" className={buttonClass} onClick={() => {
              if (!locked && identity) void model.confirm((action) => sendPaneControlKey(paneId, action, identity, occurrenceKey));
            }}>{t("specialKey.confirmSend")}</button>
          </div>
        </div>
      ) : null}
      <p role="status" aria-live="polite" className="mt-1 text-xs text-amber-200">{view.copy ? t(view.copy.key, { ...view.copy.params, error: view.copy.params?.error || t("specialKey.rejected") }) : view.feedback}</p>
    </section>
  );
}
