import type { Locale } from "@homeling/contracts";
import { ClientSessionLocked } from "./session-state.ts";
import { LocalizedUIError, type LocalizedCopy } from "./ui-copy.ts";

export interface PushLocalePreferencePort {
  admit(): () => void;
  sync(locale: Locale, check: () => void): Promise<"synced" | "not-subscribed">;
}
export interface PushLocalePreferenceState {
  readonly phase: "idle" | "syncing" | "synced" | "unsynced";
  readonly busy: boolean;
  readonly copy?: LocalizedCopy;
}
class SupersededLocaleChoice extends Error {}
/** Explicit preference intents only: no subscription allocation, queue draining, unlock effect or retry timer. */
export class LocalePreferenceController {
  private target: Locale;
  private sequence = 0;
  private busy = false;
  private active = true;
  private state: PushLocalePreferenceState = { phase: "idle", busy: false };
  constructor(locale: Locale, private readonly port: PushLocalePreferencePort, private readonly changed: (state: PushLocalePreferenceState) => void, initialState?: PushLocalePreferenceState) { this.target = locale; if (initialState) this.state = initialState; }
  get = (): PushLocalePreferenceState => this.state;
  revision = (): number => this.sequence;
  activate(): void { this.active = true; }
  deactivate(): void { this.active = false; this.sequence++; }
  private publish(state: PushLocalePreferenceState) { this.state = state; this.changed(state); }
  select(locale: Locale): Promise<void> { this.target = locale; return this.run(locale, ++this.sequence); }
  retry(): Promise<void> { return this.run(this.target, ++this.sequence); }
  observe(locale: Locale | undefined, revision: number): void {
    if (!this.active || revision !== this.sequence || this.busy) return;
    this.publish(locale === undefined ? { phase: "idle", busy: false } : locale === this.target ? { phase: "synced", busy: false } : { phase: "unsynced", busy: false, copy: { key: "push.localeUnsynced" } });
  }
  acknowledge(locale: Locale): void {
    if (!this.active || this.busy) return;
    this.publish(locale === this.target ? { phase: "synced", busy: false } : { phase: "unsynced", busy: false, copy: { key: "push.localeUnsynced" } });
  }
  private async run(locale: Locale, sequence: number): Promise<void> {
    if (!this.active) return;
    if (this.busy) { this.publish({ phase: "unsynced", busy: true, copy: { key: "push.localeBusy" } }); return; }
    this.publish({ phase: "unsynced", busy: false, copy: { key: "push.localeUnsynced" } });
    this.busy = true;
    try {
      const lease = this.port.admit();
      const check = () => { lease(); if (!this.active || sequence !== this.sequence || locale !== this.target) throw new SupersededLocaleChoice(); };
      check(); this.publish({ phase: "syncing", busy: true });
      const result = await this.port.sync(locale, check);
      check(); this.publish({ phase: result === "synced" ? "synced" : "idle", busy: true });
    } catch (error) {
      if (sequence === this.sequence) this.publish({ phase: "unsynced", busy: true, copy: error instanceof ClientSessionLocked ? { key: "push.localeLocked" } : error instanceof LocalizedUIError ? error.copy : { key: "push.localeUnsynced" } });
    } finally {
      this.busy = false;
      if (this.active) this.publish({ ...this.state, busy: false });
    }
  }
}
