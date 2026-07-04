# T1 — shared translator core (frozen exports for T2 / T3)

Chunk T1 of the Offline Translator (see `DESIGN-mobile-translator.md`). Everything
lands in `shared/` (pure TS, zero RN imports, node/Jest). **The surface below is
FROZEN** — T2 (`modules/translator`) and T3 (Translator UI) import it from
`@openflow/shared` and must not redeclare any of it.

## Exports (all re-exported from `@openflow/shared` root)

### Conversation state machine — `shared/src/translator/conversation.ts`
| Export | Kind |
|---|---|
| `Side` (`'a' \| 'b'`), `otherSide(side)` | type + fn |
| `TurnStatus` (`idle\|listening\|translating\|showing\|speaking\|error`) | type |
| `Exchange { id, ts, side, sourceLang, targetLang, sourceText, translatedText, detectedLang?, spoken }` | type |
| `ConversationState`, `ConversationAction` | types |
| `conversationReducer(state, action)` | fn (pure, exhaustive) |
| `initialConversationState(opts?: { langs?, speakEnabled? })` | fn |
| `HISTORY_CAP = 50`, `DEFAULT_LANGS = { a: 'en', b: 'es' }` | consts |

Actions: `MIC_TAP{side}`, `STT_PARTIAL{text}`, `STT_FINAL{text}`,
`TRANSLATED{exchange}`, `SPEAK_START`, `SPEAK_DONE`, `ERROR{error}`,
`SWAP_LANGS`, `SET_LANG{side,lang}`, `SET_SPEAK_ENABLED{enabled}`, `RESET`,
`CLEAR_HISTORY`.

Key semantics T3's `useTranslatorTurn` must build on:
- **Other-side `MIC_TAP` while listening** keeps status `listening` but flips
  `activeSide` — the hook must observe the `activeSide` change, cancel the old
  STT session and start one for the new side/lang.
- **Same-side tap while listening is a reducer no-op** — the hook calls
  `localStt.stop()`, which lands as `STT_FINAL`.
- Taps are **ignored during `translating`** (short in-flight await). Taps from
  `speaking` are allowed (barge-in) — the hook stops TTS whenever status leaves
  `speaking` without `SPEAK_DONE`.
- Empty/whitespace `STT_FINAL` → `idle` silently (no turn, no error).
- `TRANSLATED` carries a **fully built `Exchange`** (the hook resolves
  auto-detect flips and languages before dispatching); the reducer prepends to
  `history` (newest first, cap 50) and never re-derives languages.
- `ERROR` is per-turn and non-fatal: history/current/langs survive; any
  `MIC_TAP` recovers.
- `SWAP_LANGS` / `SET_LANG`: applied only with no active turn
  (`idle`/`showing`/`error`); **ignored mid-turn** (listening/translating/speaking).
- `SPEAK_START` gating: only from `showing`, only if `speakEnabled`, only with a
  `current` exchange; marks it `spoken` in both `current` and `history`.
  `SET_SPEAK_ENABLED{false}` during `speaking` drops to `showing`.
- Stale async events (`STT_PARTIAL`/`STT_FINAL`/`TRANSLATED` arriving in the
  wrong status) are dropped by the reducer — the hook needs no extra guards.

### Pack tracking — `shared/src/translator/packs.ts`
| Export | Kind |
|---|---|
| `PackState` (`installed\|downloadable\|downloading\|unsupported`), `PACK_STATES` | type + const |
| `PackMap` (`Record<lang, PackState>`), `initialPackMap` | type + const |
| `PackAction` (`SYNC{supported,downloaded}`, `DOWNLOAD_START/DONE/FAILED{lang}`, `PACK_DELETED{lang}`) | type |
| `packReducer(state, action)` | fn |
| `getPackState(map, lang)` — alias-tolerant, unknown → `unsupported` | fn |

`SYNC` rebuilds from the module's `listSupportedLanguages()` +
`listDownloadedLanguages()`, preserving in-flight `downloading` entries.
Downloaded↔supported matching is two-tier: exact region-aware key first, then
alias-level (iw↔he, nb-NO↔no, fil↔tl) **only when unambiguous** — so Apple's
`en-GB`/`en-US` and `zh-Hans`/`zh-Hant` stay distinct.

### Language mapping — `shared/src/translator/langs.ts`
| Export | Purpose |
|---|---|
| `bcp47Primary(tag)` | lowercased primary subtag |
| `PRIMARY_ALIASES`, `canonicalPrimary(tag)` | iw→he, in→id, ji→yi, tl→fil, nb→no, mo→ro |
| `langKey(tag)` | primary + script for Chinese (`zh-CN`→`zh-hans`, `zh-TW`→`zh-hant`) |
| `fullLangKey(tag)` | langKey + region (`en-US`→`en-us`) |
| `toTranslationLang(tag, available)` | STT locale → platform translation code (or null). Tiers: exact → lang+script → primary; first list entry wins ties |
| `pickSttLocale(lang, sttLocales)` | reverse mapping (null = missing STT pack) |
| `displayLanguageName(code)`, `FALLBACK_DISPLAY_NAMES` | English names; ICU with table fallback |
| `computeUsable(sttLocales, translationLangs, packStates): UsableLang[]` | picker rows |
| `UsableLang { lang, displayName, sttLocale, sttKnown, pack, usable }` | type |

`computeUsable`: `usable ⇔ pack === 'installed' ∧ (sttLocale ≠ null ∨ !sttKnown)`.
`sttLocales === null` (enumeration unavailable, e.g. Android < API 33) means STT
is *unknown*, not missing (`sttKnown: false` — soften UI copy). `downloading`
rows are not usable. Sort: ready → installed-no-STT → downloading →
downloadable, alphabetical within groups.

### Module JS surface (types only) — `shared/src/translator/module.ts`
`TranslatorModuleApi` (the exact frozen surface from the design doc:
`translate`, `getPairStatus`, `downloadPack`, `listSupportedLanguages`,
`listDownloadedLanguages`, `deletePack`, `identifyLanguage`,
`sttOnDeviceLocales`, `isTranslationAvailable`), plus `PairStatus` +
`PAIR_STATUSES`, `TranslateResult`, `DownloadPackOptions`,
`TranslationAvailability`. **T2: implement this interface; T3: consume it** —
one source of truth, no duplicate declarations.

### Settings — `shared/src/settings/schema.ts` (additive)
`TranslatorSettingsSchema` / `TranslatorSettings` added to `Settings` as
`translator`: `{ langs: { a: 'en', b: 'es' }, speakEnabled: true, autoDetect:
false, wifiOnlyDownloads: true }` (values shown are the defaults).
`SETTINGS_VERSION` stays **1**; pre-translator payloads parse and gain the
defaults; the Kotlin IME mirror (`stt.mode` only) is untouched.

### Pinned fixtures — `shared/fixtures/`
- `langs-mlkit.json` — ML Kit's 59 codes (fetched from the official support
  page 2026-07-04). Legacy spellings ML Kit actually uses: `he`, `id`, `no`,
  `tl`, bare `zh`.
- `langs-apple.json` — Apple iOS 18 list, 21 codes (~19-20 languages; `en-GB`/
  `en-US`, `zh-Hans`/`zh-Hant`, `pt-BR` are distinct entries). **List order is
  contractual**: primary-tier fallback picks the first match (`en-AU`→`en-GB`).
  T2's iOS `listSupportedLanguages()` should report codes in this shape.

## Judgment calls (in reducer semantics, all tested)
1. `MIC_TAP` during `translating` is ignored; barge-in from `speaking` is allowed.
2. `SWAP_LANGS`/`SET_LANG` allowed in `showing`/`error` too (not just strict
   `idle`) — after the first exchange the machine rests in `showing`, so
   idle-only would make swapping impossible; mid-turn stays ignored per spec.
3. `Exchange.spoken` is set at `SPEAK_START` (TTS attempted), not `SPEAK_DONE`.
4. `nn` (Nynorsk) is deliberately NOT aliased to `no` — different written language.
5. ML Kit has a single `zh` model: `zh-TW`/`zh-Hant` STT still maps to it via
   the primary tier (Apple keeps Hans/Hant distinct via the script tier).
6. Apple lacks Portuguese (Portugal): `pt-PT` maps to `pt-BR` (only option).
7. `deletePack` returning `false` on iOS is part of the frozen contract
   (system-managed packs).

## Verification
`npm run typecheck` / `npm run lint` / `npm test` all green.
Shared suite: 49 → 227 tests (11 suites); app suite untouched at 43.
