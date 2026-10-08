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

## Progress
- First tracer red missing module -> green actual settings/context/remount/html lang; initial candidate e648fb7f7f60f61fb7d42151c00b729ecafd6844, 289 tests/typecheck/build green. Parent may explicitly consume API; not final readiness.
- Migrated message delivery, permission chrome (agent question/options untouched), raw mirror, task chip, home/new/nav, composer quick-reply controls, and persona detail. Stateful notices retain keys/params so open confirmations and uncertainty warnings react to locale changes.
- Added storage-denied and invalid-preference DOM tests, composer draft DOM preservation, in-place deletion confirmation, complete resource/interpolation parity, and raw agent text equal to empty-state copy regression.
- Read-only consultant found no proven remount bug but missing production AppRoot/owned draft/queue evidence; integrate actual #19 root and add public fake-server DOM coverage before claiming those boundaries.
- Resource-only helper supplied 63 complete six-language detail/control/voice keys; no component writes by helper. Coordinator requested resource-only boundary, respected.

## Phase verification (not final ticket readiness)
- Explicitly integrated #19 actual stable root d1c283cbe37ce2caa5a495ac72bb8525d3831266. Main conflict resolved narrowly to LocaleProvider -> BrowserRouter -> existing AppRoot, preserving SessionBoundary and injected slots.
- Public actual AppRoot fake-server DOM tests now cover real settings remount persistence, retained extension/lock controls, real controlled conversation draft and location across locale/lock/unlock, and real uncertain send remaining blocked with exactly one write and no unlock replay.
- Shared pure LOCALES/Locale/resolveLocale/translateCatalog in packages/contracts/src/locale.ts; daemon need not import React/web to render per-subscription push copy. Public fixture catalog test covers source-English fallback without mutating production internals.
- Voice and special-key models retain legacy diagnostic message shape while attaching structured copy metadata; rendered UI re-translates current statuses/errors. Protocol actions/outcomes and transcript untouched.
- Simplification four independent angles deduplicated to four exact fixes: shared LocalizedCopy, shared LOCALES+one resource-entry enumeration, no unused interpolation allocation, shared locale resolver. Applied and verified only those fixes.
- Phase key scan checks all literal t/copy refs and explicit dynamic status domain; raw JSX/accessibility sweep is deliberately only nine migrated surfaces. It caught missing task.done (now fixed). Final scan must widen to all production frontend and daemon/native push after dependency tips.
- Latest phase suite: 317 tests, typecheck/build green. This is not #20 ready.

## Outstanding dependency gate
- Integration still 96bd5b21 as of latest read. Wait for actual final #12/#13/#15/#17/#18/#19/#16 tips; merge them only into this workspace, semantic preservation of all providers/slots/scoped occurrence guards.
- Remaining migration: final ConversationPage/TaskDetailPage metadata/errors/empty/duration, #12 memory, #13 activity/occurrence boundary, #15 push UI/client + native push system templates, #17 triage, #18 avatar/customize/orbs, #19 lock UI/AppRoot loading/title. No final readiness on partial UI greens.
- Push contract agreed: persisted subscription locale (six exact codes, absent/invalid -> en), pref-only update existing endpoint/owner under actual session admission, no permission prompt/new occurrence/old notification replay. Lock retains local language but must explicitly show remote preference unsynced; unlock never auto-replays preference writes. Per-subscription native templates preserve raw persona names/questions/task detail; dedupe identity unchanged by locale.
- Resource helper declined expanded resource assignment beyond initial three-file scope. Stopped that delegation; no other-ticket reads or extra resource writes by helper. Main executor handles expanded scope only within explicit user authorization, after tips land locally.

## Deviations
- jj workspace add with --ignore-working-copy created workspace but could not populate it; corrected only newly created workspace with jj new at approved base and moved only own feature bookmark. No main checkout update.
