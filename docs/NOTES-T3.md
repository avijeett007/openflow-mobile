# T3 — Translator UI + turn wiring + TTS (+ T4 localStt polish)

Chunk T3 of the Offline Translator (see `DESIGN-mobile-translator.md`). Everything
lands in `src/` + root `package.json` (adds `expo-speech`) + `jest.setup.ts` +
`.gitignore`. It consumes the FROZEN T1 shared core (`@openflow/shared`) and codes
against the frozen `TranslatorModuleApi` — the T2 native module is NOT required to
run, test, or bundle this chunk (everything degrades cleanly when it is absent).

## What was built

### Libraries (`src/lib/`)
- **`translator.ts`** — defensive loader + typed wrapper for the T2 native module.
  Loaded via `requireOptionalNativeModule('Translator')` (expo-modules-core), the
  same pattern as `loadSpeechModule` / `settingsBridge`. Implements exactly
  `TranslatorModuleApi`; when the module is missing every method degrades:
  `isTranslationAvailable → { available:false, reason }`, `translate`/`downloadPack`
  reject, lists → `[]`, `getPairStatus → 'unsupported'`, `identifyLanguage`/
  `sttOnDeviceLocales → null`, `deletePack → false`.
- **`speech.ts`** — `expo-speech` wrapper. Caches `getAvailableVoicesAsync()`,
  matches a voice by BCP-47 with a **region-exact preference** (full tag → Chinese-
  script `langKey` → primary subtag), `canSpeak(lang)` gates the speak toggle,
  `speak(text,lang)` resolves on done/stopped/error (never hangs a turn), `stop()`
  supports barge-in. No native module → `canSpeak:false`, `speak` no-ops.

### Hooks (`src/hooks/`)
- **`useTranslatorTurn.ts`** — the turn orchestrator. Drives the SHARED
  `conversationReducer` (does NOT reuse `useDictation`). MIC_TAP flow: `localStt.start`
  ({lang: STT-locale for the side, onPartial→STT_PARTIAL}) → `stop` → STT_FINAL →
  (autoDetect? `identifyLanguage` → flip BEFORE building the Exchange per NOTES-T1)
  → `translate` → TRANSLATED → (speakEnabled ∧ `canSpeak(target)`) SPEAK_START →
  `speak` → SPEAK_DONE. Barge-in: a MIC_TAP during `speaking` stops TTS first. A
  `useEffect` also stops TTS whenever the machine leaves `speaking` without our own
  SPEAK_DONE (e.g. toggling speak off mid-utterance). Stale async is guarded by a
  generation counter on top of the reducer's own stale-drop. Persists lang/speak
  changes via `onLangsChange`/`onSpeakEnabledChange` (idle-only, matching the
  reducer's gating).
- **`useTranslatorCatalog.ts`** — loads availability + supported langs + on-device
  STT locales + pack states, drives the `packReducer`, and exposes `computeUsable()`
  rows + a `downloadPack` flow (DOWNLOAD_START → downloadPack → re-SYNC → installed,
  or DOWNLOAD_FAILED). Collaborators held in refs so an unstable `getSttLocales`
  prop can't cause a refresh loop.

### Screen (`src/screens/TranslateScreen.tsx`) + tab
- `TranslateScreenView` is fully dependency-injected/context-free (unit-testable);
  `TranslateScreen` (default export) wires the real singletons + `useAppState`
  settings/persistence. Registered as the **"Translate" tab (🌐)** in `MainTabs.tsx`
  (between Dictate and History).
- Split face-to-face layout, **top pane rotated 180°**; solo-mode toggle disables
  rotation and **auto-solo when VoiceOver is active** (`AccessibilityInfo.isScreenReaderEnabled`,
  which also disables the manual toggle). Per pane: tappable language pill, BIG
  translated text (`adjustsFontSizeToFit`, `minimumFontScale` ≈ 0.5 → ~20pt floor of
  a 40pt base), small original underneath, live partials while listening. Two mic
  buttons labelled by language; the active one pulses (Animated, **suppressed under
  Reduce Motion**).
- Center bar: swap (gated to idle/showing/error per reducer), speak toggle (**greyed
  when no voice for either language**), history sheet, solo toggle. Offline/pack chip:
  "On-device — works offline" / warns when a pair pack is missing or translation is
  unavailable. Language picker modal fed by `computeUsable()` (usable first, then
  downloadable) with badges ✓/⬇︎/↓/✕, ~30 MB note, Download buttons, **Android
  Wi-Fi-only checkbox (default ON, wired to `wifiOnlyDownloads`)**, and STT-pack-missing
  rows showing platform-correct copy (**Android**: in-app "Install speech model"
  button → `triggerAndroidOfflineModelDownload`; **iOS**: text instructions only,
  no `prefs:` links). History bottom-sheet with per-row Copy (`expo-clipboard`) +
  Clear. **Android-only footer "Translations powered by Google"** (required).
- Accessibility: mic labels ("Speak in Spanish"), `announceForAccessibility` on each
  new translation, ≥44pt targets, theme tokens (violet `#7C5CFF`).
- **Haptics: skipped** — `expo-haptics` is NOT a dependency (per spec, only add if
  already present). Left out entirely.

### T4 polish (`src/lib/localStt.ts`)
- `isAvailable(lang)` now **uses `lang`**: on Android (where `getSupportedLocales`
  exists, API 33+) it verifies the requested locale is among the device's
  installed/supported locales (via shared `toTranslationLang`) and reports it
  unavailable if not. Fails OPEN when enumeration is empty/absent (API < 33) and is
  a no-op on iOS and when no lang is passed (existing no-arg behaviour unchanged).
- Added `getSupportedLocalesSafe()` (Android-only; `null` off-Android / API<33 /
  error) and `triggerAndroidOfflineModelDownload(locale)` (Android 13+; `{ok:false}`
  with reason otherwise). Both wrap the jamsch `expo-speech-recognition` surface,
  now typed as optional methods on `SpeechModule` and threaded through `loadSpeechModule`.

## Native module name (for T2)
The loader requires the native module named exactly **`"Translator"`**
(`TRANSLATOR_NATIVE_MODULE_NAME` in `src/lib/translator.ts`). **T2 must register the
Swift/Kotlin module as `Name("Translator")`.** If T2 chose a different name, change
that one constant. I did NOT deviate from the design's suggested name.

## UX / judgment calls
1. **No haptics** (dependency absent) — hand-off haptic omitted, per spec's "else skip".
2. **Speak toggle greyed when neither** side's language has an installed voice
   (rather than tracking a single "next target", which isn't known until someone
   speaks). Announce + speak still resolve per-turn against the actual target lang.
3. **Chinese voice matching**: region-exact → `langKey` (keeps zh-Hans/zh-Hant
   distinct when both voices exist) → primary subtag (a lone zh voice still speaks
   either script — acceptable for TTS).
4. **`fullLangKey` is not exported from `@openflow/shared`** (only `langKey`,
   `bcp47Primary`, etc.), so region-exact voice matching uses a local normalized-tag
   compare instead. No shared changes.
5. **Pack download pairing**: the picker's Download button downloads the pair
   `(pickedLang, otherSideLang)` — ML Kit is English-pivot but the pair call ensures
   both requested models land; the pure-TS `packReducer` tracks per-language state.
6. **STT locale for a turn** = `pickSttLocale(lang, deviceSttLocales)` (from T1),
   falling back to the bare translation code when enumeration is unknown (`null`).
7. **View/screen split** so the screen is testable without an AppState provider or
   native modules — all collaborators are injected; the default export does the wiring.

## Integration notes / open items (for T5)
- **`app.config.ts` untouched** (not my scope). `expo-speech` needs no config plugin
  and no native module of ours, so no plugin entry is required. If T5 adds an iOS
  microphone/speech usage-string audit, TTS itself needs none.
- Version left at **0.2.0** (T5 owns the v0.3.0 bump).
- `jest.setup.ts` gained mocks for `expo-speech` and the two new
  `expo-speech-recognition` methods so the app suite runs offline. All app tests
  inject their own mocks; the singletons are never exercised under Jest.
- The screen reads/writes `Settings.translator` (langs/speakEnabled/autoDetect/
  wifiOnlyDownloads) through the existing `useAppState().updateSettings` → settings
  store → bridge path. `autoDetect` has no in-screen toggle yet (default off, stretch);
  it's honoured by the turn hook and could get a Settings-screen control in T5.
- Device QA (T5): iOS 18+ device (Simulator can't translate), Android with Google
  services. The offline chip surfaces the honest unavailable reason on unsupported
  devices.

## Verification (all local, green)
- `npm run typecheck` — clean (app + shared).
- `npm run lint` — clean (0 warnings).
- `npm test` — shared **227** + app **43 → 92** (added: turn hook 12, speech 10,
  translator 6, catalog 3, screen 8, localStt T4 +10 = 49 new).
- `npx expo config --type public` — exit 0.
- `npx expo export --platform ios` — exit 0 (900 modules bundled).
