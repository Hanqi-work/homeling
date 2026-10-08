# Ticket #20 implementation notes

## Scope and sequence
- Isolated jj workspace ticket-20-locale, base 96bd5b2123bfd9d9e712c210a0b06495b9b053cc; never modify primary checkout/integration bookmark.
- First tracer: actual settings selector -> context consumers -> persisted selection after remount; then migrate delivered interfaces, finally integrate all tickets' final tips and scan all UI.
- Authorized public seams: rendered settings/navigation/components, locale translation/fallback API, browser preference storage, document language; DOM/fakes only, no browser space.
- Contract announced to parent: locale.tsx exports LocaleProvider/useLocale; t(key, params), feature.camelCase keys, {name}/{count} interpolation. Protocol values and original user/agent text stay unchanged.
- Preserve shell slots/providers; settings compose existing push/lock controls and LanguageSettings.
- Final readiness blocked until #12/#13/#15/#17/#18/#19/#16 final tips are actually integrated; current subset green does not imply readiness.

## Decisions
- Independent bundled dictionaries, no Collie runtime/module reuse. Collie read-only resource list currently seven: en/de/es/ko/ja/zh/zh-TW. Six issue-baseline languages initially en/de/es/ko/ja/zh; upstream seventh discrepancy sent to parent.
- Native labelled select and html lang, based on modern-web-guidance accessibility guide. Skill itself warns it is outdated; no skill/config mutation.
- React official Context7 guidance supports context state rerender and effect persistence; use existing React version APIs, no speculative 19.3 API.

## Deviations
- jj workspace add with --ignore-working-copy created workspace but could not populate it; corrected only newly created workspace with jj new at approved base and moved only own feature bookmark. No main checkout update.
