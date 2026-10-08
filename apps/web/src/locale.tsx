import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { LOCALES, isLocale, resolveLocale, translateCatalog, type Locale, type Translate } from "@homeling/contracts";
export { LOCALES } from "@homeling/contracts";
export type { Locale, Translate } from "@homeling/contracts";
import { localeResources } from "./locale-resources.ts";
const preferenceKey = "homeling.locale";
export function translate(locale: Locale, key: string, params?: Record<string, string | number>): string {
  return translateCatalog(locale, localeResources, key, params);
}
function initialLocale(): Locale {
  try { return resolveLocale(window.localStorage.getItem(preferenceKey)); } catch { /* Storage may be disabled; in-memory selection still works. */ }
  return "en";
}
const defaultContext = { locale: "en" as Locale, persistenceFailed: false, setLocale: (_locale: Locale) => {}, t: ((key, params) => translate("en", key, params)) as Translate };
const LocaleContext = createContext(defaultContext);
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [persistenceFailed, setPersistenceFailed] = useState(false);
  useEffect(() => {
    document.documentElement.lang = locale;
    try { window.localStorage.setItem(preferenceKey, locale); setPersistenceFailed(false); }
    catch { setPersistenceFailed(true); }
  }, [locale]);
  return <LocaleContext value={{ locale, persistenceFailed, setLocale, t: (key, params) => translate(locale, key, params) }}>{children}</LocaleContext>;
}
export function useLocale() { return useContext(LocaleContext); }
export function LanguageSettings() {
  const { locale, persistenceFailed, setLocale, t } = useLocale();
  return <div className="my-6">
    <label htmlFor="homeling-language" className="mb-2 block font-medium">{t("locale.language")}</label>
    <select id="homeling-language" value={locale} onChange={(event) => { if (isLocale(event.currentTarget.value)) setLocale(event.currentTarget.value); }} className="min-h-12 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-300">
      {LOCALES.map(({ code, nativeName }) => <option key={code} value={code} lang={code}>{nativeName}</option>)}
    </select>
    {persistenceFailed ? <span role="status" className="mt-2 block text-sm text-amber-300">{t("locale.notSaved")}</span> : null}
  </div>;
}
