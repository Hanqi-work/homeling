import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { LOCALES, isLocale, resolveLocale, translateCatalog, type Locale, type Translate } from "@homeling/contracts";
export { LOCALES } from "@homeling/contracts";
export type { Locale, Translate } from "@homeling/contracts";
import { localeResources } from "./locale-resources.ts";
import { sessionState } from "./session-state.ts";
import { syncPushLocale } from "./push-client.ts";
import { LocalePreferenceController, type PushLocalePreferencePort, type PushLocalePreferenceState } from "./locale-preference.ts";

const preferenceKey = "homeling.locale";
const pendingKey = "homeling.pushLocalePending";
export function translate(locale: Locale, key: string, params?: Record<string, string | number>): string { return translateCatalog(locale, localeResources, key, params); }
function initialLocale(): Locale {
  try { return resolveLocale(window.localStorage.getItem(preferenceKey)); } catch { return "en"; }
}
function initialPushSync(): PushLocalePreferenceState {
  try { if (window.localStorage.getItem(pendingKey) === "1") return { phase: "unsynced", busy: false, copy: { key: "push.localeUnsynced" } }; } catch { /* Local language remains usable without storage. */ }
  return { phase: "idle", busy: false };
}
const defaultContext = {
  locale: "en" as Locale, persistenceFailed: false, canRetryPushLocale: false,
  pushLocaleSync: { phase: "idle", busy: false } as PushLocalePreferenceState,
  setLocale: (_locale: Locale) => {}, retryPushLocale: () => {}, acknowledgePushLocale: (_locale: Locale) => {},
  observePushLocale: (_locale: Locale | undefined, _revision: number) => {}, getPushLocaleRevision: () => 0,
  t: ((key, params) => translate("en", key, params)) as Translate,
};
const LocaleContext = createContext(defaultContext);
const browserPort: PushLocalePreferencePort = { admit: sessionState.admit, sync: syncPushLocale };
export function LocaleProvider({ children, pushLocalePort = browserPort }: { children: ReactNode; pushLocalePort?: PushLocalePreferencePort }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const [persistenceFailed, setPersistenceFailed] = useState(false);
  const [canRetryPushLocale, setCanRetry] = useState(() => sessionState.get().ready === true);
  const [pushLocaleSync, setPushSync] = useState<PushLocalePreferenceState>(initialPushSync);
  const [controller] = useState(() => new LocalePreferenceController(locale, pushLocalePort, (state) => {
    setPushSync(state);
    try { if (state.phase === "unsynced" || state.phase === "syncing") window.localStorage.setItem(pendingKey, "1"); else window.localStorage.removeItem(pendingKey); } catch { /* The visible persistence warning covers disabled storage. */ }
  }, pushLocaleSync));
  function persist(value: Locale) {
    try { window.localStorage.setItem(preferenceKey, value); setPersistenceFailed(false); } catch { setPersistenceFailed(true); }
  }
  function select(value: Locale) {
    if (!isLocale(value)) return;
    setLocaleState(value); persist(value);
    void controller.select(value);
  }
  useEffect(() => { document.documentElement.lang = locale; persist(locale); }, [locale]);
  useEffect(() => sessionState.subscribe(() => setCanRetry(sessionState.get().ready === true)), []);
  useEffect(() => { controller.activate(); return () => controller.deactivate(); }, [controller]);
  return <LocaleContext value={{ locale, persistenceFailed, canRetryPushLocale, pushLocaleSync, setLocale: select,
    retryPushLocale: () => { void controller.retry(); }, acknowledgePushLocale: (value) => controller.acknowledge(value),
    observePushLocale: (value, revision) => controller.observe(value, revision), getPushLocaleRevision: controller.revision,
    t: (key, params) => translate(locale, key, params),
  }}>{children}</LocaleContext>;
}
export function useLocale() { return useContext(LocaleContext); }
export function LanguageSettings({ id = "homeling-language" }: { id?: string } = {}) {
  const { locale, persistenceFailed, canRetryPushLocale, pushLocaleSync, setLocale, retryPushLocale, t } = useLocale();
  return <div className="my-6">
    <label htmlFor={id} className="mb-2 block font-medium">{t("locale.language")}</label>
    <select id={id} value={locale} onChange={(event) => { if (isLocale(event.currentTarget.value)) setLocale(event.currentTarget.value); }} className="min-h-12 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-300">
      {LOCALES.map(({ code, nativeName }) => <option key={code} value={code} lang={code}>{nativeName}</option>)}
    </select>
    {persistenceFailed ? <span role="status" className="mt-2 block text-sm text-amber-300">{t("locale.notSaved")}</span> : null}
    {pushLocaleSync.phase !== "idle" ? <span role="status" className="mt-2 block text-sm text-neutral-300">{t(pushLocaleSync.copy?.key ?? (pushLocaleSync.phase === "syncing" ? "push.localeSyncing" : pushLocaleSync.phase === "synced" ? "push.localeSynced" : "push.localeUnsynced"), pushLocaleSync.copy?.params)}</span> : null}
    {pushLocaleSync.phase === "unsynced" ? <button type="button" data-locale-sync disabled={!canRetryPushLocale || pushLocaleSync.busy} onClick={retryPushLocale} className="mt-2 min-h-12 rounded-xl border border-neutral-700 px-4 py-3 text-sm disabled:opacity-50">{t("push.localeRetry")}</button> : null}
  </div>;
}
