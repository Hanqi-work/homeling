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
export type LocaleCatalog = Partial<Record<Locale, Readonly<Record<string, string>>>>;
export function isLocale(value: unknown): value is Locale { return LOCALES.some(({ code }) => code === value); }
export function resolveLocale(value: unknown): Locale { return isLocale(value) ? value : "en"; }
/** Source English fallback; unknown keys stay visible. Parameters are inserted once, never parsed as copy. */
export function translateCatalog(locale: Locale, catalog: LocaleCatalog, key: string, params?: Record<string, string | number>): string {
  const text = catalog[resolveLocale(locale)]?.[key] ?? catalog.en?.[key] ?? key;
  if (params === undefined) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => Object.hasOwn(params, name) ? String(params[name]) : match);
}
