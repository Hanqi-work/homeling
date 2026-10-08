import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export const LOCALES = [
  { code: "en", nativeName: "English" },
  { code: "de", nativeName: "Deutsch" },
  { code: "es", nativeName: "Español" },
  { code: "ko", nativeName: "한국어" },
  { code: "ja", nativeName: "日本語" },
  { code: "zh", nativeName: "简体中文" },
] as const;
export type Locale = typeof LOCALES[number]["code"];
export type Translate = (key: string, params?: Record<string, string | number>) => string;
import { localeResources } from "./locale-resources.ts";
const resources = localeResources as Record<Locale, Record<string, string>>;
const preferenceKey = "homeling.locale";
function isLocale(value: unknown): value is Locale { return LOCALES.some(({ code }) => code === value); }
export function translate(locale: Locale, key: string, params: Record<string, string | number> = {}): string {
  const text = resources[locale][key] ?? resources.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => Object.hasOwn(params, name) ? String(params[name]) : match);
}
function initialLocale(): Locale {
  try { const stored = window.localStorage.getItem(preferenceKey); if (isLocale(stored)) return stored; } catch { /* Storage may be disabled; in-memory selection still works. */ }
  return "en";
}
const defaultContext = { locale: "en" as Locale, setLocale: (_locale: Locale) => {}, t: ((key, params) => translate("en", key, params)) as Translate };
const LocaleContext = createContext(defaultContext);
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  useEffect(() => {
    document.documentElement.lang = locale;
    try { window.localStorage.setItem(preferenceKey, locale); } catch { /* Preference remains usable for this page when storage is unavailable. */ }
  }, [locale]);
  return <LocaleContext value={{ locale, setLocale, t: (key, params) => translate(locale, key, params) }}>{children}</LocaleContext>;
}
export function useLocale() { return useContext(LocaleContext); }
export function LanguageSettings() {
  const { locale, setLocale, t } = useLocale();
  return <div className="my-6">
    <label htmlFor="homeling-language" className="mb-2 block font-medium">{t("locale.language")}</label>
    <select id="homeling-language" value={locale} onChange={(event) => { if (isLocale(event.currentTarget.value)) setLocale(event.currentTarget.value); }} className="min-h-12 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-300">
      {LOCALES.map(({ code, nativeName }) => <option key={code} value={code} lang={code}>{nativeName}</option>)}
    </select>
  </div>;
}
