# T2 — `modules/translator` local expo module (build notes & handoff)

The on-device translation native module: Apple Translation framework (iOS 18+)
in Swift, ML Kit (translate + language-id) in Kotlin, behind a defensive JS
loader. This chunk owns **`modules/translator/` only**. It does not touch
`shared/`, `src/`, `app.config.ts`, root `package.json`, `android-ime/`, or
`.github/`. A later integration pass (T5) reconciles this module's local types
with `@openflow/shared`'s `TranslatorModuleApi` and folds its Jest project into
the root `npm test`.

Read this before wiring the UI (T3) or shipping caveats (T5) — the platform
behaviours below are quirky and mostly non-obvious.

## Frozen JS surface (implemented verbatim)

```ts
translate(text, from, to): Promise<{ text: string }>
getPairStatus(from, to): Promise<'installed'|'downloadable'|'unsupported'>
downloadPack(from, to, opts?: { wifiOnly?: boolean }): Promise<void>
listSupportedLanguages(): Promise<string[]>
listDownloadedLanguages(): Promise<string[]>
deletePack(lang): Promise<boolean>
identifyLanguage(text): Promise<string|null>
sttOnDeviceLocales(): Promise<string[]|null>
isTranslationAvailable(): Promise<{ available: boolean; reason?: string }>
```

Import surface:

```ts
import { translator } from 'modules/translator';           // singleton
import { createTranslator } from 'modules/translator';     // injectable factory (tests)
import type { TranslatorApi, PairStatus } from 'modules/translator';
```

The native module is loaded with `requireOptionalNativeModule('Translator')`, so
under Jest / Expo Go / web / a not-yet-prebuilt app the module is `null` and the
JS layer degrades gracefully (see "Unavailable behaviour" below) instead of
throwing at import time — same pattern as `loadSpeechModule` / `settings-bridge`.

## JS-layer behaviour the UI must know

- **Unavailable (module missing).** `isTranslationAvailable()` →
  `{ available: false, reason: <MODULE_UNAVAILABLE> }`; `translate` and
  `downloadPack` **reject**; `getPairStatus` → `'unsupported'`; `list*` → `[]`;
  `deletePack` → `false`; `identifyLanguage` / `sttOnDeviceLocales` → `null`.
- **`downloadPack` wifiOnly defaults to `true`** in JS (spec) and is passed to
  native as a positional boolean. Never downloads ~30 MB on cellular unless the
  caller explicitly passes `{ wifiOnly: false }`.
- **Pair-status cache.** `getPairStatus(from,to)` results are memoised
  per-direction in-memory and **invalidated** on any `downloadPack` / `deletePack`
  (even if that mutation rejects — a partial download can still change state).
  The picker can call `getPairStatus` for many pairs cheaply.
- **Error normalisation.** Native `CodedError`s are re-thrown as real `Error`s
  with the message preserved and `.code` copied through when present (e.g. iOS
  `ERR_NO_WINDOW`, Android `ERR_TRANSLATE`). `isTranslationAvailable()` never
  throws — a thrown native check becomes `{ available: false, reason }`.

## iOS (Swift) — `ios/TranslatorModule.swift`

- **Deployment floor is iOS 16.4** (podspec). The module always loads. Every
  Translation-framework call is runtime-gated `#available(iOS 18.0, *)`; on
  iOS 16/17 `isTranslationAvailable()` → `{ available:false, reason: "…requires
  iOS 18 or later." }`, `getPairStatus` → `'unsupported'`, `list*` → `[]`,
  `translate`/`downloadPack` throw `ERR_UNAVAILABLE`. `identifyLanguage` and
  `sttOnDeviceLocales` work on iOS 16/17 (they don't use Translation).
- **Simulator.** `isTranslationAvailable()` returns `{ available:false, reason:
  "…not supported in the iOS Simulator — test on a device." }` via a
  `#if targetEnvironment(simulator)` compile guard. Translation is **device-only
  QA**. Do not expect the translator tab to work in the Simulator.
- **Session architecture.** On iOS 18–25 a `TranslationSession` can ONLY be
  vended by SwiftUI's `.translationTask`. We host an invisible **1×1,
  `.opacity(0)`, `.allowsHitTesting(false)`** SwiftUI view in a
  `UIHostingController` attached to the **key window** (`TranslatorCoordinator`).
  - A single async mutex serialises translate/prepare (one in flight at a time).
  - `TranslationSession.Configuration` is **recreated per `(from,to)` pair**;
    changing it restarts the `.translationTask` closure with a fresh session.
    Reusing a session across config changes is a documented `fatalError`, so we
    never do. The same-pair session is kept alive (the closure stays parked on an
    `AsyncStream` of jobs) and reused for back-to-back same-pair calls.
  - The `TranslationSession` **never crosses an actor boundary** — it lives
    entirely inside the closure, which pulls `TranslationJob`s from the
    coordinator's stream. Continuations bridge job results back to the awaiting
    `translate()`.
  - `translate()` throws **`ERR_NO_WINDOW`** if called before there's a key
    window to host the view. In practice call it after the app is foregrounded.
- **iOS 26 fast path.** For pairs that report `.installed`, `translate()` uses
  the headless `TranslationSession(installedSource:target:)` — no hosted view.
  Falls back to the hosted path on any error or for non-installed pairs.
  ⚠️ The exact iOS 26 initializer signature (`init(installedSource:target:)`,
  throwing vs not) must be confirmed against the shipping SDK in CI; it is
  gated `#available(iOS 26.0, *)` and cannot be verified without that SDK here.
- **Retry-once on Code 16.** `session.translate(_:)` is retried exactly once when
  it throws `NSError(domain: "TranslationErrorDomain", code: 16)` — Apple's
  transient *"Offline models not available"* that fires even for `.installed`
  pairs (Apple bug, FB21678303). Both the hosted and headless paths retry.
- **`getPairStatus`** maps `LanguageAvailability().status(from:to:)`:
  `.installed`→`installed`, `.supported`→`downloadable`, `.unsupported`→
  `unsupported`.
- **`listSupportedLanguages`** = `LanguageAvailability().supportedLanguages`
  mapped to `minimalIdentifier` (e.g. `en`, `zh-Hans`, `pt-BR`). Note Apple uses
  **`zh-Hans`** where ML Kit uses `zh` — the pure-TS mapping layer (T1) reconciles.
- **`downloadPack`** drives the hosted session's `prepareTranslation()`, which
  shows the **system consent sheet**. `wifiOnly` is **ignored on iOS** (the
  system download UI governs the network); it's accepted only for surface parity.
- **`listDownloadedLanguages` is best-effort.** iOS exposes availability per
  *pair*, not per language, and has no "downloaded packs" list API. We report a
  language as downloaded if translating it to/from the **device language** is
  `.installed`. Treat as approximate; don't build hard logic on it.
- **`deletePack` always returns `false`** — iOS packs are system-managed
  (Settings ▸ Apps ▸ Translate). The UI must show instructions, not a delete
  button, on iOS.
- **`identifyLanguage`** = `NLLanguageRecognizer.dominantLanguage?.rawValue`;
  `nil` (undetermined) → JS `null`.
- **`sttOnDeviceLocales`** = `SFSpeechRecognizer.supportedLocales()` filtered by
  a per-locale `SFSpeechRecognizer(locale:)?.supportsOnDeviceRecognition`, mapped
  to **BCP-47** (`identifier(.bcp47)` → `en-US`, not `en_US`). Requires
  `NSSpeechRecognitionUsageDescription` — already owned by the
  `expo-speech-recognition` config plugin, so no Info.plist work here.

## Android (Kotlin) — `android/.../TranslatorModule.kt`

- **Gradle deps live in this module's own `build.gradle`** (local expo modules
  carry their own gradle) and reach the app purely by autolinking — no app-level
  build.gradle edit, no config plugin:
  `com.google.mlkit:translate:17.0.3`, `com.google.mlkit:language-id:17.0.6`.
  ML Kit `Task<T>` results are bridged to expo `Promise`s with listeners (no
  coroutines; `play-services-tasks` comes transitively).
- **`translate()` NEVER downloads.** It does not call `downloadModelIfNeeded`.
  If the pack is missing, ML Kit's `translate()` fails fast (no silent network) →
  rejected as **`ERR_TRANSLATE`**. Unsupported language tag → **`ERR_UNSUPPORTED_PAIR`**.
- **`downloadPack` is the ONLY download path**, gated by `DownloadConditions`
  (`requireWifi()` when `wifiOnly` — which JS defaults to `true`).
- **Translator client cache**: one `Translator` per `"fromCode|toCode"` pair,
  reused across calls, **`close()`d on `OnDestroy`**.
- **`getPairStatus`**: `unsupported` if either tag isn't an ML Kit language;
  else `installed` iff BOTH endpoint models are in
  `RemoteModelManager.getDownloadedModels(...)`, else `downloadable`. (English is
  the pivot; ML Kit manages the English model itself.)
- **`listSupportedLanguages`** = `TranslateLanguage.getAllLanguages()` (59
  BCP-47 tags). **`listDownloadedLanguages`** = downloaded models' `.language`.
- **`deletePack`** deletes one `TranslateRemoteModel`; returns `true`, or `false`
  if the tag isn't a supported ML Kit language.
- **`identifyLanguage`** = ML Kit language-id; `"und"` → JS `null`.
- **`sttOnDeviceLocales` returns `null`** — Android STT-locale enumeration is
  done in JS via `expo-speech-recognition` (`getSupportedLocales()`).
- **`isTranslationAvailable` returns `{ available: true }`.** ⚠️ ML Kit model
  downloads need **Google Play services** — de-Googled phones can't download
  packs. That caveat + the **required "Translations powered by Google"**
  attribution (ML Kit terms) are the UI's responsibility (T3).

## Native error codes (for UI copy / special-casing)

| Code | Platform | Meaning |
|---|---|---|
| `ERR_UNAVAILABLE` | iOS <18 | Translation framework absent |
| `ERR_NO_WINDOW` | iOS | Called before a key window exists |
| `ERR_UNSUPPORTED_PAIR` | Android | `TranslateLanguage.fromLanguageTag` returned null |
| `ERR_TRANSLATE` | Android | translate() failed (usually pack not downloaded) |
| `ERR_DOWNLOAD` / `ERR_DELETE` / `ERR_PAIR_STATUS` / `ERR_LIST_DOWNLOADED` / `ERR_IDENTIFY` | Android | corresponding ML Kit task failure |

iOS transient retried internally: `TranslationErrorDomain` **Code 16**
"Offline models not available".

## Testing & verification (this chunk)

- **Jest**: `npx jest --config modules/translator/jest.config.js` — 21 tests,
  all green. Pure JS-layer logic with an **injected fake native module**
  (`createTranslator(() => fake)`): unavailable fallbacks, `wifiOnly` default,
  pair-status caching + invalidation, error normalisation. RN-free. The module
  carries its own Jest project because the root `jest.config.js` only roots
  `src/`; T5 folds it into `npm test`.
- **Typecheck**: `npx tsc -p modules/translator/tsconfig.json` (added a local
  tsconfig because root `tsconfig.json` doesn't `include` `modules/`). Root
  typecheck + `eslint .` both stay green.
- **Autolinking (prebuild `--no-install`, verified):**
  - Android — `expo-modules-autolinking resolve -p android` lists
    `translator` → module `expo.modules.translator.TranslatorModule`, sourceDir
    `modules/translator/android` (whose build.gradle carries the ML Kit deps).
  - iOS — `expo-modules-autolinking resolve --platform apple` lists `translator`
    → pod **`Translator`** (podspec `modules/translator/ios/Translator.podspec`),
    swift module `Translator`, JS module `TranslatorModule`. Identical shape to
    the known-good `settings-bridge`. NB: the iOS resolver uses `--platform
    apple` (not `ios`); `-p ios` returns node_modules-only.
- **`expo export --platform ios`** succeeds (Metro resolves; app bundles). The
  app does **not import `modules/translator` yet** (T3/T5 do), so export only
  proves no global breakage; the JS module's own resolution is exercised by Jest.
- **Compilation proof (Swift/Kotlin) comes in CI** (`ios.yml` / `android.yml`) —
  there's no Xcode/Android SDK locally. The native code is written boring and
  doc-verified against the Apple Translation framework + ML Kit docs cited in the
  design spec. The one item to watch in CI: the iOS 26 `installedSource:target:`
  initializer signature.
