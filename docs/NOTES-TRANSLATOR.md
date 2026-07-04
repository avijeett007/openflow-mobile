# Offline Translator — consolidated feature notes (v0.3.0)

The "Live Translation" tab: face-to-face, on-device, offline-after-download speech
translation. Free, no API keys, no cloud round-trip. This doc consolidates the four
build chunks (T1–T4) and the T5 integration, and carries the **device QA checklist**
that CI cannot cover (translation is device-only; the Simulator can't translate and
de-Googled Android can't download packs).

See also: `DESIGN-mobile-translator.md` (authoritative spec) and the per-chunk
handoffs `docs/NOTES-T1.md` (shared core), `docs/NOTES-T2.md` (native module),
`docs/NOTES-T3.md` (UI / turn hook / TTS).

## Architecture at a glance

| Layer | Where | What |
|---|---|---|
| **Shared core (T1)** | `shared/src/translator/` | Pure-TS: `conversationReducer` state machine, `packReducer` pack tracking, `langs.ts` STT-locale ↔ translation-code mapping (pinned fixtures for both platforms), and the FROZEN `TranslatorModuleApi` types. `TranslatorSettingsSchema` added to `Settings` (additive; `SETTINGS_VERSION` stays 1). |
| **Native module (T2)** | `modules/translator/` | Local expo module. iOS: Swift + Apple Translation framework, runtime-gated `#available(iOS 18.0, *)`. Android: Kotlin + ML Kit `translate:17.0.3` + `language-id:17.0.6`. Registered as `Name("Translator")` on both platforms. Defensive JS loader degrades to "unavailable" under Jest/Expo Go/web. |
| **App wrapper (T3)** | `src/lib/translator.ts` | `requireOptionalNativeModule('Translator')` loader implementing the shared `TranslatorModuleApi`; every method degrades cleanly when the module is absent. |
| **TTS (T3)** | `src/lib/speech.ts` | `expo-speech` wrapper: region-exact voice match, `canSpeak()` gates the speak toggle, barge-in via `stop()`. |
| **Turn wiring (T3)** | `src/hooks/useTranslatorTurn.ts`, `useTranslatorCatalog.ts` | Drives the shared reducer: `localStt.start` → STT_FINAL → (autoDetect? `identifyLanguage` → flip) → `translate` → TRANSLATED → optional `speak`. Catalog loads availability + supported langs + STT locales + pack states. |
| **Screen (T3)** | `src/screens/TranslateScreen.tsx` + `MainTabs.tsx` (🌐) | Split face-to-face layout, top pane rotated 180° (solo-mode/VoiceOver disables), BIG translated text, per-pane mic, pickers with pack badges + Download, Android Wi-Fi-only checkbox, "Translations powered by Google" footer (Android), history sheet. |
| **STT locale polish (T4)** | `src/lib/localStt.ts` | `isAvailable(lang)` now actually uses `lang` (Android API 33+); `getSupportedLocalesSafe()` + `triggerAndroidOfflineModelDownload()`. |

### Frozen JS surface (single source: `@openflow/shared` `TranslatorModuleApi`)

```ts
translate(text, from, to): Promise<{ text: string }>
getPairStatus(from, to): Promise<'installed'|'downloadable'|'unsupported'>
downloadPack(from, to, opts?: { wifiOnly?: boolean }): Promise<void>
listSupportedLanguages(): Promise<string[]>
listDownloadedLanguages(): Promise<string[]>
deletePack(lang): Promise<boolean>          // iOS: always false (system-managed packs)
identifyLanguage(text): Promise<string|null>
sttOnDeviceLocales(): Promise<string[]|null> // Android: null (JS uses expo-speech-recognition)
isTranslationAvailable(): Promise<{ available: boolean; reason?: string }>
```

## Honest caveats (surfaced in UI + README)

- **iOS 18 floor.** Translation needs iOS 18+. iOS 16/17 shows an explainer; the rest
  of the app works. The **iOS Simulator cannot translate** — device-only QA.
- **Android needs Google Play services.** ML Kit model downloads require it; de-Googled
  phones can't download packs (the offline chip surfaces the honest reason).
- **Attribution (required).** Android shows "Translations powered by Google" (ML Kit terms).
- **Language coverage.** Apple ~19–20 languages vs ML Kit's 59. English is the ML Kit pivot.
- **iOS packs are system-managed.** No in-app delete, no sizes (`deletePack` → `false`;
  the UI shows Settings ▸ Apps ▸ Translate instructions, not a delete button).
- **Usable pair** = STT(A) ∧ translation(A→B) [∧ voice(B) for TTS].
- **iOS ring-mute silences TTS** (system behaviour).

## Known CI watch-items

- **iOS 26 fast path** (`TranslationSession(installedSource:target:)`): the exact
  initializer signature (throwing vs not) must be confirmed against the shipping SDK
  in CI. Gated `#available(iOS 26.0, *)`; can't be verified without that SDK locally.
- **Native compilation proof** (Swift + Kotlin) only happens in `ios.yml` / `android.yml`
  — there is no Xcode / Android SDK in the JS toolchain. Prebuild `--no-install`
  autolinking + `expo export` are verified locally; compilation is CI's job.
- **iOS transient Code 16** ("Offline models not available", Apple bug FB21678303) is
  retried exactly once internally on both hosted and headless paths — watch the retry
  holds up on a real device.

---

# DEVICE QA CHECKLIST

CI cannot run these — translation is device-only. Run on real hardware before any store
submission. Check each box on the target OS.

## iOS (physical device, iOS 18+ — NOT the Simulator)

- [ ] **Pack download sheet.** Open Translate, pick a downloadable pair → the **system
      consent sheet** appears; accept → pair flips to `installed` (chip: "On-device —
      works offline").
- [ ] **Translate offline in airplane mode.** With the pack installed, enable Airplane
      Mode, speak a turn → STT → translation appears with no network. Reverse direction works.
- [ ] **Hosted-session stability.** Do many back-to-back translations, swap languages
      several times (forces `TranslationSession.Configuration` recreation), background/
      foreground the app between turns → no crash, no `ERR_NO_WINDOW`, no stuck turn.
- [ ] **Code-16 retry.** On an `.installed` pair, confirm a translation that transiently
      throws `TranslationErrorDomain` code 16 succeeds on the automatic single retry
      (may be intermittent — do a burst of translations to try to provoke it).
- [ ] **iOS 26 fast path** (if on iOS 26): installed pairs use the headless
      `TranslationSession(installedSource:target:)` path and still translate correctly.
- [ ] **iOS <18 device** (if available): Translate tab shows the explainer; the rest of
      the app is unaffected.
- [ ] **STT-pack missing.** Pick a language whose on-device dictation model isn't
      installed → row shows the iOS text instructions ("Settings ▸ General ▸ Keyboard ▸
      Dictation Languages"), NOT a broken mic.
- [ ] **TTS voice missing.** Pick a target language with no installed voice → speak
      toggle is greyed / disabled with an install hint; translation still shows.
- [ ] **iOS pack delete** is instructions-only (no in-app delete button).

## Android (physical device, Google Play services present)

- [ ] **Pack download w/ Wi-Fi condition.** Wi-Fi-only checkbox default ON → Download on
      cellular does NOT start the ~30 MB download; on Wi-Fi it completes → pair `installed`.
- [ ] **Airplane-mode translate.** Pack installed → Airplane Mode → speak → translation
      appears offline. `translate()` of a *missing* pack fails fast (no silent download).
- [ ] **Attribution footer** "Translations powered by Google" is visible on the Translate tab.
- [ ] **De-Googled disclaimer.** On a device without Play services (or simulate the
      failure), pack download fails with the honest "requires Google services" message.
- [ ] **STT-pack missing.** Language missing its offline speech model → in-app "Install
      speech model" button (`triggerAndroidOfflineModelDownload`, Android 13+) or a clear
      unavailable state on older APIs.
- [ ] **TTS voice missing.** No installed voice for the target → speak toggle greyed +
      install hint; translation still shows.
- [ ] **Pack delete** works (RemoteModelManager delete → row returns to `downloadable`).

## Both platforms

- [ ] **STT-pack missing flows** behave per platform (above) — never a silent failure.
- [ ] **TTS voice missing flow** — toggle disabled with hint, turn still completes.
- [ ] **Solo mode.** Solo toggle disables the 180° top-pane rotation; layout is upright
      and usable single-user.
- [ ] **VoiceOver / TalkBack.** Auto-solo when the screen reader is on (manual solo toggle
      disabled); mic buttons labelled by language; each new translation is announced
      (`announceForAccessibility`); ≥44pt targets; Reduce Motion suppresses the mic pulse.
- [ ] **Auto-detect toggle** (Settings ▸ Live Translation): ON → speaking the *other*
      side's language flips direction before translating; OFF (default) → manual direction.
- [ ] **History sheet.** Exchanges accumulate (newest first, cap 50), Copy works
      (`expo-clipboard`), Clear empties it.
- [ ] **Barge-in.** Tapping a mic during TTS playback stops speech and starts the new turn.
